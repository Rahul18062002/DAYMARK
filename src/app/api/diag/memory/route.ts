// TEMPORARY platform diagnostics (Embarko memory measurement). Disabled unless DIAG_TOKEN is set; remove before production.
// Returns only memory and process figures: never environment values.
import fs from "node:fs";
import v8 from "node:v8";
import Database from "better-sqlite3";
import { databaseFile } from "@/server/db-path";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
const read = (p: string) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };

export async function GET(req: Request) {
  const token = process.env.DIAG_TOKEN ?? "";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  if (token.length < 20 || given.length !== want.length || !timingSafeEqual(given, want)) return new Response("Not found", { status: 404 });

  const procs: { pid: number; ppid: number; rssMB: number; anonMB: number; name: string }[] = [];
  for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    const st = read(`/proc/${pid}/status`);
    if (!st) continue;
    const num = (k: string) => Number((st.match(new RegExp(`^${k}:\\s+(\\d+)`, "m")) ?? [])[1] ?? 0);
    procs.push({ pid: Number(pid), ppid: num("PPid"), rssMB: +(num("VmRSS") / 1024).toFixed(1), anonMB: +(num("RssAnon") / 1024).toFixed(1), name: (st.match(/^Name:\s+(.*)$/m) ?? [])[1] ?? "?" });
  }
  const stat = read("/sys/fs/cgroup/memory.stat");
  const mb = (k: string) => { const v = stat?.match(new RegExp(`^${k} (\\d+)`, "m"))?.[1]; return v ? +(Number(v) / 1048576).toFixed(1) : null; };
  const cur = read("/sys/fs/cgroup/memory.current"), peak = read("/sys/fs/cgroup/memory.peak"), max = read("/sys/fs/cgroup/memory.max");
  // Where does anonymous memory live? Largest mappings by resident size, plus V8's own accounting.
  const maps: { sizeMB: number; rssMB: number; anonMB: number; perm: string; path: string }[] = [];
  const smaps = read("/proc/self/smaps");
  if (smaps) {
    let cur: (typeof maps)[number] | null = null;
    for (const line of smaps.split("\n")) {
      const h = line.match(/^[0-9a-f]+-[0-9a-f]+ (\S+) \S+ \S+ \S+ \S+\s*(.*)$/);
      if (h) { cur = { sizeMB: 0, rssMB: 0, anonMB: 0, perm: h[1], path: h[2] || "[anon]" }; maps.push(cur); continue; }
      const kv = line.match(/^(Size|Rss|Anonymous):\s+(\d+) kB/);
      if (kv && cur) { const v = +(Number(kv[2]) / 1024).toFixed(1); if (kv[1] === "Size") cur.sizeMB = v; else if (kv[1] === "Rss") cur.rssMB = v; else cur.anonMB = v; }
    }
  }
  const byPath = new Map<string, number>();
  for (const m of maps) byPath.set(m.path.replace(/\/[^/]*$/, "/…") || m.path, (byPath.get(m.path.replace(/\/[^/]*$/, "/…") || m.path) ?? 0) + m.anonMB);
  const hs = v8.getHeapStatistics();
  const spaces = v8.getHeapSpaceStatistics().map((x) => ({ space: x.space_name, usedMB: +(x.space_used_size / 1048576).toFixed(1), committedMB: +(x.physical_space_size / 1048576).toFixed(1) }));
  // Table names only (does the platform add its own bookkeeping tables to our file?) and the file sizes.
  let tables: string[] = [], files: Record<string, number> = {};
  try {
    const f = databaseFile(); const db = new Database(f, { readonly: true });
    tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((t) => t.name).filter((n) => n.startsWith("_"));
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) { try { files[`daymark.db${suffix}`] = +(fs.statSync(f + suffix).size / 1048576).toFixed(2); } catch { /* absent */ } }
  } catch { /* ignore */ }
  const mu = process.memoryUsage();
  return Response.json({
    // proxy headers that identify the client (names and values of forwarding headers only; no cookies or auth)
    proxyHeaders: Object.fromEntries([...req.headers].filter(([k]) => /^(x-forwarded-|x-real-ip|forwarded|cf-connecting|true-client|x-client|fly-client|via)/i.test(k))),
    sqlite: { underscoreTables: tables, filesMB: files },
    now: new Date().toISOString(), uptimeS: Math.round(process.uptime()), node: process.version,
    cgroup: { currentMB: cur ? +(Number(cur) / 1048576).toFixed(1) : null, peakMB: peak ? +(Number(peak) / 1048576).toFixed(1) : null, limitMB: max && /^\d+$/.test(max) ? +(Number(max) / 1048576).toFixed(1) : null, anonMB: mb("anon"), fileMB: mb("file"), kernelMB: mb("kernel"), slabMB: mb("slab") },
    process: { rssMB: +(mu.rss / 1048576).toFixed(1), heapUsedMB: +(mu.heapUsed / 1048576).toFixed(1), heapTotalMB: +(mu.heapTotal / 1048576).toFixed(1), externalMB: +(mu.external / 1048576).toFixed(1), arrayBuffersMB: +(mu.arrayBuffers / 1048576).toFixed(1) },
    v8: { mallocedMB: +(hs.malloced_memory / 1048576).toFixed(1), peakMallocedMB: +(hs.peak_malloced_memory / 1048576).toFixed(1), externalMB: +(hs.external_memory / 1048576).toFixed(1), heapLimitMB: +(hs.heap_size_limit / 1048576).toFixed(0), spaces },
    anonMappings: maps.filter((m) => m.anonMB >= 4).sort((a, b) => b.anonMB - a.anonMB).slice(0, 12),
    anonByPath: [...byPath.entries()].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8),
    tree: procs, treeRssMB: +procs.reduce((a, p) => a + p.rssMB, 0).toFixed(1), treeAnonMB: +procs.reduce((a, p) => a + p.anonMB, 0).toFixed(1),
  });
}
