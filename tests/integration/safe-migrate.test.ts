import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
// @ts-expect-error plain ESM script without types
import { safeMigrate } from "../../scripts/safe-migrate.mjs";

const repo = path.resolve(import.meta.dirname, "../..");

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-mig-"));
  fs.mkdirSync(path.join(dir, "prisma"));
  fs.cpSync(path.join(repo, "prisma/migrations"), path.join(dir, "prisma/migrations"), { recursive: true });
  fs.copyFileSync(path.join(repo, "prisma/schema.prisma"), path.join(dir, "prisma/schema.prisma"));
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "prisma.config.ts"),
    `import { defineConfig } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_URL ?? "" } });\n`);
  const dbFile = path.join(dir, "data", "daymark.db");
  return { dir, dbFile, env: { ...process.env, DATABASE_URL: `file:${dbFile}` } as NodeJS.ProcessEnv, log: () => undefined };
}
const addMigration = (dir: string, name: string, sql: string) => {
  fs.mkdirSync(path.join(dir, "prisma/migrations", name));
  fs.writeFileSync(path.join(dir, "prisma/migrations", name, "migration.sql"), sql);
};
const q = <T>(file: string, sql: string) => { const db = new Database(file, { readonly: true }); try { return db.prepare(sql).all() as T[]; } finally { db.close(); } };

describe("safe migrations", () => {
  it("creates a fresh database, is a no-op when up to date, snapshots before pending migrations, and rolls back a failed one", () => {
    const p = project();
    const opts = { cwd: p.dir, env: p.env, log: p.log };

    // 1. fresh database from the committed migrations (no snapshot: nothing to protect)
    const first = safeMigrate(opts);
    expect(first).toMatchObject({ ok: true, snapshot: null });
    expect(first.applied.length).toBeGreaterThanOrEqual(1);
    expect(q<{ name: string }>(p.dbFile, `SELECT name FROM sqlite_master WHERE name='Organization'`)).toHaveLength(1);

    // 2. nothing pending -> no-op
    expect(safeMigrate(opts)).toMatchObject({ ok: true, applied: [], snapshot: null });

    // put a row in so we can prove data survives
    const db = new Database(p.dbFile); db.exec(`INSERT INTO "Organization" ("id","name","timezone","updatedAt") VALUES ('o1','Keep me','UTC','2026-01-01T00:00:00.000Z')`); db.close();

    // 3. a good pending migration: snapshot first, then applied
    addMigration(p.dir, "29990101000000_add_probe", `CREATE TABLE "Probe" ("id" TEXT NOT NULL PRIMARY KEY);\n`);
    const good = safeMigrate(opts);
    expect(good.ok).toBe(true);
    expect(good.applied).toEqual(["29990101000000_add_probe"]);
    expect(good.snapshot && fs.existsSync(good.snapshot)).toBe(true);
    expect(q(p.dbFile, `SELECT name FROM sqlite_master WHERE name='Probe'`)).toHaveLength(1);

    // 4. a migration that fails half-way: the database is restored exactly as it was
    addMigration(p.dir, "29990102000000_broken", `CREATE TABLE "Half" ("id" TEXT NOT NULL PRIMARY KEY);\nINSERT INTO "DoesNotExist" VALUES (1);\n`);
    const bad = safeMigrate(opts);
    expect(bad).toMatchObject({ ok: false, restored: true });
    expect(q(p.dbFile, `SELECT name FROM sqlite_master WHERE name='Half'`)).toHaveLength(0);          // half-applied table gone
    expect(q(p.dbFile, `SELECT name FROM sqlite_master WHERE name='Probe'`)).toHaveLength(1);         // earlier migration intact
    expect(q<{ name: string }>(p.dbFile, `SELECT name FROM "Organization" WHERE id='o1'`)[0]?.name).toBe("Keep me"); // data intact
    expect(q<{ migration_name: string }>(p.dbFile, `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL`)).toHaveLength(0);
    const check = new Database(p.dbFile, { readonly: true }); expect(check.pragma("integrity_check", { simple: true })).toBe("ok"); check.close();

    fs.rmSync(p.dir, { recursive: true, force: true });
  }, 120_000);
});
