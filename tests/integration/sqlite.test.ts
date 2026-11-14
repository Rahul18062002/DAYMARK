import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { prisma } from "@/server/db";
import { databaseFile } from "@/server/db-path";
import { throttle } from "@/server/throttle";
import { createUpdate } from "@/server/services/updates";
import { updateMember } from "@/server/services/members";
import { addMember, makeOrg, uid } from "./helpers";

const raw = <T>(fn: (db: Database.Database) => T) => {
  const db = new Database(databaseFile(), { readonly: true });
  try { return fn(db); } finally { db.close(); }
};

describe("SQLite database", () => {
  it("fresh database: migrations applied once, WAL on, foreign keys on, integrity ok, no Postgres leftovers", async () => {
    await prisma.$queryRaw`SELECT 1`; // opening the app's connection switches the file to WAL
    raw((db) => {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const applied = db.prepare(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`).all() as { migration_name: string; finished_at: string | null; rolled_back_at: string | null }[];
      expect(applied.length).toBeGreaterThanOrEqual(1);
      expect(applied.every((m) => m.finished_at && !m.rolled_back_at)).toBe(true);
      const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name);
      for (const t of ["User", "Organization", "Membership", "DailyUpdate", "UpdateRevision", "IntegrationEvent", "IntegrationDelivery", "AuditLog", "JobLock", "RequestThrottle"]) expect(tables).toContain(t);
    });
  });

  it("data written through the app is durable: a brand-new connection to the file sees it", async () => {
    const { organizationId } = await makeOrg("Durable");
    const seen = raw((db) => db.prepare(`SELECT COUNT(*) AS n FROM "Membership" WHERE "organizationId" = ?`).get(organizationId) as { n: number });
    expect(seen.n).toBe(1);
  });

  it("the rate limiter counts exactly under parallel load", async () => {
    const key = `sqlite-throttle-${uid()}`;
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => throttle(key, 25, 60)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(25);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(15);
  });

  it("parallel submissions across organizations all land, each in its own organization", async () => {
    const orgs = await Promise.all([makeOrg("Alpha"), makeOrg("Bravo"), makeOrg("Charlie")]);
    const people = (await Promise.all(orgs.flatMap((o) => Array.from({ length: 4 }, () => addMember(o.admin, "EMPLOYEE").then((m) => m.ctx))))).flat();
    expect(people).toHaveLength(12);
    const results = await Promise.allSettled(people.map((p) => createUpdate(p, { sections: { workedOn: [`work ${p.membershipId}`] }, submit: true })));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    for (const o of orgs) {
      const rows = await prisma.dailyUpdate.findMany({ where: { organizationId: o.organizationId } });
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.status === "SUBMITTED")).toBe(true);
      // one revision per submission, original preserved
      expect(await prisma.updateRevision.count({ where: { organizationId: o.organizationId } })).toBe(4);
    }
  }, 120_000);

  it("a double-submit race for the same person and day creates exactly one update", async () => {
    const { admin } = await makeOrg("Racer");
    const { ctx } = await addMember(admin, "EMPLOYEE");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createUpdate(ctx, { sections: { workedOn: ["x"] }, submit: true })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    expect(await prisma.dailyUpdate.count({ where: { membershipId: ctx.membershipId } })).toBe(1);
  });

  it("two admins demoting each other at the same moment never leave the organization without an admin", async () => {
    const { admin } = await makeOrg("Admins");
    const second = (await addMember(admin, "ADMIN")).ctx;
    const results = await Promise.allSettled([
      updateMember(admin, second.membershipId, { role: "EMPLOYEE" }),
      updateMember(second, admin.membershipId, { role: "EMPLOYEE" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(await prisma.membership.count({ where: { organizationId: admin.organizationId, role: "ADMIN", status: "ACTIVE" } })).toBe(1);
  });

  it("a failed transaction rolls back completely", async () => {
    const { admin } = await makeOrg("Rollback");
    const before = await prisma.department.count({ where: { organizationId: admin.organizationId } });
    await expect(prisma.$transaction(async (tx) => {
      await tx.department.create({ data: { organizationId: admin.organizationId, name: `d-${uid()}` } });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await prisma.department.count({ where: { organizationId: admin.organizationId } })).toBe(before);
  });

  it("reads keep working while a write transaction is open (WAL)", async () => {
    const { admin } = await makeOrg("Wal");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const writer = prisma.$transaction(async (tx) => {
      await tx.department.create({ data: { organizationId: admin.organizationId, name: `d-${uid()}` } });
      await gate;
    }, { timeout: 20_000 });
    const n = raw((db) => (db.prepare(`SELECT COUNT(*) AS n FROM "Membership"`).get() as { n: number }).n); // separate connection, not blocked
    expect(n).toBeGreaterThan(0);
    release();
    await writer;
  });
});
