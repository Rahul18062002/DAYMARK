import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { forbidden, unauthorized } from "../errors";
import { auth } from "./auth";

/**
 * The authenticated actor for one request. Everything is derived on the server
 * from the session cookie — organization, role and ids are never taken from
 * request bodies, query strings or headers.
 */
export type Ctx = {
  userId: string;
  userName: string;
  userEmail: string;
  membershipId: string;
  organizationId: string;
  role: Role;
};

export const ACTIVE_ORG_COOKIE = "daymark_org";

export type SessionState = { userId: string; userName: string; userEmail: string; ctx: Ctx | null };

export async function resolveSessionState(h: Headers, preferredOrgId?: string): Promise<SessionState | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const { id: userId, name: userName, email: userEmail } = session.user;

  // A user may hold memberships in several organizations (future). The active one
  // is the preferred (cookie) membership if it is still active, else the oldest.
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true, role: true },
  });
  const m = memberships.find((x) => x.organizationId === preferredOrgId) ?? memberships[0];
  return {
    userId,
    userName,
    userEmail,
    ctx: m ? { userId, userName, userEmail, membershipId: m.id, organizationId: m.organizationId, role: m.role } : null,
  };
}

export const getSessionState = cache(async (): Promise<SessionState | null> => {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return resolveSessionState(h, c.get(ACTIVE_ORG_COOKIE)?.value);
});

/** For route handlers and server code: throws 401 / 403 instead of redirecting. */
export async function requireContext(): Promise<Ctx> {
  const state = await getSessionState();
  if (!state) throw unauthorized();
  if (!state.ctx) throw forbidden("Your account has no active workspace.");
  return state.ctx;
}

/** For server components (pages/layouts): redirects to sign-in or "no access" instead of throwing. */
export async function requirePageContext(): Promise<Ctx> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (!state.ctx) redirect("/no-access");
  return state.ctx;
}
