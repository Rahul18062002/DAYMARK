import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
// @ts-expect-error plain ESM script without types
import { safeMigrate } from "../../scripts/safe-migrate.mjs";

const repo = path.resolve(import.meta.dirname, "../..");

function project(only?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daymark-mig-"));
  fs.mkdirSync(path.join(dir, "prisma"));
  const src = path.join(repo, "prisma/migrations");
  fs.mkdirSync(path.join(dir, "prisma/migrations"));
  fs.copyFileSync(path.join(src, "migration_lock.toml"), path.join(dir, "prisma/migrations/migration_lock.toml"));
  const all = fs.readdirSync(src).filter((n) => /^\d+_/.test(n)).sort();
  for (const n of all.slice(0, only ?? all.length)) fs.cpSync(path.join(src, n), path.join(dir, "prisma/migrations", n), { recursive: true });
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

  it("upgrading a database that already holds data keeps every row (each later migration is tried against the earlier schema)", () => {
    const all = fs.readdirSync(path.join(repo, "prisma/migrations")).filter((n) => /^\d+_/.test(n)).sort();
    if (all.length < 2) return;
    const p = project(1);                                                       // the baseline only
    const opts = { cwd: p.dir, env: p.env, log: p.log };
    expect(safeMigrate(opts).ok).toBe(true);
    const now = "2026-11-01T00:00:00.000Z";
    const db = new Database(p.dbFile);
    db.exec(`
      INSERT INTO "User" ("id","name","email","updatedAt") VALUES ('u1','Una','una@x.test','${now}'),('u2','Uri','uri@x.test','${now}');
      INSERT INTO "Organization" ("id","name","timezone","updatedAt") VALUES ('o1','Org One','UTC','${now}');
      INSERT INTO "OrgSettings" ("organizationId","updatedAt") VALUES ('o1','${now}');
      INSERT INTO "Membership" ("id","userId","organizationId","role","updatedAt") VALUES ('m1','u1','o1','ADMIN','${now}'),('m2','u2','o1','EMPLOYEE','${now}');
      UPDATE "Membership" SET "managerId"='m1' WHERE "id"='m2';
      INSERT INTO "DailyUpdate" ("id","organizationId","membershipId","updateDate","status","updatedAt") VALUES ('d1','o1','m2','2026-11-01','SUBMITTED','${now}');
      INSERT INTO "UpdateItem" ("id","organizationId","dailyUpdateId","section","position","text") VALUES ('i1','o1','d1','WORKED_ON',0,'did things');
      INSERT INTO "AuditLog" ("id","organizationId","action","entityType") VALUES ('a1','o1','x','y');`);
    const tables = ["User", "Organization", "OrgSettings", "Membership", "DailyUpdate", "UpdateItem", "AuditLog"];
    const count = (d: Database.Database) => Object.fromEntries(tables.map((t) => [t, (d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]));
    const before = count(db); db.close();
    // now bring in every later migration
    for (const n of all.slice(1)) fs.cpSync(path.join(repo, "prisma/migrations", n), path.join(p.dir, "prisma/migrations", n), { recursive: true });
    const r = safeMigrate(opts);
    expect(r.ok).toBe(true);
    expect(r.snapshot && fs.existsSync(r.snapshot)).toBe(true);
    const after = new Database(p.dbFile, { readonly: true });
    expect(count(after)).toEqual(before);
    expect(after.pragma("foreign_key_check")).toEqual([]);
    expect(after.pragma("integrity_check", { simple: true })).toBe("ok");
    // relationships survived the table rebuilds
    expect((after.prepare(`SELECT "managerId" FROM "Membership" WHERE "id"='m2'`).get() as { managerId: string }).managerId).toBe("m1");
    expect((after.prepare(`SELECT "text" FROM "UpdateItem" WHERE "id"='i1'`).get() as { text: string }).text).toBe("did things");
    after.close();
    fs.rmSync(p.dir, { recursive: true, force: true });
  }, 180_000);
});
