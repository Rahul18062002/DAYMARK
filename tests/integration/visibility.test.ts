import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { reportingSubtreeIds } from "@/server/policy";
import { createUpdate } from "@/server/services/updates";
import { getTeamUpdate, listTeamUpdates, teamHighlights, teamOverview } from "@/server/services/team-updates";
import { updateSettings } from "@/server/services/organization";
import { updateMember } from "@/server/services/members";
import { createDepartment, createTeam } from "@/server/services/structure";
import { orgTree, type OrgNode } from "@/server/services/org-tree";
import { addMember, makeOrg, type TestCtx } from "./helpers";

const NOW = new Date("2026-11-13T09:00:00Z"); // Fri 13 Nov 2026, 14:30 IST
const DAY = "2026-11-13";
const submit = (a: TestCtx, work: string, blocker?: string) =>
  createUpdate(a, { sections: { workedOn: [work], ...(blocker ? { blockers: [blocker] } : {}) }, submit: true }, { now: NOW });
const names = (rows: { employeeName: string }[]) => rows.map((r) => r.employeeName).sort();
const flat = (n: OrgNode[]): OrgNode[] => n.flatMap((x) => [x, ...flat(x.children)]);

/**
 *  Admin
 *  Mia (manager, no manager)
 *   └─ Max (manager)            team Alpha / dept Eng
 *       ├─ Eva (employee)       team Alpha / dept Eng
 *       └─ Ed  (employee)       team Alpha / dept Eng
 *  Mel (manager)                team Beta  / dept Eng   (reports to Mia too)
 *   └─ Zoe (employee)           team Beta  / dept Eng
 *  Sam (employee)               team Gamma / dept Ops   (no manager)
 */
async function company() {
  const { admin, organizationId } = await makeOrg("Vis");
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  const eng = await createDepartment(admin, { name: "Eng" });
  const ops = await createDepartment(admin, { name: "Ops" });
  const mia = (await addMember(admin, "MANAGER", { name: "Mia Top" })).ctx;
  const max = (await addMember(admin, "MANAGER", { name: "Max Lead", managerId: mia.membershipId })).ctx;
  const mel = (await addMember(admin, "MANAGER", { name: "Mel Lead", managerId: mia.membershipId })).ctx;
  const alpha = await createTeam(admin, { name: "Alpha", departmentId: eng.id, managerId: max.membershipId });
  const beta = await createTeam(admin, { name: "Beta", departmentId: eng.id, managerId: mel.membershipId });
  const gamma = await createTeam(admin, { name: "Gamma", departmentId: ops.id });
  const eva = (await addMember(admin, "EMPLOYEE", { name: "Eva E", teamId: alpha.id, managerId: max.membershipId })).ctx;
  const ed = (await addMember(admin, "EMPLOYEE", { name: "Ed E", teamId: alpha.id, managerId: max.membershipId })).ctx;
  const zoe = (await addMember(admin, "EMPLOYEE", { name: "Zoe Z", teamId: beta.id, managerId: mel.membershipId })).ctx;
  const sam = (await addMember(admin, "EMPLOYEE", { name: "Sam S", teamId: gamma.id })).ctx;
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  for (const [p, label] of [[eva, "Eva"], [ed, "Ed"], [zoe, "Zoe"], [sam, "Sam"], [max, "Max"], [admin, "Admin"]] as const) await submit(p, `${label} work`, label === "Eva" ? "Eva blocked on infra" : undefined);
  return { admin, organizationId, mia, max, mel, eva, ed, zoe, sam };
}
const setScope = (admin: TestCtx, visibilityScope: string, peersSeeBlockers = false) => updateSettings({ ...admin, userId: admin.userId }, { visibilityScope, peersSeeBlockers });
const list = (a: TestCtx) => listTeamUpdates(a, { from: DAY, to: DAY }, { now: NOW });

describe("reporting line", () => {
  it("a manager sees the whole line below them, at any depth, and nobody else", async () => {
    const c = await company();
    expect(names((await list(c.mia)).rows)).toEqual(["Ed E", "Eva E", "Max Lead", "Mel Lead", "Zoe Z"]); // Mia → Max → Eva/Ed, Mia → Mel → Zoe (Mel has not submitted: a "missing" row)
    expect(names((await list(c.max)).rows)).toEqual(["Ed E", "Eva E"]);
    expect(names((await list(c.mel)).rows)).toEqual(["Zoe Z"]);
    expect((await prisma.membership.count({ where: { organizationId: c.organizationId } }))).toBe(8);
  });
  it("the subtree walk terminates on a (corrupt) cycle", async () => {
    const c = await company();
    await prisma.membership.update({ where: { id: c.mia.membershipId }, data: { managerId: c.ed.membershipId } }); // Mia → … → Ed → Mia
    const ids = await reportingSubtreeIds(prisma, c.organizationId, c.mia.membershipId);
    expect(ids.length).toBeLessThan(20);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("visibility settings (employees)", () => {
  it("default (OWN): an employee has no team view, a manager keeps theirs", async () => {
    const c = await company();
    await expect(list(c.eva)).rejects.toMatchObject({ status: 403 });
    await expect(teamOverview(c.eva, { now: NOW })).rejects.toMatchObject({ status: 403 });
    expect((await list(c.max)).rows.length).toBe(2);
  });

  it("TEAM: peers on the same team (or with the same manager) are visible, nobody else", async () => {
    const c = await company(); await setScope(c.admin, "TEAM");
    expect(names((await list(c.eva)).rows)).toEqual(["Ed E", "Eva E", "Max Lead"]);                    // team peers + the manager above
    expect(names((await list(c.zoe)).rows)).toEqual(["Zoe Z"]);
    expect(names((await list(c.sam)).rows)).toEqual(["Sam S"]);
  });

  it("DEPARTMENT: the whole department, not other departments", async () => {
    const c = await company(); await setScope(c.admin, "DEPARTMENT");
    expect(names((await list(c.eva)).rows)).toEqual(["Ed E", "Eva E", "Max Lead", "Zoe Z"]);        // Eng members + Eva's manager above her
    expect(names((await list(c.sam)).rows)).toEqual(["Sam S"]);
  });

  it("COMPANY: everyone, including the admin/CEO, and a detail page works for any of them", async () => {
    const c = await company(); await setScope(c.admin, "COMPANY");
    const rows = (await list(c.eva)).rows;
    expect(names(rows)).toEqual(["Ed E", "Eva E", "Max Lead", "Sam S", "Vis Admin", "Zoe Z"]);
    const sam = rows.find((r) => r.employeeName === "Sam S")!;
    expect((await getTeamUpdate(c.eva, sam.updateId!, { now: NOW })).employee.name).toBe("Sam S");
  });

  it("peers read submitted work only: no 'not submitted' rows, no pending count, no contact details", async () => {
    const c = await company(); await setScope(c.admin, "COMPANY");
    await prisma.dailyUpdate.deleteMany({ where: { membershipId: c.sam.membershipId } });             // Sam did not submit
    const peer = await list(c.eva);
    expect(peer.canSeeMissing).toBe(false);
    expect(peer.rows.some((r) => r.status === "MISSING")).toBe(false);
    expect((await listTeamUpdates(c.eva, { from: DAY, to: DAY, status: "missing" }, { now: NOW })).rows).toHaveLength(0);
    const ov = await teamOverview(c.eva, { now: NOW });
    expect(ov).toMatchObject({ pending: 0, canSeeMissing: false });
    const mgr = await list(c.admin);
    expect(mgr.rows.some((r) => r.status === "MISSING" && r.employeeName === "Sam S")).toBe(true);    // management still sees who is missing
    const zoe = (await list(c.eva)).rows.find((r) => r.employeeName === "Zoe Z")!;
    expect((await getTeamUpdate(c.eva, zoe.updateId!, { now: NOW })).employee.email).toBe("");
    expect((await getTeamUpdate(c.admin, zoe.updateId!, { now: NOW })).employee.email).toContain("@");
  });

  it("blockers stay private to the reporting line unless the company allows peers to see them", async () => {
    const c = await company(); await setScope(c.admin, "COMPANY", false);
    const evaRow = (rows: Awaited<ReturnType<typeof list>>["rows"]) => rows.find((r) => r.employeeName === "Eva E")!;
    // a peer (Zoe) looking at Eva
    const seen = evaRow((await list(c.zoe)).rows);
    expect(seen.hasBlockers).toBe(false);
    const detail = await getTeamUpdate(c.zoe, seen.updateId!, { now: NOW });
    expect(detail.hasBlockers).toBe(false); expect(detail.sections.BLOCKER).toEqual([]);
    expect(JSON.stringify(detail.revisions)).not.toContain("blocked on infra");
    expect((await list(c.zoe)).rows.some((r) => r.hasBlockers)).toBe(false);
    expect((await listTeamUpdates(c.zoe, { from: DAY, to: DAY, blockers: "1" }, { now: NOW })).rows).toHaveLength(0); // the filter can't be used to probe
    expect((await teamHighlights(c.zoe, { now: NOW })).blockers).toHaveLength(0);
    expect((await teamOverview(c.zoe, { now: NOW })).withBlockers).toBe(0);
    // Eva's manager (Max) and the admin always see them
    for (const viewer of [c.max, c.mia, c.admin]) {
      expect(evaRow((await list(viewer)).rows).hasBlockers).toBe(true);
      expect((await getTeamUpdate(viewer, seen.updateId!, { now: NOW })).sections.BLOCKER).toEqual(["Eva blocked on infra"]);
    }
    // company opts in: peers see them too
    await setScope(c.admin, "COMPANY", true);
    expect(evaRow((await list(c.zoe)).rows).hasBlockers).toBe(true);
    expect((await getTeamUpdate(c.zoe, seen.updateId!, { now: NOW })).sections.BLOCKER).toEqual(["Eva blocked on infra"]);
    expect((await teamHighlights(c.zoe, { now: NOW })).blockers.length).toBe(1);
  });

  it("drafts are never visible to anyone else, whatever the setting", async () => {
    const c = await company(); await setScope(c.admin, "COMPANY", true);
    const d = await createUpdate(c.eva, { sections: { workedOn: ["secret draft"] }, updateDate: "2026-11-12" }, { now: NOW });
    await expect(getTeamUpdate(c.admin, d.id, { now: NOW })).rejects.toMatchObject({ status: 404 });
    await expect(getTeamUpdate(c.zoe, d.id, { now: NOW })).rejects.toMatchObject({ status: 404 });
  });

  it("another company never sees any of it, even with COMPANY visibility on both sides", async () => {
    const c = await company(); await setScope(c.admin, "COMPANY", true);
    const other = await makeOrg("Other"); await setScope(other.admin, "COMPANY", true);
    const stranger = (await addMember(other.admin, "EMPLOYEE")).ctx;
    expect((await list(stranger)).rows.filter((r) => r.status !== "MISSING")).toHaveLength(0);
    const evaRow = (await list(c.eva)).rows[0];
    await expect(getTeamUpdate(stranger, evaRow.updateId!, { now: NOW })).rejects.toMatchObject({ status: 404 });
    expect(flat((await orgTree(stranger)).roots).some((n) => n.name.includes("Eva"))).toBe(false);
  });
});

describe("org chart", () => {
  it("admin sees everyone; the structure is a tree with the right reports", async () => {
    const c = await company();
    const t = await orgTree(c.admin, { now: NOW });
    const all = flat(t.roots);
    expect(all.length).toBe(8);
    const mia = all.find((n) => n.name === "Mia Top")!;
    expect(mia.children.map((x) => x.name).sort()).toEqual(["Max Lead", "Mel Lead"]);
    expect(mia.reportCount).toBe(5);                                                                    // Max, Mel, Eva, Ed, Zoe
    expect(all.find((n) => n.name === "Eva E")!.submittedToday).toBe(true);
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length);                                        // nobody appears twice
  });
  it("default privacy: an employee sees only their own chain; with COMPANY visibility, everyone — without submission status", async () => {
    const c = await company();
    const own = await orgTree(c.eva, { now: NOW });
    expect(flat(own.roots).map((n) => n.name).sort()).toEqual(["Eva E", "Max Lead", "Mia Top"]);
    expect(own.restricted).toBe(true);
    await setScope(c.admin, "COMPANY");
    const open = await orgTree(c.eva, { now: NOW });
    expect(flat(open.roots).length).toBe(8);
    expect(flat(open.roots).every((n) => n.submittedToday === null)).toBe(true);
    const asManager = await orgTree(c.max, { now: NOW });
    expect(flat(asManager.roots).find((n) => n.name === "Ed E")!.submittedToday).toBe(true);
  });
});

describe("level and mentor", () => {
  it("can be set by an admin, appear in the chart, and are validated inside the organization", async () => {
    const c = await company();
    const a = { ...c.admin, userId: c.admin.userId };
    await updateMember(a, c.eva.membershipId, { level: 3, mentorId: c.max.membershipId });
    const node = flat((await orgTree(c.admin, { now: NOW })).roots).find((n) => n.name === "Eva E")!;
    expect(node).toMatchObject({ level: 3, mentorName: "Max Lead" });
    await expect(updateMember(a, c.eva.membershipId, { mentorId: c.eva.membershipId })).rejects.toMatchObject({ status: 400 });
    const stranger = await makeOrg("Elsewhere");
    await expect(updateMember(a, c.eva.membershipId, { mentorId: stranger.admin.membershipId })).rejects.toMatchObject({ status: 400 });
    // and the database itself refuses a mentor from another organization
    await expect(prisma.membership.update({ where: { id: c.eva.membershipId }, data: { mentorId: stranger.admin.membershipId } })).rejects.toMatchObject({ code: "P2003" });
    await expect(updateMember(a, c.eva.membershipId, { level: 0 })).rejects.toBeTruthy();
    await expect(updateMember(a, c.eva.membershipId, { level: 21 })).rejects.toBeTruthy();
  });
});
