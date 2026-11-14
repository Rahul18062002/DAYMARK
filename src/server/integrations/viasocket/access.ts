import { prisma } from "../../db";
import { forbidden } from "../../errors";
import type { Actor } from "../../policy";

/**
 * Automations are Admin-only by default. An admin can authorize managers with
 * `automationsManagerAccess`. Employees never have access. Settings (including that
 * switch) are admin-only.
 */
export async function automationsAccess(actor: Actor): Promise<{ allowed: boolean; isAdmin: boolean }> {
  if (actor.role === "ADMIN") return { allowed: true, isAdmin: true };
  if (actor.role === "MANAGER") {
    const s = await prisma.orgSettings.findUnique({ where: { organizationId: actor.organizationId }, select: { automationsManagerAccess: true } });
    return { allowed: s?.automationsManagerAccess === true, isAdmin: false };
  }
  return { allowed: false, isAdmin: false };
}

export async function assertAutomationsAccess(actor: Actor) {
  const a = await automationsAccess(actor);
  if (!a.allowed) throw forbidden("You don't have access to Automations.");
  return a;
}
