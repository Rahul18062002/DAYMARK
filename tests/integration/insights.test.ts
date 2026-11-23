import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { compare, median, personInsights } from "@/server/services/insights";
import { updateSettings } from "@/server/services/organization";
import { createTeam } from "@/server/services/structure";
import { createKeyResult, createObjective, createTask, recordCheckIn, updateTask } from "@/server/services/goals";
import { addMember, makeOrg, type TestCtx } from "./helpers";

const NOW = new Date("2026-11-13T09:00:00Z");                 // Fri 13 Nov 2026 (IST morning)
const id = () => `i${randomBytes(8).toString("hex")}`;
/** Submitted updates for these YYYY-MM-DD days, written directly (the service limits back-dating to a week). */
async function report(p: TestCtx, days: string[], o: { late?: string[]; blockers?: string[] } = {}) {
  await prisma.dailyUpdate.createMany({ data: days.map((d) => ({ id: id(), organizationId: p.organizationId, membershipId: p.membershipId, updateDate: d, status: "SUBMITTED" as const, firstSubmittedAt: NOW, updatedAt: NOW, submittedLate: !!o.late?.includes(d), hasBlockers: !!o.blockers?.includes(d) })) });
}
const WEEKDAYS_4W = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]; // 19 working days before today

async function team() {
  const { admin, organizationId } = await makeOrg("Ins");
  const t = await createTeam(admin, { name: "Alpha" });
  const mgr = (await addMember(admin, "MANAGER", { name: "Moe" })).ctx;
  const a = (await addMember(admin, "EMPLOYEE", { name: "Ann", teamId: t.id, managerId: mgr.membershipId })).ctx;
  const b = (await addMember(admin, "EMPLOYEE", { name: "Bob", teamId: t.id, managerId: mgr.membershipId })).ctx;
  const c = (await addMember(admin, "EMPLOYEE", { name: "Cal" })).ctx;                                   // no team
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  return { admin, organizationId, t, mgr, a, b, c };
}

describe("consistency maths", () => {
  it("counts submitted vs expected working days, on-time share, streak and weekly rates", async () => {
    const w = await team();
    const skip = new Set(["2026-10-21", "2026-11-11"]);                                                   // two missed days
    await report(w.a, WEEKDAYS_4W.filter((d) => !skip.has(d)), { late: ["2026-10-22", "2026-10-23"] });
    const r = await personInsights(w.admin, w.a.membershipId, { now: NOW, weeks: 4 });
    expect(r.person).toMatchObject({ expectedDays: 19, submittedDays: 17, onTimeDays: 15 });
    expect(r.person.consistency).toBeCloseTo(89.5, 1);
    expect(r.person.onTimeRate).toBeCloseTo(88.2, 1);
    expect(r.person.streak).toBe(1);                                                                       // 12 Nov submitted, 11 Nov missed
    expect(r.person.weekly).toHaveLength(4);
    expect(r.person.weekly[0].rate).toBe(80);                                                              // week of 19 Oct: 4 of 5
    expect(r.person.weekly[3].rate).toBe(75);                                                              // week of 9 Nov: 3 of 4 (the 13th is today and not submitted)
  });

  it("today only counts once submitted, and nobody is 'missing' before they joined", async () => {
    const w = await team();
    await prisma.membership.update({ where: { id: w.b.membershipId }, data: { createdAt: new Date("2026-11-05T00:00:00Z") } });  // joined Thu 5 Nov
    await report(w.b, ["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    const r = await personInsights(w.admin, w.b.membershipId, { now: NOW, weeks: 4 });
    expect(r.person.expectedDays).toBe(7);                                                                 // 5,6,9,10,11,12 + today (submitted)
    expect(r.person.consistency).toBe(100);
    expect(r.person.streak).toBe(7);
  });

  it("median helper", () => { expect(median([])).toBeNull(); expect(median([5])).toBe(5); expect(median([1, 9, 3])).toBe(3); expect(median([1, 2, 3, 4])).toBe(2.5); });
});

describe("goal and task metrics", () => {
  it("shows progress of the goals a person owns and the tasks they finished", async () => {
    const w = await team();
    const P = { periodStart: "2026-10-01", periodEnd: "2026-12-31" };
    const g = await createObjective(w.a, { title: "Ann's goal", level: "INDIVIDUAL", ...P });
    const kr = await createKeyResult(w.a, g.id, { title: "k", startValue: 0, targetValue: 10 });
    await recordCheckIn(w.a, kr.id, { value: 6, confidence: "AT_RISK" });
    const t1 = await createTask(w.a, g.id, { title: "t1" }); const t2 = await createTask(w.a, g.id, { title: "t2", dueDate: "2026-11-01" });
    await updateTask(w.a, t1.id, { status: "DONE" });
    void t2;
    const r = await personInsights(w.admin, w.a.membershipId, { now: new Date() });   // tasks are stamped with the real clock
    expect(r.person.goals).toMatchObject({ owned: 1, avgProgress: 60 });
    expect(r.person.tasks.doneInWindow).toBe(1);
    expect(r.person.tasks.open).toBe(1);
    expect(r.goals.map((x) => x.title)).toEqual(["Ann's goal"]);
  });
});

describe("who may see whose numbers", () => {
  it("a manager sees their reports; a stranger employee gets nothing; yourself always works; other companies get 404", async () => {
    const w = await team();
    await expect(personInsights(w.mgr, w.a.membershipId, { now: NOW })).resolves.toBeTruthy();
    await expect(personInsights(w.mgr, w.c.membershipId, { now: NOW })).rejects.toMatchObject({ status: 404 });   // Cal is not in Moe's line
    await expect(personInsights(w.b, w.a.membershipId, { now: NOW })).rejects.toMatchObject({ status: 403 });     // peers under OWN visibility
    await expect(personInsights(w.b, w.b.membershipId, { now: NOW })).resolves.toBeTruthy();                       // but everyone can see themselves
    const other = await makeOrg("Outsider");
    await expect(personInsights(other.admin, w.a.membershipId, { now: NOW })).rejects.toMatchObject({ status: 404 });
  });

  it("peers can compare once the company opens visibility, and never see each other's blockers unless allowed", async () => {
    const w = await team();
    await report(w.a, WEEKDAYS_4W, { blockers: ["2026-11-10", "2026-11-12"] });
    await report(w.b, WEEKDAYS_4W.slice(0, 10));
    await expect(compare(w.b, { now: NOW })).rejects.toMatchObject({ status: 403 });                               // default: private
    await updateSettings({ ...w.admin, userId: w.admin.userId }, { visibilityScope: "TEAM", peersSeeBlockers: false });
    const r = await compare(w.b, { groupBy: "team", now: NOW });
    expect(r.groups.map((g) => g.name)).toEqual(["Alpha", "No team"]);                                              // "No team" holds Bob's manager, who is part of his picture
    expect(r.groups[1].people.map((p) => p.name)).toEqual(["Moe"]);
    const alpha = r.groups[0];
    expect(alpha.people.map((p) => p.name)).toEqual(["Ann", "Bob"]);                                               // alphabetical: no league table
    const ann = alpha.people.find((p) => p.name === "Ann")!;
    expect(ann.consistency).toBe(100);
    expect(ann.blockerDays).toBeNull();                                                                            // hidden from a peer
    expect(alpha.people.find((p) => p.name === "Bob")!.consistency).toBeCloseTo(52.6, 1);
    expect(alpha.medianConsistency).toBeCloseTo(76.3, 1);
    // the manager sees blocker days for their report; so does a company that allows it
    expect((await compare(w.mgr, { groupBy: "team", now: NOW })).groups[0].people.find((p) => p.name === "Ann")!.blockerDays).toBe(2);
    await updateSettings({ ...w.admin, userId: w.admin.userId }, { peersSeeBlockers: true });
    expect((await compare(w.b, { groupBy: "team", now: NOW })).groups[0].people.find((p) => p.name === "Ann")!.blockerDays).toBe(2);
  });

  it("groups by manager, level and everyone, and keeps people without a group together at the end", async () => {
    const w = await team();
    await updateSettings({ ...w.admin, userId: w.admin.userId }, { visibilityScope: "COMPANY" });
    await prisma.membership.update({ where: { id: w.a.membershipId }, data: { level: 3 } });
    const byManager = await compare(w.admin, { groupBy: "manager", now: NOW });
    expect(byManager.groups.map((g) => g.name)).toContain("Moe");
    expect(byManager.groups.at(-1)!.name).toBe("No manager");
    const byLevel = await compare(w.admin, { groupBy: "level", now: NOW });
    expect(byLevel.groups.some((g) => g.name === "Level 3")).toBe(true);
    expect((await compare(w.admin, { groupBy: "all", now: NOW })).groups).toHaveLength(1);
    expect((await compare(w.admin, { groupBy: "team", weeks: 12, now: NOW })).weeks).toBe(12);
    expect((await compare(w.admin, { weeks: 7, now: NOW })).weeks).toBe(4);                                         // only 4 or 12
  });

  it("another company never appears in a comparison", async () => {
    const w = await team();
    await updateSettings({ ...w.admin, userId: w.admin.userId }, { visibilityScope: "COMPANY" });
    const other = await makeOrg("Elsewhere2");
    const names = (await compare(other.admin, { groupBy: "all", now: NOW })).groups.flatMap((g) => g.people.map((p) => p.name));
    expect(names).not.toContain("Ann");
    expect(names).toHaveLength(1);
  });
});
