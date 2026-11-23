import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { filterOptions, listTeamUpdates, teamHighlights, teamOverview, teamTrend } from "@/server/services/team-updates";
import { listObjectives } from "@/server/services/goals";
import { orgTree } from "@/server/services/org-tree";
import { makeOrg } from "./helpers";

/**
 * A 300-person company with 50 departments of 2-8 people (and uneven teams), 30 days of updates, a 4-level management
 * chain and a goal tree. Rows are written straight to the database (fast); the services under test are the real ones.
 */
const NOW = new Date("2026-11-13T09:00:00Z");
const id = () => `s${randomBytes(9).toString("hex")}`;
const PEOPLE = 300, DEPTS = 50;

async function bigCompany() {
  const { admin, organizationId } = await makeOrg("Big");
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  const now = new Date();
  const depts = Array.from({ length: DEPTS }, (_, i) => ({ id: id(), organizationId, name: `Dept ${i}` }));
  await prisma.department.createMany({ data: depts });
  const teams = depts.map((d, i) => ({ id: id(), organizationId, departmentId: d.id, name: `Team ${i}` }));
  await prisma.team.createMany({ data: teams });
  const users = Array.from({ length: PEOPLE }, (_, i) => ({ id: id(), name: `Person ${String(i).padStart(3, "0")}`, email: `p${i}-${randomBytes(3).toString("hex")}@big.test`, updatedAt: now }));
  await prisma.user.createMany({ data: users });
  // 1 CEO (the admin), 10 VPs, 40 leads, the rest individual contributors: a 4-level chain
  const ms = users.map((u, i) => ({ id: id(), userId: u.id, organizationId, role: (i < 50 ? "MANAGER" : "EMPLOYEE") as "MANAGER" | "EMPLOYEE", teamId: teams[i % DEPTS].id, departmentId: depts[i % DEPTS].id, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: now }));
  await prisma.membership.createMany({ data: ms });
  const adminId = admin.membershipId;
  for (let i = 0; i < ms.length; i++) {
    const managerId = i < 10 ? adminId : i < 50 ? ms[i % 10].id : ms[10 + (i % 40)].id;
    await prisma.membership.update({ where: { id: ms[i].id }, data: { managerId } });
  }
  // 30 working-ish days of updates for ~92% of people
  const days = Array.from({ length: 30 }, (_, d) => new Date(Date.UTC(2026, 10, 13 - d)).toISOString().slice(0, 10));
  const updates = [] as { id: string; organizationId: string; membershipId: string; updateDate: string; status: "SUBMITTED"; firstSubmittedAt: Date; updatedAt: Date; hasBlockers: boolean }[];
  ms.forEach((m, i) => days.forEach((day, d) => { if ((i * 7 + d * 3) % 13 !== 0) updates.push({ id: id(), organizationId, membershipId: m.id, updateDate: day, status: "SUBMITTED", firstSubmittedAt: now, updatedAt: now, hasBlockers: (i + d) % 17 === 0 }); }));
  for (let i = 0; i < updates.length; i += 2000) await prisma.dailyUpdate.createMany({ data: updates.slice(i, i + 2000) });
  await prisma.updateItem.createMany({ data: updates.slice(0, 4000).map((u) => ({ id: id(), organizationId, dailyUpdateId: u.id, section: "WORKED_ON" as const, position: 0, text: "Worked on things" })) });
  return { admin, organizationId, ms, updates: updates.length };
}

describe("a 300-person company with 50 departments", () => {
  it("the team views stay fast, correct and paged", async () => {
    const c = await bigCompany();
    expect(await prisma.membership.count({ where: { organizationId: c.organizationId } })).toBe(PEOPLE + 1);
    const t = async <T>(label: string, fn: () => Promise<T>, limitMs: number) => { const s = Date.now(); const r = await fn(); const ms = Date.now() - s; if (process.env.SCALE_LOG) console.log(`SCALE ${label}: ${ms} ms`); expect(ms, `${label} took ${ms} ms`).toBeLessThan(limitMs); return r; };

    // a whole quarter's worth of range is allowed now, and results come back in pages
    const month = await t("31-day list", () => listTeamUpdates(c.admin, { from: "2026-10-14", to: "2026-11-13" }, { now: NOW }), 4000);
    expect(month.total).toBeGreaterThan(8000);                    // far above the old 500-row cap
    expect(month.rows).toHaveLength(100);
    expect(month.totalPages).toBe(Math.ceil(month.total / 100));
    const last = await listTeamUpdates(c.admin, { from: "2026-10-14", to: "2026-11-13", page: month.totalPages }, { now: NOW });
    expect(last.rows.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const r of [...month.rows, ...(await listTeamUpdates(c.admin, { from: "2026-10-14", to: "2026-11-13", page: 2 }, { now: NOW })).rows]) { expect(seen.has(r.key)).toBe(false); seen.add(r.key); }  // pages never overlap
    const quarter = await t("92-day list", () => listTeamUpdates(c.admin, { from: "2026-08-14", to: "2026-11-13", pageSize: 200 }, { now: NOW }), 8000);
    expect(quarter.rows).toHaveLength(200);
    await expect(listTeamUpdates(c.admin, { from: "2026-01-01", to: "2026-11-13" }, { now: NOW })).rejects.toMatchObject({ status: 400 }); // beyond a quarter

    await t("overview", () => teamOverview(c.admin, { now: NOW }), 2500);
    await t("trend", () => teamTrend(c.admin, { now: NOW }), 2500);
    await t("highlights", () => teamHighlights(c.admin, { now: NOW }), 2500);
    await t("filter options", () => filterOptions(c.admin), 2500);
  }, 120_000);

  it("a manager's whole subtree and the org chart resolve quickly across four management levels", async () => {
    const c = await bigCompany();
    const t0 = Date.now();
    const tree = await orgTree(c.admin, { now: NOW });
    const all = (n: { children: unknown[] }[]): number => n.reduce((s, x) => s + 1 + all(x.children as { children: unknown[] }[]), 0);
    expect(all(tree.roots)).toBe(PEOPLE + 1);
    expect(Date.now() - t0).toBeLessThan(3000);
    // a VP's view covers their branch only
    const vp = c.ms[0];
    const vpCtx = { membershipId: vp.id, organizationId: c.organizationId, role: "MANAGER" as const };
    const s = Date.now();
    const list = await listTeamUpdates(vpCtx, { from: "2026-11-13", to: "2026-11-13" }, { now: NOW });
    expect(Date.now() - s).toBeLessThan(3000);
    expect(list.total).toBeGreaterThan(0);
    expect(list.total).toBeLessThan(PEOPLE);                                                   // not the whole company
    expect((await listObjectives(c.admin, {}, { now: NOW })).items).toHaveLength(0);
  }, 120_000);
});
