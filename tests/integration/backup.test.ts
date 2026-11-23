import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { databaseFile } from "@/server/db-path";
import {
  backupFileName, decryptBackup, encryptBackup, parseBackupName, parseKey, restoreBackup, runBackup, selectRetention, snapshotDatabase, storageClient, verifyBackup,
} from "@/server/backup/core.mjs";
import { makeOrg } from "./helpers";

// ── a stand-in for Embarko's file storage: same paths, bearer auth, allowed extensions, public download URLs ──
type Stored = { id: string; filename: string; bytes: Buffer; createdAt: string };
function fakeStorage() {
  const files = new Map<string, Stored>();
  let failUploads = false;
  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url!, "http://x");
    const dl = /^\/dl\/(.+)$/.exec(url.pathname);
    if (dl) { const f = files.get(dl[1]); if (!f) return send(404, {}); res.writeHead(200); return res.end(f.bytes); }
    if (req.headers.authorization !== "Bearer tok-test") return send(401, { error: "unauthorized" });
    const m = /^\/apps\/([^/]+)\/files(?:\/(.+))?$/.exec(url.pathname);
    if (!m) return send(404, {});
    if (req.method === "GET") return send(200, { files: [...files.values()].reverse().map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.bytes.length, url: `http://127.0.0.1:${port}/dl/${f.id}`, createdAt: f.createdAt })) });
    if (req.method === "DELETE") { files.delete(m[2]); return send(200, { ok: true }); }
    if (req.method === "PUT") {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      if (failUploads) return send(503, { error: "down" });
      if (!/\.(gz|zip|png|txt)$/.test(m[2])) return send(400, { code: "file_type_not_allowed" });
      const id = `f${files.size}${randomBytes(4).toString("hex")}`;
      files.set(id, { id, filename: m[2], bytes: Buffer.concat(chunks), createdAt: new Date().toISOString() });
      return send(201, { id, url: `http://127.0.0.1:${port}/dl/${id}`, sizeBytes: files.get(id)!.bytes.length });
    }
    send(405, {});
  });
  let port = 0;
  return {
    files, setFail: (v: boolean) => (failUploads = v),
    start: () => new Promise<void>((r) => server.listen(0, "127.0.0.1", () => { port = (server.address() as { port: number }).port; r(); })),
    stop: () => new Promise<void>((r) => server.close(() => r())),
    get url() { return `http://127.0.0.1:${port}`; },
  };
}

const KEY = parseKey(randomBytes(32).toString("base64"));
const store = fakeStorage();
let dir: string;
beforeAll(async () => { await store.start(); dir = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-bk-")); });
afterAll(async () => { await store.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
const client = () => storageClient({ url: store.url, token: "tok-test", app: "daymark" });

const counts = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    const t = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    return Object.fromEntries(t.map((n) => [n, (db.prepare(`SELECT COUNT(*) AS c FROM "${n}"`).get() as { c: number }).c]));
  } finally { db.close(); }
};

describe("backup encryption", () => {
  it("round-trips, and the stored bytes reveal nothing", () => {
    const plain = Buffer.from("SQLite format 3\0 secret employee data: Alice blocked on payroll");
    const sealed = encryptBackup(plain, KEY);
    expect(decryptBackup(sealed, KEY).equals(plain)).toBe(true);
    expect(sealed.includes(Buffer.from("Alice"))).toBe(false);
    expect(sealed.includes(Buffer.from("SQLite format"))).toBe(false);
    expect(encryptBackup(plain, KEY).equals(sealed)).toBe(false); // fresh nonce every time
  });
  it("refuses a wrong key, a tampered file and a stranger's file", () => {
    const sealed = encryptBackup(Buffer.from("data"), KEY);
    expect(() => decryptBackup(sealed, parseKey(randomBytes(32).toString("hex")))).toThrow(/wrong key or the file was altered/);
    const bad = Buffer.from(sealed); bad[bad.length - 20] ^= 1;
    expect(() => decryptBackup(bad, KEY)).toThrow(/wrong key or the file was altered/);
    expect(() => decryptBackup(Buffer.from("hello world, definitely not a backup file at all........"), KEY)).toThrow(/Not a Daymark backup/);
  });
  it("accepts base64 or hex keys of 32 bytes only", () => {
    expect(() => parseKey("short")).toThrow(/32 random bytes/);
    expect(() => parseKey(undefined)).toThrow(/32 random bytes/);
    expect(parseKey(randomBytes(32).toString("hex")).length).toBe(32);
  });
});

describe("backup names and retention", () => {
  it("uses names Embarko storage accepts, with a random part, and parses them back", () => {
    const d = new Date("2026-11-23T02:30:05Z");
    const n = backupFileName(d, "0123456789abcdef");
    expect(n).toBe("dmbk-20261123-023005-0123456789abcdef.gz");
    expect(parseBackupName(n)?.toISOString()).toBe(d.toISOString());
    expect(parseBackupName("logo.png")).toBeNull();
  });
  it("keeps 7 daily + 4 weekly, always the newest, and never touches foreign files", () => {
    const files = [] as { id: string; filename: string }[];
    for (let i = 0; i < 60; i++) { const d = new Date(Date.UTC(2026, 10, 23 - i, 2, 30)); files.push({ id: `b${i}`, filename: backupFileName(d, "aaaaaaaaaaaaaaaa") }); }
    files.push({ id: "logo", filename: "logo.png" });
    const { keep, remove } = selectRetention(files);
    expect(keep.has("b0")).toBe(true);
    for (let i = 0; i < 7; i++) expect(keep.has(`b${i}`)).toBe(true);        // last 7 days
    expect(keep.size).toBeGreaterThanOrEqual(8);
    expect(keep.size).toBeLessThanOrEqual(11);                                // 7 daily + at most 4 more weekly
    expect(remove.find((f) => f.id === "logo")).toBeUndefined();              // not ours: left alone
    expect(remove.length).toBe(60 - keep.size);
  });
});

describe("backup → verify → retention → restore drill (real SQLite file, fake Embarko storage)", () => {
  it("backs up a live database, stores only ciphertext, verifies it, and prunes", async () => {
    await makeOrg("BackupA"); await makeOrg("BackupB");
    // pre-existing old backups that retention should prune
    for (let i = 20; i < 32; i++) await client().upload(backupFileName(new Date(Date.UTC(2026, 9, 30 - i, 2, 0)), randomBytes(8).toString("hex")), Buffer.from("old"));
    const r = await runBackup({ dbFile: databaseFile(), key: KEY, storage: client() });
    expect(r).toMatchObject({ ok: true, verified: true });
    expect(r.organizations).toBeGreaterThanOrEqual(2);
    expect(r.deleted).toBeGreaterThan(0);
    const stored = [...store.files.values()].find((f) => f.filename === r.filename)!;
    expect(stored.bytes.includes(Buffer.from("SQLite format"))).toBe(false);
    expect(stored.bytes.includes(Buffer.from("BackupA"))).toBe(false);
    expect(verifyBackup(stored.bytes, KEY, databaseFile()).organizations).toBe(r.organizations);
  });

  it("restore drill: damage the database, restore the backup, get every table back", async () => {
    const live = path.join(dir, "drill.db");
    snapshotDatabase(databaseFile(), live);
    const before = counts(live);
    expect(before.Organization).toBeGreaterThanOrEqual(2);
    const run = await runBackup({ dbFile: live, key: KEY, storage: client() });

    // disaster: lose rows and a whole table
    const db = new Database(live);
    db.pragma("foreign_keys = OFF");
    db.exec(`DELETE FROM "Membership"; DELETE FROM "AuditLog"; DROP TABLE "RequestThrottle";`);
    db.close();
    expect(counts(live).Membership).toBe(0);

    const r = await restoreBackup({ dbFile: live, key: KEY, storage: client(), name: run.filename });
    expect(r.filename).toBe(run.filename);
    expect(counts(live)).toEqual(before);
    expect(r.previous && fs.existsSync(r.previous)).toBe(true);               // the damaged copy is kept, not destroyed
    const check = new Database(live, { readonly: true }); expect(check.pragma("integrity_check", { simple: true })).toBe("ok"); check.close();
  });

  it("restore with the wrong key fails and leaves the database untouched", async () => {
    const live = path.join(dir, "wrongkey.db");
    snapshotDatabase(databaseFile(), live);
    const before = counts(live);
    await expect(restoreBackup({ dbFile: live, key: parseKey(randomBytes(32).toString("hex")), storage: client() })).rejects.toThrow(/wrong key/);
    expect(counts(live)).toEqual(before);
  });

  it("a failed upload throws and deletes nothing", async () => {
    const n = store.files.size;
    store.setFail(true);
    await expect(runBackup({ dbFile: databaseFile(), key: KEY, storage: client() })).rejects.toThrow(/upload failed/);
    store.setFail(false);
    expect(store.files.size).toBe(n);
  });

  it("'latest' picks the newest backup", async () => {
    const live = path.join(dir, "latest.db");
    snapshotDatabase(databaseFile(), live);
    const r = await restoreBackup({ dbFile: live, key: KEY, storage: client() });
    const newest = [...store.files.values()].map((f) => f.filename).filter((n) => parseBackupName(n)).sort((a, b) => +parseBackupName(b)! - +parseBackupName(a)!)[0];
    expect(r.filename).toBe(newest);
  });
});

describe("backup route", () => {
  it("is closed without the scheduler secret, and reports a missing key instead of pretending", async () => {
    const { GET } = await import("@/app/api/cron/backup/route");
    const req = (auth?: string) => new Request("http://x/api/cron/backup", { headers: auth ? { authorization: auth } : {} });
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    const saved = process.env.BACKUP_ENCRYPTION_KEY; delete process.env.BACKUP_ENCRYPTION_KEY;
    expect((await GET(req(`Bearer ${process.env.CRON_SECRET}`))).status).toBe(503);
    process.env.BACKUP_ENCRYPTION_KEY = saved;
  });
  it("runs a real backup when configured", async () => {
    const { GET } = await import("@/app/api/cron/backup/route");
    Object.assign(process.env, { BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), STORAGE_URL: store.url, STORAGE_TOKEN: "tok-test", APP_NAME: "daymark" });
    const res = await GET(new Request("http://x/api/cron/backup", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, verified: true });
    expect(JSON.stringify(body)).not.toMatch(/tok-test|127\.0\.0\.1/);          // nothing sensitive in the response
    delete process.env.BACKUP_ENCRYPTION_KEY; delete process.env.STORAGE_URL; delete process.env.STORAGE_TOKEN; delete process.env.APP_NAME;
  });
});
