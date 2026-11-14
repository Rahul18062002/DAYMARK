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

export function safeMigrate({ cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  const dbFile = resolveDbFile(env);
  const migrationsDir = path.resolve(cwd, "prisma/migrations");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const { pending, failed } = pendingMigrations(dbFile, migrationsDir);
  if (failed.length) log(`[migrate] warning: earlier failed migration(s) recorded: ${failed.join(", ")}`);
  if (pending.length === 0 && failed.length === 0) { log("[migrate] database is up to date"); return { ok: true, applied: [], snapshot: null }; }

  const existed = fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0;
  let snap = null;
  if (existed) {
    snap = snapshot(dbFile, path.join(path.dirname(dbFile), "pre-migrate"), pending[0] ?? "retry");
    log(`[migrate] pending: ${pending.join(", ")}; snapshot saved: ${path.basename(snap)}`);
  } else {
    log(`[migrate] new database; applying: ${pending.join(", ")}`);
  }

  const cli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
  const r = spawnSync(process.execPath, [cli, "migrate", "deploy"], { cwd, env: { ...env, DATABASE_URL: `file:${dbFile}` }, encoding: "utf8" });
  if (r.status === 0) { log(`[migrate] applied: ${pending.join(", ")}`); return { ok: true, applied: pending, snapshot: snap }; }

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
