import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { updateSettings } from "@/server/services/organization";
import { createDepartment, createTeam } from "@/server/services/structure";
import {
  createKeyResult, createObjective, createTask, deleteKeyResult, deleteObjective, deleteTask, getObjective, listObjectives, myGoals, recordCheckIn, updateKeyResult, updateObjective, updateTask,
} from "@/server/services/goals";
import { addMember, makeOrg, type TestCtx } from "./helpers";

const NOW = new Date("2026-11-15T09:00:00Z"); // mid Q4 2026
const P = { periodStart: "2026-10-01", periodEnd: "2026-12-31" };
type A = TestCtx;
const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id).sort();

/**
 *  Admin (the CEO) ── "Grow revenue" (COMPANY)
 *   ├─ Mia (manager) ── "Win enterprise" (DEPARTMENT Eng) ── Max (manager) team goal "Ship v2" (TEAM Alpha) ── Eva (employee) individual goal
 *   Sam (employee, Ops, no manager) ── private individual goal
 */
async function world() {
  const { admin, organizationId } = await makeOrg("Okr");
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  const eng = await createDepartment(admin, { name: "Eng" });
  const ops = await createDepartment(admin, { name: "Ops" });
  const mia = (await addMember(admin, "MANAGER", { name: "Mia" })).ctx;
  const max = (await addMember(admin, "MANAGER", { name: "Max", managerId: mia.membershipId })).ctx;
  const alpha = await createTeam(admin, { name: "Alpha", departmentId: eng.id, managerId: max.membershipId });
  const gamma = await createTeam(admin, { name: "Gamma", departmentId: ops.id });
  const eva = (await addMember(admin, "EMPLOYEE", { name: "Eva", teamId: alpha.id, managerId: max.membershipId })).ctx;
  const sam = (await addMember(admin, "EMPLOYEE", { name: "Sam", teamId: gamma.id })).ctx;
  const co = await createObjective(admin, { title: "Grow revenue", level: "COMPANY", ...P });
  const dept = await createObjective(admin, { title: "Win enterprise", level: "DEPARTMENT", departmentId: eng.id, ownerId: mia.membershipId, parentId: co.id, ...P });
  const team = await createObjective(mia, { title: "Ship v2", level: "TEAM", teamId: alpha.id, ownerId: max.membershipId, parentId: dept.id, ...P });
  const mine = await createObjective(eva, { title: "Own the migration", level: "INDIVIDUAL", parentId: team.id, ...P });
  const priv = await createObjective(sam, { title: "Sam's private goal", level: "INDIVIDUAL", ...P });
  return { admin, organizationId, eng, ops, alpha, gamma, mia, max, eva, sam, co, dept, team, mine, priv };
}
const list = (a: A, f: object = {}) => listObjectives(a, f, { now: NOW });

describe("cascade and roll-up", () => {
  it("progress rolls from an individual's key result all the way to the company objective", async () => {
    const w = await world();
    const kr = await createKeyResult(w.eva, w.mine.id, { title: "Services migrated", startValue: 0, targetValue: 10, unit: "services" });
    await recordCheckIn(w.eva, kr.id, { value: 5, confidence: "ON_TRACK", comment: "half done" });
    const res = await list(w.admin);
    const get = (id: string) => res.items.find((i) => i.id === id)!;
    expect(get(w.mine.id).progress).toBe(50);
    expect(get(w.team.id).progress).toBe(50);      // its only measured child
    expect(get(w.dept.id).progress).toBe(50);
    expect(get(w.co.id).progress).toBe(50);
    expect(get(w.co.id).childCount).toBe(1);
    await recordCheckIn(w.eva, kr.id, { value: 10, confidence: "ON_TRACK" });
    expect((await list(w.admin)).items.find((i) => i.id === w.co.id)!.progress).toBe(100);
  });

  it("everyone sees the same numbers, even if they cannot read every goal underneath", async () => {
    const w = await world();
    const kr = await createKeyResult(w.eva, w.mine.id, { title: "x", startValue: 0, targetValue: 4 });
    await recordCheckIn(w.eva, kr.id, { value: 1 });
    const ceo = (await list(w.admin)).items.find((i) => i.id === w.co.id)!.progress;
    const sam = (await list(w.sam)).items.find((i) => i.id === w.co.id)!.progress;
    expect(sam).toBe(ceo);
    expect(ceo).toBe(25);
  });

  it("an objective can be moved under another, but never under itself or a descendant, or a lower level", async () => {
    const w = await world();
    await expect(updateObjective(w.admin, w.co.id, { parentId: w.mine.id })).rejects.toMatchObject({ status: 400 });      // loop
    await expect(updateObjective(w.admin, w.dept.id, { parentId: w.dept.id })).rejects.toMatchObject({ status: 400 });
    await expect(updateObjective(w.admin, w.dept.id, { parentId: w.team.id })).rejects.toMatchObject({ status: 400 });    // a dept goal under a team goal
    await expect(createObjective(w.admin, { title: "x", level: "COMPANY", parentId: w.team.id, ...P })).rejects.toMatchObject({ status: 400 });
    await updateObjective(w.admin, w.mine.id, { parentId: w.co.id });                                                      // fine: individual under company
    expect((await list(w.admin)).items.find((i) => i.id === w.mine.id)!.parentId).toBe(w.co.id);
  });

  it("deleting needs the goals below it gone first, and takes its key results and tasks with it", async () => {
    const w = await world();
    await expect(deleteObjective(w.admin, w.co.id)).rejects.toMatchObject({ status: 409 });
    const kr = await createKeyResult(w.eva, w.mine.id, { title: "k", startValue: 0, targetValue: 2 });
    const t = await createTask(w.eva, w.mine.id, { title: "do it", keyResultId: kr.id });
    await deleteObjective(w.eva, w.mine.id);
    expect(await prisma.keyResult.count({ where: { id: kr.id } })).toBe(0);
    expect(await prisma.workTask.count({ where: { id: t.id } })).toBe(0);
    expect(await prisma.keyResultCheckIn.count({ where: { keyResultId: kr.id } })).toBe(0);
  });
});

describe("who may do what", () => {
  it("company goals: admins create them, everyone sees them; managers and employees cannot create or edit them", async () => {
    const w = await world();
    await expect(createObjective(w.mia, { title: "x", level: "COMPANY", ...P })).rejects.toMatchObject({ status: 403 });
    await expect(createObjective(w.eva, { title: "x", level: "COMPANY", ...P })).rejects.toMatchObject({ status: 403 });
    await expect(updateObjective(w.mia, w.co.id, { title: "hijack" })).rejects.toMatchObject({ status: 403 });
    for (const who of [w.mia, w.eva, w.sam]) expect((await list(who)).items.some((i) => i.id === w.co.id)).toBe(true);
    expect((await getObjective(w.sam, w.co.id, { now: NOW })).objective.title).toBe("Grow revenue");
  });

  it("employees only set their own individual goals; managers only for themselves and their line", async () => {
    const w = await world();
    await expect(createObjective(w.eva, { title: "x", level: "TEAM", teamId: w.alpha.id, ...P })).rejects.toMatchObject({ status: 403 });
    await expect(createObjective(w.eva, { title: "x", level: "INDIVIDUAL", ownerId: w.sam.membershipId, ...P })).rejects.toMatchObject({ status: 403 });
    await expect(createObjective(w.max, { title: "x", level: "INDIVIDUAL", ownerId: w.sam.membershipId, ...P })).rejects.toMatchObject({ status: 403 });   // Sam is outside Max's line
    await expect(createObjective(w.max, { title: "for Eva", level: "INDIVIDUAL", ownerId: w.eva.membershipId, ...P })).resolves.toBeTruthy();
    await expect(createObjective(w.mia, { title: "for Eva via Max", level: "INDIVIDUAL", ownerId: w.eva.membershipId, ...P })).resolves.toBeTruthy(); // two levels down
  });

  it("visibility of non-company goals follows the company's visibility setting", async () => {
    const w = await world();
    // default OWN: Eva sees the company goal, her own goal, and her team/department goals — not Sam's
    expect((await list(w.eva)).items.map((i) => i.id)).toEqual(expect.arrayContaining([w.co.id, w.mine.id, w.team.id, w.dept.id]));
    expect((await list(w.eva)).items.some((i) => i.id === w.priv.id)).toBe(false);
    await expect(getObjective(w.eva, w.priv.id, { now: NOW })).rejects.toMatchObject({ status: 404 });
    // Sam's manager chain (none) / an unrelated manager cannot see it either
    expect((await list(w.max)).items.some((i) => i.id === w.priv.id)).toBe(false);
    // the admin sees everything
    expect((await list(w.admin)).items.length).toBe(5);
    // open the company up: peers can read each other's individual goals
    await updateSettings({ ...w.admin, userId: w.admin.userId }, { visibilityScope: "COMPANY" });
    expect((await list(w.eva)).items.some((i) => i.id === w.priv.id)).toBe(true);
  });

  it("a manager sees and manages goals for their whole reporting line", async () => {
    const w = await world();
    expect((await list(w.mia)).items.map((i) => i.id)).toEqual(expect.arrayContaining([w.mine.id, w.team.id]));   // Eva's goal is two levels below Mia
    const d = await getObjective(w.mia, w.mine.id, { now: NOW });
    expect(d.canManage).toBe(true);
    await updateObjective(w.mia, w.mine.id, { title: "Own the migration (renamed)" });
    expect((await getObjective(w.eva, w.mine.id, { now: NOW })).objective.title).toContain("renamed");
    expect((await getObjective(w.eva, w.dept.id, { now: NOW })).canManage).toBe(false);
  });

  it("another company sees none of it, and cannot touch it by id", async () => {
    const w = await world();
    const other = await makeOrg("Rival");
    const stranger = (await addMember(other.admin, "EMPLOYEE")).ctx;
    expect((await list(stranger)).items).toHaveLength(0);
    expect((await list(other.admin)).items).toHaveLength(0);
    for (const id of [w.co.id, w.mine.id]) {
      await expect(getObjective(other.admin, id, { now: NOW })).rejects.toMatchObject({ status: 404 });
      await expect(updateObjective(other.admin, id, { title: "x" })).rejects.toMatchObject({ status: 404 });
      await expect(deleteObjective(other.admin, id)).rejects.toMatchObject({ status: 404 });
    }
    await expect(createObjective(other.admin, { title: "x", level: "INDIVIDUAL", parentId: w.co.id, ...P })).rejects.toMatchObject({ status: 400 });  // cannot hang a goal under another company's
    await expect(createObjective(other.admin, { title: "x", level: "INDIVIDUAL", ownerId: w.eva.membershipId, ...P })).rejects.toMatchObject({ status: 400 });
    // the database itself refuses a cross-company parent
    await expect(prisma.objective.update({ where: { id: w.mine.id }, data: { parentId: (await createObjective(other.admin, { title: "theirs", level: "COMPANY", ...P })).id } })).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("key results, KPIs and check-ins", () => {
  it("records an append-only history, moves the current value and keeps KPI readings as a series", async () => {
    const w = await world();
    const kpi = await createKeyResult(w.admin, w.co.id, { title: "Monthly revenue", type: "NUMBER", startValue: 100, targetValue: 200, unit: "k", isKpi: true });
    for (const [v, c] of [[120, "ON_TRACK"], [135, "AT_RISK"], [160, "ON_TRACK"]] as const) await recordCheckIn(w.admin, kpi.id, { value: v, confidence: c, comment: `reading ${v}` });
    const d = await getObjective(w.admin, w.co.id, { now: NOW });
    const k = d.keyResults[0];
    expect(k).toMatchObject({ currentValue: 160, progress: 60, isKpi: true, confidence: "ON_TRACK" });
    expect(k.checkIns.map((c) => c.value)).toEqual([160, 135, 120, 100]);                  // newest first, plus the creation reading
    expect(await prisma.keyResultCheckIn.count({ where: { keyResultId: kpi.id } })).toBe(4);
  });

  it("measures decreasing targets, yes/no results, and refuses nonsense", async () => {
    const w = await world();
    const churn = await createKeyResult(w.admin, w.co.id, { title: "Churn", type: "PERCENT", startValue: 8, targetValue: 4 });
    await recordCheckIn(w.admin, churn.id, { value: 6 });
    const done = await createKeyResult(w.admin, w.co.id, { title: "Launch", type: "BOOLEAN" });
    await expect(recordCheckIn(w.admin, done.id, { value: 0.5 })).rejects.toMatchObject({ status: 400 });
    await recordCheckIn(w.admin, done.id, { value: 1 });
    const d = await getObjective(w.admin, w.co.id, { now: NOW });
    expect(d.keyResults.find((k) => k.title === "Churn")!.progress).toBe(50);
    expect(d.keyResults.find((k) => k.title === "Launch")!.progress).toBe(100);
    expect(d.objective.progress).toBe(75);                                                    // equal weights
    await expect(createKeyResult(w.admin, w.co.id, { title: "x", startValue: 5, targetValue: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(createKeyResult(w.admin, w.co.id, { title: "x" })).rejects.toMatchObject({ status: 400 });                  // no target
    await expect(recordCheckIn(w.admin, churn.id, { value: Number.NaN })).rejects.toBeTruthy();
  });

  it("only the key result's owner and managers can record progress; the owner can't edit its definition", async () => {
    const w = await world();
    const kr = await createKeyResult(w.max, w.team.id, { title: "Bugs fixed", startValue: 0, targetValue: 10, ownerId: w.eva.membershipId });
    await recordCheckIn(w.eva, kr.id, { value: 3 });                                          // the owner
    await recordCheckIn(w.mia, kr.id, { value: 4 });                                          // a manager above
    await expect(recordCheckIn(w.sam, kr.id, { value: 9 })).rejects.toMatchObject({ status: 404 });                 // cannot even see it
    await updateKeyResult(w.max, kr.id, { targetValue: 20 });
    await expect(updateKeyResult(w.eva, kr.id, { targetValue: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(deleteKeyResult(w.eva, kr.id)).rejects.toMatchObject({ status: 403 });
    expect((await getObjective(w.eva, w.team.id, { now: NOW })).keyResults[0].canCheckIn).toBe(true);
  });

  it("a finished or cancelled goal takes no more progress", async () => {
    const w = await world();
    const kr = await createKeyResult(w.eva, w.mine.id, { title: "k", startValue: 0, targetValue: 2 });
    await updateObjective(w.eva, w.mine.id, { status: "DONE" });
    await expect(recordCheckIn(w.eva, kr.id, { value: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await list(w.admin)).items.find((i) => i.id === w.mine.id)!.progress).toBe(100);   // DONE counts as 100
  });

  it("two simultaneous check-ins both land in the history and the last one wins the current value", async () => {
    const w = await world();
    const kr = await createKeyResult(w.admin, w.co.id, { title: "k", startValue: 0, targetValue: 100 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => recordCheckIn(w.admin, kr.id, { value: i + 1 })));
    expect(await prisma.keyResultCheckIn.count({ where: { keyResultId: kr.id } })).toBe(11);
    const cur = (await prisma.keyResult.findUniqueOrThrow({ where: { id: kr.id } })).currentValue;
    expect(cur).toBeGreaterThanOrEqual(1); expect(cur).toBeLessThanOrEqual(10);
  });
});

describe("tasks", () => {
  it("anyone who can see a goal can pick up a task; assignees move their own along; managers plan", async () => {
    const w = await world();
    const t = await createTask(w.sam, w.co.id, { title: "Help with onboarding deck" });                  // Sam picks up work under a company goal
    await expect(createTask(w.sam, w.co.id, { title: "x", assigneeId: w.eva.membershipId })).rejects.toMatchObject({ status: 403 });
    await updateTask(w.sam, t.id, { status: "IN_PROGRESS" });
    await updateTask(w.sam, t.id, { status: "DONE" });
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } })).doneAt).toBeTruthy();
    await expect(updateTask(w.sam, t.id, { title: "renamed" })).rejects.toMatchObject({ status: 403 });  // assignees do not re-plan
    await updateTask(w.admin, t.id, { title: "renamed", status: "TODO" });
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } })).doneAt).toBeNull();
    await updateTask(w.mia, (await createTask(w.max, w.team.id, { title: "assigned", assigneeId: w.eva.membershipId })).id, { dueDate: "2026-11-20" });
    const mine = await myGoals(w.eva, { now: NOW });
    expect(mine.tasks.map((x) => x.title)).toContain("assigned");
    expect(mine.objectives.map((o) => o.id)).toContain(w.mine.id);
    await deleteTask(w.sam, t.id);                                                                         // creator may delete their own
  });

  it("progress falls back to finished tasks when there are no key results, and tasks can't cross goals", async () => {
    const w = await world();
    for (const s of ["DONE", "DONE", "TODO", "TODO"] as const) { const t = await createTask(w.eva, w.mine.id, { title: s }); if (s === "DONE") await updateTask(w.eva, t.id, { status: "DONE" }); }
    expect((await list(w.eva)).items.find((i) => i.id === w.mine.id)!.progress).toBe(50);
    const kr = await createKeyResult(w.admin, w.co.id, { title: "k", startValue: 0, targetValue: 1 });
    await expect(createTask(w.eva, w.mine.id, { title: "x", keyResultId: kr.id })).rejects.toMatchObject({ status: 400 });   // that key result belongs to another goal
    const first = await createKeyResult(w.eva, w.mine.id, { title: "own kr", startValue: 0, targetValue: 1 });
    const t = await createTask(w.eva, w.mine.id, { title: "linked", keyResultId: first.id });
    await deleteKeyResult(w.eva, first.id);
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: t.id } })).keyResultId).toBeNull();                        // detached, not lost
  });
});

describe("period and audit", () => {
  it("lists the current quarter by default and other periods on request", async () => {
    const w = await world();
    await createObjective(w.admin, { title: "Next year", level: "COMPANY", periodStart: "2027-01-01", periodEnd: "2027-03-31" });
    const q = await list(w.admin);
    expect(q.period.label).toBe("Q4 2026");
    expect(q.items.some((i) => i.title === "Next year")).toBe(false);
    expect((await list(w.admin, { from: "2027-01-01", to: "2027-03-31" })).items.map((i) => i.title)).toEqual(["Next year"]);
    await expect(createObjective(w.admin, { title: "x", level: "COMPANY", periodStart: "2026-12-31", periodEnd: "2026-10-01" })).rejects.toBeTruthy();
  });
  it("filters to my goals and keeps the chain above them", async () => {
    const w = await world();
    const r = await list(w.eva, { mine: "1" });
    expect(ids(r)).toEqual([w.mine.id, w.team.id, w.dept.id, w.co.id].sort());                 // her goal plus the readable chain above it
  });
  it("writes an audit row for every change", async () => {
    const w = await world();
    const kr = await createKeyResult(w.admin, w.co.id, { title: "k", startValue: 0, targetValue: 10 });
    await recordCheckIn(w.admin, kr.id, { value: 2 });
    const t = await createTask(w.admin, w.co.id, { title: "t" });
    await updateTask(w.admin, t.id, { status: "DONE" });
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: w.organizationId, action: { startsWith: "goal." } }, select: { action: true } })).map((a) => a.action);
    for (const a of ["goal.created", "goal.keyresult.created", "goal.checkin", "goal.task.created", "goal.task.updated"]) expect(actions).toContain(a);
  });
});
