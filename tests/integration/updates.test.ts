import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ingestUpdate } from "@/server/channels/ingest";
import { createUpdate, computeHasBlockers, deleteDraft, getOwnUpdate, getWeekOverview, listOwnUpdates, updateUpdate } from "@/server/services/updates";
import { filterOptions, getTeamUpdate, listTeamUpdates, teamHighlights, teamOverview, teamTrend } from "@/server/services/team-updates";
import { updateSettings } from "@/server/services/organization";
import { createTeam } from "@/server/services/structure";
import { addMember, makeOrg, type TestCtx } from "./helpers";

// Org timezone in tests is Asia/Kolkata (UTC+5:30), default cut-off 18:00, edit window 24h.
// Friday 13 Nov 2026, 14:30 IST:
const NOW = new Date("2026-11-13T09:00:00Z");
const DAY = "2026-11-13";
const at = (iso: string) => new Date(iso);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const text = (s: string) => ({ workedOn: [s] });
const submitNow = (a: TestCtx, sections: object = text("Screened 8 candidates"), extra: object = {}, now = NOW) =>
  createUpdate(a, { sections, submit: true, ...extra }, { now });

async function backdate(organizationId: string) {
  // Members "joined" long before the fixed test clock, so they're expected to have submitted.
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
}

describe("A. Submitting updates", () => {
  it("accepts a plain natural-language update as one entry and records the original submission", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const sentence = "Today I completed the recruitment screening for five candidates, scheduled three interviews and shared feedback with the hiring manager.";
    const { id, status } = await submitNow(emp, { workedOn: [sentence] });
    expect(status).toBe("SUBMITTED");
    const u = await getOwnUpdate(emp, id, { now: NOW });
    expect(u.sections.WORKED_ON).toEqual([sentence]);
    expect(u.updateDate).toBe(DAY);
    expect(u.source).toBe("DASHBOARD");
    expect(u.firstSubmittedAt).toBe(NOW.toISOString());
    expect(u.revisions).toHaveLength(1);
    expect(u.revisions[0]).toMatchObject({ revisionNumber: 1, kind: "SUBMITTED", statusAtTime: "SUBMITTED" });
    expect(await prisma.auditLog.count({ where: { organizationId: admin.organizationId, action: "update.submitted", entityId: id } })).toBe(1);
  });

  it("supports many work items across all sections, plus links", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await submitNow(emp, {
      workedOn: ["Onboarding calls", "Pipeline review", "Quarterly forecast"],
      completed: ["Closed two renewals"],
      pending: ["Waiting on legal for contract C-12"],
      blockers: ["Legal review is slow"],
      nextPriorities: ["Send proposal", "Update CRM"],
    }, { links: [{ url: "https://docs.example.com/forecast", label: "Forecast" }, { url: "http://intranet.example/x" }] });
    const u = await getOwnUpdate(emp, id, { now: NOW });
    expect(u.sections.WORKED_ON).toEqual(["Onboarding calls", "Pipeline review", "Quarterly forecast"]);
    expect(u.sections.NEXT_PRIORITY).toEqual(["Send proposal", "Update CRM"]);
    expect(u.links).toEqual([{ url: "https://docs.example.com/forecast", label: "Forecast" }, { url: "http://intranet.example/x", label: null }]);
    expect(u.hasBlockers).toBe(true);
  });

  it("drafts can be saved incomplete and finished later; drafts create no revisions", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id, status } = await createUpdate(emp, { sections: {} }, { now: NOW });
    expect(status).toBe("DRAFT");
    await updateUpdate(emp, id, { sections: { workedOn: ["half done"] } }, { now: NOW });
    let u = await getOwnUpdate(emp, id, { now: NOW });
    expect(u.status).toBe("DRAFT");
    expect(u.revisions).toHaveLength(0);
    expect(u.firstSubmittedAt).toBeNull();
    await expect(updateUpdate(emp, id, { submit: true, sections: { workedOn: [] } }, { now: NOW })).rejects.toMatchObject({ status: 400 });
    const r = await updateUpdate(emp, id, { submit: true, sections: { workedOn: ["finished the thing"] } }, { now: NOW });
    expect(r.status).toBe("SUBMITTED");
    u = await getOwnUpdate(emp, id, { now: NOW });
    expect(u.revisions).toHaveLength(1);
    expect(u.sections.WORKED_ON).toEqual(["finished the thing"]);
  });

  it("allows only one update per person per day and tells the client which one", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const first = await submitNow(emp);
    await expect(submitNow(emp)).rejects.toMatchObject({ status: 409, code: "UPDATE_EXISTS", details: { id: first.id } });
    expect(await prisma.dailyUpdate.count({ where: { membershipId: emp.membershipId } })).toBe(1);
  });

  it("validates input: needs a work entry to submit; rejects non-http links, oversized and too many entries", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    await expect(submitNow(emp, { completed: ["only this"] })).rejects.toMatchObject({ status: 400 });
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.example/file", "not a url", "//evil.example"]) {
      await expect(createUpdate(emp, { sections: text("x"), links: [{ url }] }, { now: NOW }), url).rejects.toBeTruthy();
    }
    await expect(createUpdate(emp, { sections: { workedOn: ["x".repeat(2001)] } }, { now: NOW })).rejects.toBeTruthy();
    await expect(createUpdate(emp, { sections: { workedOn: Array.from({ length: 21 }, (_, i) => `item ${i}`) } }, { now: NOW })).rejects.toBeTruthy();
    await expect(createUpdate(emp, { sections: { workedOn: ["  "] } }, { now: NOW })).rejects.toBeTruthy();
    expect(await prisma.dailyUpdate.count({ where: { membershipId: emp.membershipId } })).toBe(0);
  });

  it("uses the ORGANIZATION's calendar day and limits backdating to 7 days, never the future", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    // 20:00 UTC on the 12th is already 01:30 on the 13th in Kolkata.
    const lateNight = at("2026-11-12T20:00:00Z");
    const a = await createUpdate(emp, { sections: text("x") }, { now: lateNight });
    expect((await getOwnUpdate(emp, a.id)).updateDate).toBe("2026-11-13");

    await expect(createUpdate(emp, { sections: text("x"), updateDate: "2026-11-14" }, { now: NOW })).rejects.toMatchObject({ status: 400 });
    await expect(createUpdate(emp, { sections: text("x"), updateDate: "2026-11-05" }, { now: NOW })).rejects.toMatchObject({ status: 400 }); // 8 days back
    await expect(createUpdate(emp, { sections: text("x"), updateDate: "2026-11-06" }, { now: NOW })).resolves.toBeTruthy(); // 7 days back
    await expect(createUpdate(emp, { sections: text("x"), updateDate: "2026-02-30" }, { now: NOW })).rejects.toBeTruthy(); // not a date
  });

  it("flags late submissions against the cut-off in the organization's timezone, fixed at first submission", async () => {
    const { admin } = await makeOrg();
    const e1 = (await addMember(admin, "EMPLOYEE")).ctx;
    const e2 = (await addMember(admin, "EMPLOYEE")).ctx;
    const e3 = (await addMember(admin, "EMPLOYEE")).ctx;
    const onTime = await submitNow(e1, text("a"), {}, at("2026-11-13T12:00:00Z")); // 17:30 IST
    const late = await submitNow(e2, text("b"), {}, at("2026-11-13T13:00:00Z")); // 18:30 IST
    const backdated = await submitNow(e3, text("c"), { updateDate: "2026-11-12" }, NOW);
    expect((await getOwnUpdate(e1, onTime.id)).submittedLate).toBe(false);
    expect((await getOwnUpdate(e2, late.id)).submittedLate).toBe(true);
    expect((await getOwnUpdate(e3, backdated.id)).submittedLate).toBe(true);
    // Editing an on-time update after the cut-off does not make it late.
    await updateUpdate(e1, onTime.id, { sections: { workedOn: ["a, revised"] } }, { now: at("2026-11-13T14:00:00Z") });
    expect((await getOwnUpdate(e1, onTime.id)).submittedLate).toBe(false);
  });

  it("derives the blocker flag from real blockers, not from 'None'", () => {
    expect(computeHasBlockers([])).toBe(false);
    for (const none of ["None", "none.", "N/A", "no blockers", "Nothing", "-", "No issues"]) expect(computeHasBlockers([none]), none).toBe(false);
    expect(computeHasBlockers(["Waiting for access to the CRM"])).toBe(true);
    expect(computeHasBlockers(["None", "Server is down"])).toBe(true);
  });

  it("goes through the shared ingest path and records the channel as the source", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await ingestUpdate(emp, { channel: "EMAIL", sections: { workedOn: ["Replied by email"] }, submit: true }, { now: NOW });
    expect((await getOwnUpdate(emp, id)).source).toBe("EMAIL");
    // Same validation applies to every channel.
    const e2 = (await addMember(admin, "EMPLOYEE")).ctx;
    await expect(ingestUpdate(e2, { channel: "SLACK", sections: {}, submit: true }, { now: NOW })).rejects.toMatchObject({ status: 400 });
  });
});

describe("B. Editing, edit window and revision history", () => {
  it("edits within the window mark the update Edited but never lose the original submission", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await submitNow(emp, { workedOn: ["Original work"], blockers: ["Waiting on access"] });

    const r1 = await updateUpdate(emp, id, { sections: { workedOn: ["Original work", "Added later"], blockers: [] } }, { now: hours(2) });
    expect(r1).toMatchObject({ status: "EDITED", changed: true });
    const r2 = await updateUpdate(emp, id, { sections: { workedOn: ["Third version"] } }, { now: hours(5) });
    expect(r2.status).toBe("EDITED");

    const u = await getOwnUpdate(emp, id, { now: hours(6) });
    expect(u.status).toBe("EDITED");
    expect(u.firstSubmittedAt).toBe(NOW.toISOString()); // original submission time preserved
    expect(u.lastEditedAt).toBe(hours(5).toISOString());
    expect(u.sections.WORKED_ON).toEqual(["Third version"]);
    expect(u.revisions.map((r) => [r.revisionNumber, r.kind, r.statusAtTime])).toEqual([[1, "SUBMITTED", "SUBMITTED"], [2, "EDITED", "EDITED"], [3, "EDITED", "EDITED"]]);
    // Revision 1 is still exactly what was first submitted.
    expect(u.revisions[0].snapshot.sections.WORKED_ON).toEqual(["Original work"]);
    expect(u.revisions[0].snapshot.sections.BLOCKER).toEqual(["Waiting on access"]);
    expect(u.revisions[1].snapshot.sections.WORKED_ON).toEqual(["Original work", "Added later"]);
    expect(u.hasBlockers).toBe(false); // flag follows the current content
    expect(await prisma.auditLog.count({ where: { organizationId: admin.organizationId, action: "update.edited", entityId: id } })).toBe(2);
  });

  it("an edit that changes nothing creates no revision and keeps the status", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await submitNow(emp, { workedOn: ["Same"] });
    const r = await updateUpdate(emp, id, { sections: { workedOn: ["Same"] } }, { now: hours(1) });
    expect(r).toMatchObject({ status: "SUBMITTED", changed: false });
    expect((await getOwnUpdate(emp, id, { now: hours(1) })).revisions).toHaveLength(1);
  });

  it("closes the edit window 24h after the ORIGINAL submission, even if edited since", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await submitNow(emp);
    await updateUpdate(emp, id, { sections: { workedOn: ["edited at +20h"] } }, { now: hours(20) });
    await expect(updateUpdate(emp, id, { sections: { workedOn: ["too late"] } }, { now: hours(25) })).rejects.toMatchObject({ status: 403, code: "EDIT_WINDOW_CLOSED" });
    const u = await getOwnUpdate(emp, id, { now: hours(25) });
    expect(u.sections.WORKED_ON).toEqual(["edited at +20h"]);
    expect(u.canEdit).toBe(false);
    expect(u.editableUntil).toBeNull();
    expect((await getOwnUpdate(emp, id, { now: hours(10) })).editableUntil).toBe(hours(24).toISOString());
  });

  it("respects the organization's edit-window setting, including 0 = no edits", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    await updateSettings(admin, { editWindowHours: 2 });
    const a = await submitNow(emp);
    await expect(updateUpdate(emp, a.id, { sections: { workedOn: ["x"] } }, { now: hours(3) })).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
    await updateSettings(admin, { editWindowHours: 0 });
    await expect(updateUpdate(emp, a.id, { sections: { workedOn: ["x"] } }, { now: hours(0.01) })).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
  });

  it("can't blank out a submitted update, and submitted updates can't be deleted", async () => {
    const { admin } = await makeOrg();
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    const { id } = await submitNow(emp);
    await expect(updateUpdate(emp, id, { sections: { workedOn: [] } }, { now: hours(1) })).rejects.toMatchObject({ status: 400 });
    await expect(deleteDraft(emp, id)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.dailyUpdate.count({ where: { id } })).toBe(1);
    const d = await createUpdate(emp, { sections: text("draft"), updateDate: "2026-11-12" }, { now: NOW });
    await deleteDraft(emp, d.id);
    expect(await prisma.dailyUpdate.count({ where: { id: d.id } })).toBe(0);
  });
});

describe("C. Access control for updates", () => {
  async function scenario() {
    const { admin } = await makeOrg();
    const m1 = (await addMember(admin, "MANAGER")).ctx;
    const m2 = (await addMember(admin, "MANAGER")).ctx;
    const t1 = await createTeam(admin, { name: "T1", managerId: m1.membershipId });
    const t2 = await createTeam(admin, { name: "T2", managerId: m2.membershipId });
    const e1 = (await addMember(admin, "EMPLOYEE", { teamId: t1.id })).ctx;
    const e2 = (await addMember(admin, "EMPLOYEE", { teamId: t2.id })).ctx;
    const e3 = (await addMember(admin, "EMPLOYEE")).ctx;
    await backdate(admin.organizationId);
    return { admin, m1, m2, t1, t2, e1, e2, e3 };
  }

  it("employees see only their own updates; nobody else can read, edit or delete them", async () => {
    const s = await scenario();
    const u1 = await submitNow(s.e1);
    const own = await listOwnUpdates(s.e2);
    expect(own).toHaveLength(0);
    for (const intruder of [s.e2, s.e3, s.m1, s.m2, s.admin]) {
      await expect(getOwnUpdate(intruder, u1.id)).rejects.toMatchObject({ status: 404 });
      await expect(updateUpdate(intruder, u1.id, { sections: { workedOn: ["hax"] } }, { now: hours(1) })).rejects.toMatchObject({ status: 404 });
      await expect(deleteDraft(intruder, u1.id)).rejects.toMatchObject({ status: 404 });
    }
    // Employees can't use the team view at all.
    await expect(listTeamUpdates(s.e1)).rejects.toMatchObject({ status: 403 });
    await expect(getTeamUpdate(s.e1, u1.id)).rejects.toMatchObject({ status: 403 });
    await expect(teamOverview(s.e1)).rejects.toMatchObject({ status: 403 });
    await expect(teamHighlights(s.e1)).rejects.toMatchObject({ status: 403 });
    expect((await getOwnUpdate(s.e1, u1.id, { now: NOW })).sections.WORKED_ON).toEqual(["Screened 8 candidates"]);
  });

  it("managers read updates only from their own teams, and never see drafts", async () => {
    const s = await scenario();
    const submitted = await submitNow(s.e1, text("E1 work"));
    const theirs = await submitNow(s.e2, text("E2 work"));
    const draft = await createUpdate(s.e3, { sections: text("draft"), updateDate: "2026-11-12" }, { now: NOW });
    await prisma.membership.update({ where: { id: s.e3.membershipId }, data: { managerId: s.m1.membershipId } });

    expect((await getTeamUpdate(s.m1, submitted.id)).sections.WORKED_ON).toEqual(["E1 work"]);
    await expect(getTeamUpdate(s.m1, theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTeamUpdate(s.m2, submitted.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTeamUpdate(s.m1, draft.id)).rejects.toMatchObject({ status: 404 }); // direct report, but a draft

    const rows = (await listTeamUpdates(s.m1, { from: DAY, to: DAY, status: "submitted" }, { now: NOW })).rows;
    expect(rows.map((r) => r.employeeName)).toEqual([s.e1.userName]);
    const all = (await listTeamUpdates(s.admin, { from: DAY, to: DAY, status: "submitted" }, { now: NOW })).rows;
    expect(all.map((r) => r.employeeName).sort()).toEqual([s.e1.userName, s.e2.userName].sort());
    // Filters can't be used to reach outside the scope.
    const probe = await listTeamUpdates(s.m1, { from: DAY, to: DAY, membershipId: s.e2.membershipId }, { now: NOW });
    expect(probe.rows).toHaveLength(0);
    const probeTeam = await listTeamUpdates(s.m1, { from: DAY, to: DAY, teamId: s.t2.id }, { now: NOW });
    expect(probeTeam.rows).toHaveLength(0);
    const opts = await filterOptions(s.m1);
    expect(opts.people.map((p) => p.id)).not.toContain(s.e2.membershipId);
    expect(opts.teams.map((t) => t.id)).toEqual([s.t1.id]);
  });

  it("an explicit team grant widens a manager's view of updates, nothing more", async () => {
    const s = await scenario();
    const theirs = await submitNow(s.e2, text("E2 work"));
    await expect(getTeamUpdate(s.m1, theirs.id)).rejects.toMatchObject({ status: 404 });
    const { updateMember } = await import("@/server/services/members");
    await updateMember(s.admin, s.m1.membershipId, { accessTeamIds: [s.t2.id] });
    expect((await getTeamUpdate(s.m1, theirs.id)).employee.name).toBe(s.e2.userName);
  });

  it("another organization can never reach these updates", async () => {
    const s = await scenario();
    const u = await submitNow(s.e1);
    const other = await makeOrg("Rival");
    await expect(getTeamUpdate(other.admin, u.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOwnUpdate(other.admin, u.id)).rejects.toMatchObject({ status: 404 });
    expect((await listTeamUpdates(other.admin, { from: DAY, to: DAY }, { now: NOW })).rows.filter((r) => r.status !== "MISSING")).toHaveLength(0);
    // …and the database refuses to attach an update to another organization's person.
    await expect(
      prisma.dailyUpdate.create({ data: { organizationId: other.organizationId, membershipId: s.e1.membershipId, updateDate: new Date("2026-10-01T00:00:00Z") } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.updateItem.create({ data: { organizationId: other.organizationId, dailyUpdateId: u.id, section: "WORKED_ON", position: 0, text: "x" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("D. Manager overview, filters and trends", () => {
  async function team() {
    const { admin } = await makeOrg();
    const mgr = (await addMember(admin, "MANAGER")).ctx;
    const t = await createTeam(admin, { name: "Recruiting", managerId: mgr.membershipId });
    const a = (await addMember(admin, "EMPLOYEE", { teamId: t.id, name: "Asha" })).ctx;
    const b = (await addMember(admin, "EMPLOYEE", { teamId: t.id, name: "Ben" })).ctx;
    const c = (await addMember(admin, "EMPLOYEE", { teamId: t.id, name: "Chen" })).ctx;
    const outsider = (await addMember(admin, "EMPLOYEE", { name: "Outsider" })).ctx;
    await backdate(admin.organizationId);
    return { admin, mgr, t, a, b, c, outsider };
  }

  it("computes the cards: team size, submitted, pending, blockers and weekly activity", async () => {
    const s = await team();
    await submitNow(s.a, { workedOn: ["w"], blockers: ["Waiting on the hiring manager"] });
    await submitNow(s.b, { workedOn: ["w"], blockers: ["None"] });
    await submitNow(s.outsider); // not in the manager's scope
    await createUpdate(s.c, { sections: text("only a draft") }, { now: NOW }); // drafts don't count as submitted
    // Thursday's update from Asha counts toward the week, not toward today.
    await createUpdate(s.a, { sections: text("thu"), updateDate: "2026-11-12", submit: true }, { now: NOW });

    const o = await teamOverview(s.mgr, { now: NOW });
    expect(o).toMatchObject({ day: DAY, isWorkingDay: true, totalMembers: 3, submitted: 2, pending: 1, withBlockers: 1 });
    expect(o.weekly).toMatchObject({ updates: 3, contributors: 2, weekStart: "2026-11-09" });
    // Admin sees the whole company (manager + 3 + outsider + admin = 6 people).
    expect((await teamOverview(s.admin, { now: NOW })).totalMembers).toBe(6);
  });

  it("nobody is 'pending' on a non-working day or before they joined", async () => {
    const s = await team();
    expect((await teamOverview(s.mgr, { now: NOW, day: "2026-11-14" })).pending).toBe(0); // Saturday
    expect((await teamOverview(s.mgr, { now: NOW, day: "2026-11-14" })).isWorkingDay).toBe(false);
    await prisma.membership.update({ where: { id: s.c.membershipId }, data: { createdAt: new Date("2026-11-13T05:00:00Z") } }); // joined today
    expect((await teamOverview(s.mgr, { now: NOW, day: "2026-11-12" })).pending).toBe(2); // Chen wasn't there yet
    expect((await teamOverview(s.mgr, { now: NOW })).pending).toBe(3);
  });

  it("lists submitted rows and 'not submitted' rows, with working-day aware filters", async () => {
    const s = await team();
    await submitNow(s.a, { workedOn: ["Asha's Friday work"], blockers: ["Blocked on laptop"] });
    await createUpdate(s.b, { sections: text("Ben thursday"), updateDate: "2026-11-12", submit: true }, { now: NOW });
    await updateUpdate(s.b, (await prisma.dailyUpdate.findFirstOrThrow({ where: { membershipId: s.b.membershipId } })).id, { sections: { workedOn: ["Ben thursday, edited"] } }, { now: NOW });

    const range = await listTeamUpdates(s.mgr, { from: "2026-11-12", to: "2026-11-14" }, { now: NOW });
    const summary = range.rows.map((r) => `${r.date} ${r.employeeName} ${r.status}`);
    expect(summary).toContain("2026-11-13 Asha SUBMITTED");
    expect(summary).toContain("2026-11-12 Ben EDITED");
    expect(summary).toContain("2026-11-13 Ben MISSING");
    expect(summary).toContain("2026-11-12 Asha MISSING");
    expect(summary.filter((r) => r.startsWith("2026-11-14"))).toHaveLength(0); // Saturday is off
    expect(summary.some((r) => r.includes("Outsider"))).toBe(false);

    const only = (f: object) => listTeamUpdates(s.mgr, { from: "2026-11-12", to: "2026-11-14", ...f }, { now: NOW }).then((r) => r.rows);
    expect((await only({ status: "missing" })).every((r) => r.status === "MISSING")).toBe(true);
    expect((await only({ status: "edited" })).map((r) => r.employeeName)).toEqual(["Ben"]);
    expect((await only({ status: "submitted" })).map((r) => r.employeeName)).toEqual(["Asha"]);
    expect((await only({ blockers: "1" })).map((r) => r.employeeName)).toEqual(["Asha"]);
    expect((await only({ membershipId: s.c.membershipId })).every((r) => r.employeeName === "Chen")).toBe(true);
    expect((await only({ teamId: s.t.id })).length).toBe(range.rows.length);
    expect((await only({ departmentId: "does-not-exist" })).length).toBe(0);

    const today = await listTeamUpdates(s.mgr, {}, { now: NOW }); // default = today
    expect(today.from).toBe(DAY);
    expect(today.rows.map((r) => `${r.employeeName} ${r.status}`).sort()).toEqual(["Asha SUBMITTED", "Ben MISSING", "Chen MISSING"]);
    await expect(listTeamUpdates(s.mgr, { from: "2026-09-01", to: "2026-11-13" }, { now: NOW })).rejects.toMatchObject({ status: 400 });
  });

  it("returns a per-day trend and recent raw blockers / pending / completed entries", async () => {
    const s = await team();
    await submitNow(s.a, { workedOn: ["w"], completed: ["Hired one engineer"], pending: ["Offer letter"], blockers: ["Budget approval"] });
    await submitNow(s.b, { workedOn: ["w"], blockers: ["None"], pending: ["Interview feedback"] });
    await createUpdate(s.a, { sections: text("t"), updateDate: "2026-11-12", submit: true }, { now: NOW });
    const trend = await teamTrend(s.mgr, { now: NOW, days: 5 });
    expect(trend.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(trend.find((d) => d.date === DAY)).toEqual({ date: DAY, submitted: 2, expected: 3 });
    expect(trend.find((d) => d.date === "2026-11-12")).toEqual({ date: "2026-11-12", submitted: 1, expected: 3 });
    const h = await teamHighlights(s.mgr, { now: NOW });
    expect(h.blockers.map((b) => b.text)).toEqual(["Budget approval"]); // "None" is filtered out
    expect(h.pending.map((p) => p.text).sort()).toEqual(["Interview feedback", "Offer letter"]);
    expect(h.completed[0]).toMatchObject({ text: "Hired one engineer", employeeName: "Asha" });
  });

  it("gives employees a week overview with correct per-day states", async () => {
    const s = await team();
    await createUpdate(s.a, { sections: text("mon"), updateDate: "2026-11-09", submit: true }, { now: NOW });
    await createUpdate(s.a, { sections: text("wed draft"), updateDate: "2026-11-11" }, { now: NOW });
    const w = await getWeekOverview(s.a, { now: NOW });
    expect(w.days.map((d) => d.status)).toEqual(["SUBMITTED", "MISSING", "DRAFT", "MISSING", "UPCOMING", "OFF", "OFF"]);
    expect(w.days[4]).toMatchObject({ day: DAY, isToday: true });
    expect(w).toMatchObject({ submitted: 1, expected: 5 });
  });
});
