import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { auth } from "@/server/auth/auth";
import {
  acceptInvitationExistingUser, acceptInvitationNewUser, createInvitation, listInvitations,
  previewInvitation, resendInvitation, revokeInvitation,
} from "@/server/services/invitations";
import { createOrganizationWithAdmin, updateOrganization, updateSettings } from "@/server/services/organization";
import { createDepartment, createTeam, deleteDepartment, deleteTeam, updateTeam } from "@/server/services/structure";
import { getMember, listMembers, updateMember } from "@/server/services/members";
import { addMember, makeOrg, PASSWORD, signIn, uid } from "./helpers";

const tokenOf = (url: string) => url.split("/invite/")[1];

describe("1. Organization onboarding & authentication", () => {
  it("creates an organization, default settings, an ADMIN membership and an audit entry", async () => {
    const { admin, organizationId } = await makeOrg("Acme");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
    expect(org.timezone).toBe("Asia/Kolkata");
    expect(org.settings?.editWindowHours).toBe(24);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: admin.membershipId } });
    expect(m.role).toBe("ADMIN");
    expect(await prisma.auditLog.count({ where: { organizationId, action: "organization.created" } })).toBe(1);
  });

  it("lets the admin sign in with the password, and rejects a wrong password", async () => {
    const { admin } = await makeOrg();
    const ok = await signIn(admin.userEmail);
    expect(ok.user.email).toBe(admin.userEmail);
    await expect(signIn(admin.userEmail, "wrong-password-123")).rejects.toThrow();
  });

  it("stores only a hash of the password, in the auth account table", async () => {
    const { admin } = await makeOrg();
    const acc = await prisma.account.findFirstOrThrow({ where: { userId: admin.userId } });
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toContain(PASSWORD);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const { admin } = await makeOrg();
    await expect(
      createOrganizationWithAdmin({ organizationName: "Dup", timezone: "UTC", name: "X", email: admin.userEmail, password: PASSWORD }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createOrganizationWithAdmin({ organizationName: "Weak", timezone: "UTC", name: "X", email: `w-${uid()}@x.test`, password: "short" }),
    ).rejects.toThrow();
  });

  it("has NO public registration: creating a user outside the server-side guard is refused", async () => {
    const email = `sneaky-${uid()}@x.test`;
    await expect(auth.api.signUpEmail({ body: { name: "Sneaky", email, password: PASSWORD } })).rejects.toMatchObject({
      body: { code: "FAILED_TO_CREATE_USER" },
    });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});

describe("2. Invitations", () => {
  it("creates an invitation whose raw token is never stored; accepting creates login + membership with presets", async () => {
    const { admin } = await makeOrg();
    const dept = await createDepartment(admin, { name: "Sales" });
    const team = await createTeam(admin, { name: "Inbound", departmentId: dept.id });
    const email = `new-${uid()}@x.test`;
    const res = await createInvitation(admin, { email, role: "EMPLOYEE", teamId: team.id });
    const token = tokenOf(res.inviteUrl);
    expect(res.emailConfigured).toBe(false); // no SMTP in tests → copyable link fallback
    const stored = await prisma.invitation.findFirstOrThrow({ where: { email, organizationId: admin.organizationId } });
    expect(stored.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);

    const preview = await previewInvitation(token);
    expect(preview).toMatchObject({ email, role: "EMPLOYEE", accountExists: false });

    await acceptInvitationNewUser({ token, name: "Nina New", password: PASSWORD });
    const login = await signIn(email);
    expect(login.user.emailVerified).toBe(true);
    const m = await prisma.membership.findFirstOrThrow({ where: { user: { email } } });
    expect(m).toMatchObject({ organizationId: admin.organizationId, role: "EMPLOYEE", teamId: team.id, departmentId: dept.id });
    expect(await previewInvitation(token)).toBeNull(); // single use
  });

  it("refuses reuse, revoked, expired and garbage tokens", async () => {
    const { admin } = await makeOrg();
    const a = await createInvitation(admin, { email: `a-${uid()}@x.test`, role: "EMPLOYEE" });
    await acceptInvitationNewUser({ token: tokenOf(a.inviteUrl), name: "A", password: PASSWORD });
    await expect(acceptInvitationNewUser({ token: tokenOf(a.inviteUrl), name: "A2", password: PASSWORD })).rejects.toThrow();

    const b = await createInvitation(admin, { email: `b-${uid()}@x.test`, role: "EMPLOYEE" });
    await revokeInvitation(admin, b.invitation.id);
    await expect(acceptInvitationNewUser({ token: tokenOf(b.inviteUrl), name: "B", password: PASSWORD })).rejects.toThrow();

    const c = await createInvitation(admin, { email: `c-${uid()}@x.test`, role: "EMPLOYEE" });
    await prisma.invitation.update({ where: { id: c.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await previewInvitation(tokenOf(c.inviteUrl))).toBeNull();
    await expect(acceptInvitationNewUser({ token: tokenOf(c.inviteUrl), name: "C", password: PASSWORD })).rejects.toThrow();

    await expect(acceptInvitationNewUser({ token: "x".repeat(43), name: "D", password: PASSWORD })).rejects.toThrow();
  });

  it("resend invalidates the old link and issues a new one", async () => {
    const { admin } = await makeOrg();
    const a = await createInvitation(admin, { email: `r-${uid()}@x.test`, role: "MANAGER" });
    const b = await resendInvitation(admin, a.invitation.id);
    expect(tokenOf(b.inviteUrl)).not.toBe(tokenOf(a.inviteUrl));
    expect(await previewInvitation(tokenOf(a.inviteUrl))).toBeNull();
    expect(await previewInvitation(tokenOf(b.inviteUrl))).not.toBeNull();
  });

  it("blocks duplicate pending invites and inviting existing members", async () => {
    const { admin } = await makeOrg();
    const email = `d-${uid()}@x.test`;
    await createInvitation(admin, { email, role: "EMPLOYEE" });
    await expect(createInvitation(admin, { email, role: "EMPLOYEE" })).rejects.toMatchObject({ code: "ALREADY_INVITED" });
    await expect(createInvitation(admin, { email: admin.userEmail, role: "EMPLOYEE" })).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    expect((await listInvitations(admin)).length).toBe(1);
  });

  it("only admins can invite, list or revoke", async () => {
    const { admin } = await makeOrg();
    const { ctx: mgr } = await addMember(admin, "MANAGER");
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    for (const actor of [mgr, emp]) {
      await expect(createInvitation(actor, { email: `z-${uid()}@x.test`, role: "EMPLOYEE" })).rejects.toMatchObject({ status: 403 });
      await expect(listInvitations(actor)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("supports one identity in several organizations (future multi-org): existing user accepts a second invite", async () => {
    const A = await makeOrg("Alpha");
    const B = await makeOrg("Beta");
    const { ctx: aMember, email } = await addMember(A.admin, "EMPLOYEE");
    const inv = await createInvitation(B.admin, { email, role: "MANAGER" });
    const token = tokenOf(inv.inviteUrl);
    expect(await previewInvitation(token)).toMatchObject({ accountExists: true });
    await expect(acceptInvitationNewUser({ token, name: "Dup", password: PASSWORD })).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    // A different signed-in account cannot take this invitation.
    await expect(acceptInvitationExistingUser({ id: B.admin.userId, email: B.admin.userEmail }, token)).rejects.toMatchObject({ code: "WRONG_ACCOUNT" });
    await acceptInvitationExistingUser({ id: aMember.userId, email }, token);
    const rows = await prisma.membership.findMany({ where: { userId: aMember.userId } });
    expect(rows.map((r) => r.organizationId).sort()).toEqual([A.organizationId, B.organizationId].sort());
    expect(rows.find((r) => r.organizationId === B.organizationId)?.role).toBe("MANAGER");
  });
});

describe("3. Role permissions (enforced in services, not UI)", () => {
  it("managers and employees cannot manage the organization, structure or people", async () => {
    const { admin } = await makeOrg();
    const { ctx: mgr } = await addMember(admin, "MANAGER");
    const { ctx: emp } = await addMember(admin, "EMPLOYEE");
    for (const actor of [mgr, emp]) {
      await expect(updateOrganization(actor, { name: "Hacked" })).rejects.toMatchObject({ status: 403 });
      await expect(updateSettings(actor, { editWindowHours: 0 })).rejects.toMatchObject({ status: 403 });
      await expect(createDepartment(actor, { name: "X" })).rejects.toMatchObject({ status: 403 });
      await expect(createTeam(actor, { name: "X" })).rejects.toMatchObject({ status: 403 });
      await expect(updateMember(actor, admin.membershipId, { role: "EMPLOYEE" })).rejects.toMatchObject({ status: 403 });
    }
    await expect(listMembers(emp)).rejects.toMatchObject({ status: 403 });
    await expect(getMember(emp, mgr.membershipId)).rejects.toMatchObject({ status: 403 });
    expect((await getMember(emp, emp.membershipId)).id).toBe(emp.membershipId); // can read self
  });

  it("admin updates organization details and schedule, with audit entries and validation", async () => {
    const { admin } = await makeOrg();
    await updateOrganization(admin, { name: "Renamed Co", timezone: "Europe/Berlin" });
    const s = await updateSettings(admin, { updateCutoffTime: "17:30", editWindowHours: 48, workingDays: [5, 1, 1, 3] });
    expect(s.workingDays).toEqual([1, 3, 5]);
    await expect(updateSettings(admin, { updateCutoffTime: "25:99" })).rejects.toThrow();
    await expect(updateOrganization(admin, { timezone: "Mars/Olympus" })).rejects.toThrow();
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: admin.organizationId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["organization.updated", "settings.updated"]));
  });
});

describe("4. Manager scope — managers only see teams they manage or were granted", () => {
  async function scenario() {
    const { admin } = await makeOrg();
    const m1 = await addMember(admin, "MANAGER");
    const m2 = await addMember(admin, "MANAGER");
    const t1 = await createTeam(admin, { name: "T1", managerId: m1.ctx.membershipId });
    const t2 = await createTeam(admin, { name: "T2", managerId: m2.ctx.membershipId });
    const e1 = await addMember(admin, "EMPLOYEE", { teamId: t1.id });
    const e2 = await addMember(admin, "EMPLOYEE", { teamId: t2.id });
    const e3 = await addMember(admin, "EMPLOYEE", { managerId: m1.ctx.membershipId }); // direct report, no team
    const e4 = await addMember(admin, "EMPLOYEE"); // unrelated
    return { admin, m1, m2, t1, t2, e1, e2, e3, e4 };
  }

  it("lists only team members and direct reports", async () => {
    const s = await scenario();
    const ids = (await listMembers(s.m1.ctx)).map((m) => m.id).sort();
    expect(ids).toEqual([s.e1.ctx.membershipId, s.e3.ctx.membershipId].sort());
    const ids2 = (await listMembers(s.m2.ctx)).map((m) => m.id);
    expect(ids2).toEqual([s.e2.ctx.membershipId]);
  });

  it("returns 404 (not 403) for out-of-scope people, so existence is not revealed", async () => {
    const s = await scenario();
    for (const hidden of [s.e2, s.e4, s.m2]) {
      await expect(getMember(s.m1.ctx, hidden.ctx.membershipId)).rejects.toMatchObject({ status: 404 });
    }
    expect((await getMember(s.m1.ctx, s.e1.ctx.membershipId)).name).toBe(s.e1.ctx.userName);
  });

  it("explicit access grants widen scope; revoking narrows it again; grants vanish if role stops being manager", async () => {
    const s = await scenario();
    await updateMember(s.admin, s.m1.ctx.membershipId, { accessTeamIds: [s.t2.id] });
    expect((await listMembers(s.m1.ctx)).map((m) => m.id)).toContain(s.e2.ctx.membershipId);
    expect((await getMember(s.m1.ctx, s.e2.ctx.membershipId)).id).toBe(s.e2.ctx.membershipId);
    await updateMember(s.admin, s.m1.ctx.membershipId, { accessTeamIds: [] });
    await expect(getMember(s.m1.ctx, s.e2.ctx.membershipId)).rejects.toMatchObject({ status: 404 });
    await updateMember(s.admin, s.m1.ctx.membershipId, { accessTeamIds: [s.t2.id] });
    await updateMember(s.admin, s.m1.ctx.membershipId, { role: "EMPLOYEE" });
    expect(await prisma.managerTeamAccess.count({ where: { membershipId: s.m1.ctx.membershipId } })).toBe(0);
  });

  it("admins see everyone in their own organization", async () => {
    const s = await scenario();
    expect((await listMembers(s.admin)).length).toBe(1 + 2 + 4);
  });
});

describe("5. Organization isolation — one company can never reach another's data", () => {
  async function twoOrgs() {
    const A = await makeOrg("Alpha");
    const B = await makeOrg("Beta");
    const bDept = await createDepartment(B.admin, { name: "BDept" });
    const bMgr = await addMember(B.admin, "MANAGER");
    const bTeam = await createTeam(B.admin, { name: "BTeam", departmentId: bDept.id, managerId: bMgr.ctx.membershipId });
    const bEmp = await addMember(B.admin, "EMPLOYEE", { teamId: bTeam.id });
    return { A, B, bDept, bMgr, bTeam, bEmp };
  }

  it("admin of A cannot read, edit or deactivate people in B (404)", async () => {
    const { A, bEmp } = await twoOrgs();
    const id = bEmp.ctx.membershipId;
    await expect(getMember(A.admin, id)).rejects.toMatchObject({ status: 404 });
    await expect(updateMember(A.admin, id, { status: "DEACTIVATED" })).rejects.toMatchObject({ status: 404 });
    await expect(updateMember(A.admin, id, { role: "ADMIN" })).rejects.toMatchObject({ status: 404 });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    const names = (await listMembers(A.admin)).map((m) => m.id);
    expect(names).not.toContain(id);
  });

  it("A cannot edit/delete B's departments and teams, nor reference them", async () => {
    const { A, bDept, bTeam, bMgr, bEmp } = await twoOrgs();
    await expect(updateTeam(A.admin, bTeam.id, { name: "pwned" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteTeam(A.admin, bTeam.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteDepartment(A.admin, bDept.id)).rejects.toMatchObject({ status: 404 });
    await expect(createTeam(A.admin, { name: "X", departmentId: bDept.id })).rejects.toMatchObject({ status: 400 });
    await expect(createTeam(A.admin, { name: "Y", managerId: bMgr.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
    await expect(createInvitation(A.admin, { email: `i-${uid()}@x.test`, role: "EMPLOYEE", teamId: bTeam.id })).rejects.toMatchObject({ status: 400 });
    await expect(createInvitation(A.admin, { email: `j-${uid()}@x.test`, role: "EMPLOYEE", managerId: bMgr.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
    const aEmp = await addMember(A.admin, "EMPLOYEE");
    await expect(updateMember(A.admin, aEmp.ctx.membershipId, { teamId: bTeam.id })).rejects.toMatchObject({ status: 400 });
    await expect(updateMember(A.admin, aEmp.ctx.membershipId, { managerId: bMgr.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: bTeam.id } })).name).toBe("BTeam");
    expect(bEmp.ctx.organizationId).not.toBe(A.organizationId);
  });

  it("A cannot revoke or resend B's invitations", async () => {
    const { A, B } = await twoOrgs();
    const inv = await createInvitation(B.admin, { email: `k-${uid()}@x.test`, role: "EMPLOYEE" });
    await expect(revokeInvitation(A.admin, inv.invitation.id)).rejects.toMatchObject({ status: 404 });
    await expect(resendInvitation(A.admin, inv.invitation.id)).rejects.toMatchObject({ status: 404 });
    expect((await listInvitations(A.admin)).map((i) => i.id)).not.toContain(inv.invitation.id);
  });

  it("the DATABASE itself rejects cross-organization references (composite foreign keys)", async () => {
    const { A, bTeam, bMgr, bDept } = await twoOrgs();
    // Use a fresh identity for each attempt so only the cross-org reference can be the cause of failure.
    const fresh = async () =>
      (await prisma.user.create({ data: { id: `u-${uid()}`, name: "t", email: `t-${uid()}@x.test` } })).id;
    for (const bad of [{ teamId: bTeam.id }, { managerId: bMgr.ctx.membershipId }, { departmentId: bDept.id }]) {
      const userId = await fresh();
      await expect(
        prisma.membership.create({ data: { userId, organizationId: A.organizationId, role: "EMPLOYEE", ...bad } }),
      ).rejects.toMatchObject({ code: "P2003" }); // foreign key violation
    }
    await expect(prisma.team.create({ data: { organizationId: A.organizationId, name: "Z", departmentId: bDept.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("audit logs are per-organization", async () => {
    const { A, B } = await twoOrgs();
    const logsA = await prisma.auditLog.findMany({ where: { organizationId: A.organizationId } });
    expect(logsA.every((l) => l.organizationId === A.organizationId)).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: B.organizationId } })).toBeGreaterThan(0);
  });
});

describe("6. Employee management rules", () => {
  it("never allows removing the last active admin, nor self-demotion / self-deactivation", async () => {
    const { admin } = await makeOrg();
    await expect(updateMember(admin, admin.membershipId, { status: "DEACTIVATED" })).rejects.toMatchObject({ status: 400 });
    await expect(updateMember(admin, admin.membershipId, { role: "EMPLOYEE" })).rejects.toMatchObject({ status: 400 });
    const second = await addMember(admin, "ADMIN");
    // Two admins try to remove each other. The first wins; the second (acting on a now-stale
    // context) must be stopped by the last-admin rule, not by anything else.
    await updateMember(admin, second.ctx.membershipId, { status: "DEACTIVATED" });
    await expect(updateMember(second.ctx, admin.membershipId, { status: "DEACTIVATED" })).rejects.toMatchObject({ status: 409 });
    await expect(updateMember(second.ctx, admin.membershipId, { role: "EMPLOYEE" })).rejects.toMatchObject({ status: 409 });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: admin.membershipId } })).status).toBe("ACTIVE");
    expect(await prisma.membership.count({ where: { organizationId: admin.organizationId, role: "ADMIN", status: "ACTIVE" } })).toBe(1);
  });

  it("deactivation revokes sessions; reactivation restores; roles/teams/managers assign cleanly", async () => {
    const { admin } = await makeOrg();
    const dept = await createDepartment(admin, { name: "Ops" });
    const team = await createTeam(admin, { name: "Support", departmentId: dept.id });
    const mgr = await addMember(admin, "MANAGER");
    const emp = await addMember(admin, "EMPLOYEE");
    await signIn(emp.email);
    expect(await prisma.session.count({ where: { userId: emp.ctx.userId } })).toBeGreaterThan(0);

    const { member } = await updateMember(admin, emp.ctx.membershipId, { teamId: team.id, managerId: mgr.ctx.membershipId, jobTitle: "Agent" });
    expect(member).toMatchObject({ teamId: team.id, departmentId: dept.id, managerId: mgr.ctx.membershipId, jobTitle: "Agent" });

    await updateMember(admin, emp.ctx.membershipId, { status: "DEACTIVATED" });
    expect(await prisma.session.count({ where: { userId: emp.ctx.userId } })).toBe(0);
    const row = await prisma.membership.findUniqueOrThrow({ where: { id: emp.ctx.membershipId } });
    expect(row.status).toBe("DEACTIVATED");
    expect(row.deactivatedAt).not.toBeNull();
    await updateMember(admin, emp.ctx.membershipId, { status: "ACTIVE" });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: emp.ctx.membershipId } })).deactivatedAt).toBeNull();
  });

  it("prevents reporting loops and rejects employees as managers", async () => {
    const { admin } = await makeOrg();
    const a = await addMember(admin, "MANAGER");
    const b = await addMember(admin, "MANAGER", { managerId: a.ctx.membershipId });
    const emp = await addMember(admin, "EMPLOYEE");
    await expect(updateMember(admin, a.ctx.membershipId, { managerId: b.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
    await expect(updateMember(admin, a.ctx.membershipId, { managerId: a.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
    await expect(updateMember(admin, b.ctx.membershipId, { managerId: emp.ctx.membershipId })).rejects.toMatchObject({ status: 400 });
  });

  it("demoting a manager unassigns their teams and reports, and audits it", async () => {
    const { admin } = await makeOrg();
    const mgr = await addMember(admin, "MANAGER");
    const team = await createTeam(admin, { name: "Alpha", managerId: mgr.ctx.membershipId });
    const emp = await addMember(admin, "EMPLOYEE", { managerId: mgr.ctx.membershipId });
    const { unassigned } = await updateMember(admin, mgr.ctx.membershipId, { role: "EMPLOYEE" });
    expect(unassigned).toEqual({ teams: 1, reports: 1 });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).managerId).toBeNull();
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: emp.ctx.membershipId } })).managerId).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: admin.organizationId, entityId: mgr.ctx.membershipId, action: "member.updated" } });
    expect(JSON.stringify(log.metadata)).toContain("unassigned");
  });

  it("department/team structure: unique names, guarded deletes, department follows team", async () => {
    const { admin } = await makeOrg();
    const d1 = await createDepartment(admin, { name: "Finance" });
    const d2 = await createDepartment(admin, { name: "People" });
    await expect(createDepartment(admin, { name: "Finance" })).rejects.toMatchObject({ status: 409 });
    const t = await createTeam(admin, { name: "AP", departmentId: d1.id });
    await expect(deleteDepartment(admin, d1.id)).rejects.toMatchObject({ status: 409 });
    const e = await addMember(admin, "EMPLOYEE", { teamId: t.id });
    await expect(deleteTeam(admin, t.id)).rejects.toMatchObject({ status: 409 });
    await updateTeam(admin, t.id, { departmentId: d2.id });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: e.ctx.membershipId } })).departmentId).toBe(d2.id);
    await updateMember(admin, e.ctx.membershipId, { teamId: null });
    await deleteTeam(admin, t.id);
    await deleteDepartment(admin, d1.id);
  });
});
