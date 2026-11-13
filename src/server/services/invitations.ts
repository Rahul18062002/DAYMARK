import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { audit } from "../audit";
import { appUrl } from "../env";
import { assertCan, type Actor } from "../policy";
import { badRequest, conflict, notFound } from "../errors";
import { auth, withUserCreation } from "../auth/auth";
import { isEmailConfigured, sendMail } from "../email/mailer";
import { invitationEmail } from "../email/templates";
import { acceptInviteSchema, inviteSchema } from "../validation";
import { lockOrganization } from "./db-errors";
import { resolveAssignment } from "./members";

type A = Actor & { userId: string };

export const INVITE_TTL_DAYS = 7;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const inviteUrl = (token: string) => `${appUrl()}/invite/${token}`;

export type InvitationDto = {
  id: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expired: boolean;
  expiresAt: string;
  createdAt: string;
  teamId: string | null;
  departmentId: string | null;
  managerId: string | null;
};

type Delivery = { emailSent: boolean; emailConfigured: boolean; emailError?: string };

async function deliver(orgName: string, inviterName: string, role: string, email: string, token: string): Promise<Delivery> {
  if (!isEmailConfigured()) return { emailSent: false, emailConfigured: false };
  const mail = invitationEmail({ organizationName: orgName, inviterName, role, url: inviteUrl(token), expiresInDays: INVITE_TTL_DAYS });
  const res = await sendMail({ to: email, ...mail });
  return res.sent ? { emailSent: true, emailConfigured: true } : { emailSent: false, emailConfigured: true, emailError: res.reason };
}

function toDto(i: {
  id: string; email: string; role: InvitationDto["role"]; status: InvitationDto["status"]; expiresAt: Date; createdAt: Date;
  teamId: string | null; departmentId: string | null; managerId: string | null;
}): InvitationDto {
  return {
    id: i.id, email: i.email, role: i.role, status: i.status,
    expired: i.status === "PENDING" && i.expiresAt < new Date(),
    expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString(),
    teamId: i.teamId, departmentId: i.departmentId, managerId: i.managerId,
  };
}

export async function listInvitations(actor: Actor) {
  assertCan(actor, "member:invite");
  const rows = await prisma.invitation.findMany({
    where: { organizationId: actor.organizationId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

/**
 * Creates an invitation. The raw token exists only in the returned link / email;
 * only its hash is stored. `inviteUrl` is returned so the admin can copy it when
 * email is not configured (or delivery fails).
 */
export async function createInvitation(actor: A & { userName: string }, input: unknown) {
  assertCan(actor, "member:invite");
  const data = inviteSchema.parse(input);
  const token = newToken();

  const { invitation, orgName } = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);

    const existingMember = await tx.membership.findFirst({
      where: { organizationId: actor.organizationId, user: { email: data.email } },
      select: { id: true },
    });
    if (existingMember) throw conflict("That person is already a member of your organization.", "ALREADY_MEMBER");

    const pending = await tx.invitation.findFirst({
      where: { organizationId: actor.organizationId, email: data.email, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (pending) throw conflict("There is already a pending invitation for that email. Resend or revoke it instead.", "ALREADY_INVITED");

    const refs = await resolveAssignment(tx, actor.organizationId, {
      departmentId: data.departmentId, teamId: data.teamId, managerId: data.managerId,
    });

    const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true } });
    const invitation = await tx.invitation.create({
      data: {
        organizationId: actor.organizationId,
        email: data.email,
        role: data.role,
        departmentId: refs.departmentId ?? null,
        teamId: refs.teamId ?? null,
        managerId: refs.managerId ?? null,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        invitedById: actor.membershipId,
      },
    });
    await audit(tx, {
      organizationId: actor.organizationId, userId: actor.userId, action: "invitation.created",
      entityType: "Invitation", entityId: invitation.id, metadata: { email: data.email, role: data.role },
    });
    return { invitation, orgName: org.name };
  });

  const delivery = await deliver(orgName, actor.userName, data.role, data.email, token);
  return { invitation: toDto(invitation), inviteUrl: inviteUrl(token), ...delivery };
}

export async function resendInvitation(actor: A & { userName: string }, id: string) {
  assertCan(actor, "member:invite");
  const token = newToken();
  const { invitation, orgName } = await prisma.$transaction(async (tx) => {
    const found = await tx.invitation.findFirst({ where: { id, organizationId: actor.organizationId, status: "PENDING" } });
    if (!found) throw notFound("Invitation");
    const invitation = await tx.invitation.update({
      where: { id },
      data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
    });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "invitation.resent", entityType: "Invitation", entityId: id });
    return { invitation, orgName: org.name };
  });
  const delivery = await deliver(orgName, actor.userName, invitation.role, invitation.email, token);
  return { invitation: toDto(invitation), inviteUrl: inviteUrl(token), ...delivery };
}

export async function revokeInvitation(actor: A, id: string) {
  assertCan(actor, "member:invite");
  await prisma.$transaction(async (tx) => {
    const res = await tx.invitation.updateMany({
      where: { id, organizationId: actor.organizationId, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    if (res.count === 0) throw notFound("Invitation");
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "invitation.revoked", entityType: "Invitation", entityId: id });
  });
}

async function findUsableInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { organization: { select: { name: true } }, invitedBy: { select: { user: { select: { name: true } } } } },
  });
  if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Public preview for the invitation page. Invalid, expired and revoked all look the same. */
export async function previewInvitation(token: string) {
  const inv = await findUsableInvitation(token);
  if (!inv) return null;
  const existingUser = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return {
    organizationName: inv.organization.name,
    inviterName: inv.invitedBy.user.name,
    email: inv.email,
    role: inv.role,
    accountExists: Boolean(existingUser),
  };
}

type InvitationRow = NonNullable<Awaited<ReturnType<typeof findUsableInvitation>>>;

async function claimAndCreateMembership(inv: InvitationRow, userId: string) {
  return prisma.$transaction(async (tx) => {
    // Atomically claim the invitation: a second concurrent accept updates 0 rows.
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count === 0) throw badRequest("This invitation is no longer valid.");

    // Re-validate preset assignments; they may have changed since the invite was sent.
    const [team, dept, mgr] = await Promise.all([
      inv.teamId ? tx.team.findFirst({ where: { id: inv.teamId, organizationId: inv.organizationId }, select: { id: true, departmentId: true } }) : null,
      inv.departmentId ? tx.department.findFirst({ where: { id: inv.departmentId, organizationId: inv.organizationId }, select: { id: true } }) : null,
      inv.managerId ? tx.membership.findFirst({ where: { id: inv.managerId, organizationId: inv.organizationId, status: "ACTIVE", role: { in: ["MANAGER", "ADMIN"] } }, select: { id: true } }) : null,
    ]);

    const membership = await tx.membership.create({
      data: {
        userId,
        organizationId: inv.organizationId,
        role: inv.role,
        teamId: team?.id ?? null,
        departmentId: team?.departmentId ?? dept?.id ?? null,
        managerId: mgr?.id ?? null,
      },
    });
    await audit(tx, {
      organizationId: inv.organizationId, userId, action: "invitation.accepted",
      entityType: "Invitation", entityId: inv.id, metadata: { membershipId: membership.id, role: inv.role },
    });
    return { organizationId: inv.organizationId, membershipId: membership.id };
  });
}

/** New person: creates their identity (password) and membership in one accept step. */
export async function acceptInvitationNewUser(input: unknown) {
  const data = acceptInviteSchema.parse(input);
  const inv = await findUsableInvitation(data.token);
  if (!inv) throw badRequest("This invitation is invalid or has expired. Ask your admin for a new one.", );

  const existing = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  if (existing) throw conflict("An account already exists for this email. Sign in to accept the invitation.", "ACCOUNT_EXISTS");

  const res = await withUserCreation(() =>
    auth.api.signUpEmail({ body: { name: data.name, email: inv.email, password: data.password } }),
  ).catch(async (e) => {
    if (await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } })) {
      throw conflict("An account already exists for this email. Sign in to accept the invitation.", "ACCOUNT_EXISTS");
    }
    throw e;
  });

  try {
    // Receiving the invitation at this address proves ownership of the email.
    await prisma.user.update({ where: { id: res.user.id }, data: { emailVerified: true } });
    const out = await claimAndCreateMembership(inv, res.user.id);
    return { ...out, email: inv.email };
  } catch (e) {
    await prisma.user.delete({ where: { id: res.user.id } }).catch(() => undefined);
    throw e;
  }
}

/** Existing identity (e.g. already in another organization): must be signed in as the invited email. */
export async function acceptInvitationExistingUser(user: { id: string; email: string }, token: string) {
  const inv = await findUsableInvitation(token);
  if (!inv) throw badRequest("This invitation is invalid or has expired. Ask your admin for a new one.");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw conflict(`This invitation was sent to ${inv.email}. Sign in with that account to accept it.`, "WRONG_ACCOUNT");
  }
  const already = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } },
    select: { id: true },
  });
  if (already) throw conflict("You are already a member of this organization.", "ALREADY_MEMBER");
  return claimAndCreateMembership(inv, user.id);
}
