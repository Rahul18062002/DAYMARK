import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { auth } from "@/server/auth/auth";
import { createOrganizationWithAdmin } from "@/server/services/organization";
import { acceptInvitationNewUser, createInvitation } from "@/server/services/invitations";
import type { Role } from "@/generated/prisma/enums";

export const PASSWORD = "correct-horse-battery";
export const uid = () => randomBytes(4).toString("hex");

export type TestCtx = {
  userId: string; userName: string; userEmail: string;
  membershipId: string; organizationId: string; role: Role;
};

export async function makeOrg(label = "Org") {
  const email = `admin-${uid()}@${label.toLowerCase()}.test`;
  const out = await createOrganizationWithAdmin({
    organizationName: `${label} ${uid()}`, timezone: "Asia/Kolkata", name: `${label} Admin`, email, password: PASSWORD,
  });
  const admin: TestCtx = {
    userId: out.userId, userName: `${label} Admin`, userEmail: email,
    membershipId: out.membershipId, organizationId: out.organizationId, role: "ADMIN",
  };
  return { admin, organizationId: out.organizationId };
}

/** Invite + accept through the real services, returning an actor context for the new member. */
export async function addMember(
  admin: TestCtx, role: Role, extra: { teamId?: string; managerId?: string; departmentId?: string; name?: string } = {},
) {
  const email = `${role.toLowerCase()}-${uid()}@member.test`;
  const name = extra.name ?? `${role} ${uid()}`;
  const inv = await createInvitation(admin, { email, role, ...extra });
  const token = inv.inviteUrl.split("/invite/")[1];
  const acc = await acceptInvitationNewUser({ token, name, password: PASSWORD });
  const ctx: TestCtx = {
    userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id,
    userName: name, userEmail: email, membershipId: acc.membershipId, organizationId: admin.organizationId, role,
  };
  return { ctx, email, token };
}

export const signIn = (email: string, password = PASSWORD) => auth.api.signInEmail({ body: { email, password } });
