// Safe database migration for Embarko (and any SQLite deployment).
//
//   node scripts/safe-migrate.mjs
//
// Applies the committed migration files with `prisma migrate deploy` (never `db push` / `migrate dev`:
// Embarko keeps its own bookkeeping tables in the file and schema-diff tools would try to drop them).
// If migrations are pending and a database already exists, it first takes a consistent snapshot
// (VACUUM INTO). If a migration fails, the snapshot is put back, so the database is never left
// half-migrated, and the process exits non-zero so the app does not start on a broken schema.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

export function resolveDbFile(env = process.env) {
  const url = env.DATABASE_URL?.trim();
  if (url) return path.resolve(url.replace(/^file:/, ""));
  return path.resolve(env.DATA_DIR?.trim() || "./data", "daymark.db");
}

function pendingMigrations(dbFile, migrationsDir) {
  const onDisk = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+_/.test(d.name)).map((d) => d.name).sort();
  if (!fs.existsSync(dbFile)) return { onDisk, pending: onDisk, failed: [] };
  const db = new Database(dbFile, { readonly: true });
  try {
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`).get();
    if (!has) return { onDisk, pending: onDisk, failed: [] };
    const rows = db.prepare(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`).all();
    const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    return { onDisk, pending: onDisk.filter((m) => !done.has(m)), failed };
  } finally { db.close(); }
}

function snapshot(dbFile, dir, label) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-before-${label}.db`);
  const db = new Database(dbFile);
  try { db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); } finally { db.close(); }
  const check = new Database(target, { readonly: true });
  try { if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("snapshot failed its integrity check"); } finally { check.close(); }
  // keep the 5 newest snapshots
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) fs.rmSync(path.join(dir, old), { force: true });
  return target;
}

function restore(dbFile, snap) {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(snap, dbFile);
  const db = new Database(dbFile, { readonly: true });
  try { return db.pragma("integrity_check", { simple: true }) === "ok"; } finally { db.close(); }
}

// During a redeploy the previous instance can still hold the database for a few seconds ("database is locked").
// That is not a failed migration: nothing has been applied, so we wait and retry, and never restore over a file
// another process may still be writing to.
const LOCKED = /database is locked|SQLITE_BUSY|database table is locked/i;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function safeMigrate({ cwd = process.cwd(), env = process.env, log = console.log, lockRetries = 8, lockWaitMs = 7500 } = {}) {
  const dbFile = resolveDbFile(env);
  const migrationsDir = path.resolve(cwd, "prisma/migrations");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  /** Run a database step; if another process has the file locked, wait and retry (never throws for a lock: returns BUSY). */
  const BUSY = Symbol("busy");
  const whileBusy = (fn) => {
    for (let t = 0; ; t++) {
      try { return fn(); }
      catch (e) {
        if (!(LOCKED.test(String(e?.message)) || e?.code === "SQLITE_BUSY")) throw e;
        if (t >= lockRetries) return BUSY;
        log(`[migrate] database is busy (another process has it open); waiting ${lockWaitMs / 1000}s, attempt ${t + 1}/${lockRetries}`);
        sleepSync(lockWaitMs);
      }
    }
  };
  const stillLocked = (what) => { log(`[migrate] the database stayed locked while ${what}; nothing was changed. Not starting; it will be retried.`); return { ok: false, restored: false, locked: true, snapshot: null, error: "database is locked" }; };
  const state = whileBusy(() => pendingMigrations(dbFile, migrationsDir));
  if (state === BUSY) return stillLocked("checking its state");
  const { pending, failed } = state;
  if (failed.length) log(`[migrate] warning: earlier failed migration(s) recorded: ${failed.join(", ")}`);
  if (pending.length === 0 && failed.length === 0) { log("[migrate] database is up to date"); return { ok: true, applied: [], snapshot: null }; }

  const existed = fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0;
  let snap = null;
  if (existed) {
    // Taking the snapshot needs a read of the file too; wait for a busy database the same way.
    snap = whileBusy(() => snapshot(dbFile, path.join(path.dirname(dbFile), "pre-migrate"), pending[0] ?? "retry"));
    if (snap === BUSY) return stillLocked("taking the safety snapshot");
    log(`[migrate] pending: ${pending.join(", ")}; snapshot saved: ${path.basename(snap)}`);
  } else {
    log(`[migrate] new database; applying: ${pending.join(", ")}`);
  }

  const cli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
  let r, tries = 0;
  for (;;) {
    r = spawnSync(process.execPath, [cli, "migrate", "deploy"], { cwd, env: { ...env, DATABASE_URL: `file:${dbFile}` }, encoding: "utf8" });
    if (r.status === 0) break;
    const out = `${r.stderr ?? ""}${r.stdout ?? ""}`;
    if (LOCKED.test(out) && tries < lockRetries) { tries++; log(`[migrate] database is busy (another process has it open); waiting ${lockWaitMs / 1000}s, attempt ${tries}/${lockRetries}`); sleepSync(lockWaitMs); continue; }
    break;
  }
  if (r.status === 0) { log(`[migrate] applied: ${pending.join(", ")}${tries ? ` (after ${tries} wait${tries === 1 ? "" : "s"})` : ""}`); return { ok: true, applied: pending, snapshot: snap, waited: tries }; }

  if (LOCKED.test(`${r.stderr ?? ""}${r.stdout ?? ""}`)) {
    // Nothing was applied, and another process still owns the file: leave it exactly as it is. The platform restarts us.
    log("[migrate] the database stayed locked; nothing was changed. Not starting; it will be retried.");
    return { ok: false, restored: false, locked: true, snapshot: snap, error: r.stderr || r.stdout };
  }
  log(`[migrate] FAILED:\n${(r.stderr || r.stdout || "").trim().split("\n").slice(-12).join("\n")}`);
  if (snap) {
    const ok = restore(dbFile, snap);
    log(ok ? "[migrate] database restored from the snapshot taken before this attempt" : "[migrate] RESTORE FAILED INTEGRITY CHECK: keep the snapshot and investigate");
    return { ok: false, restored: ok, snapshot: snap, error: r.stderr || r.stdout };
  }
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true }); // brand-new database: nothing to keep
  return { ok: false, restored: false, snapshot: null, error: r.stderr || r.stdout };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = safeMigrate();
  process.exit(r.ok ? 0 : 1);
}
