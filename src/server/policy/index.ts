import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import type { Db } from "../db";
import { forbidden } from "../errors";

/**
 * Single source of truth for "who may do what". Every service checks here, on
 * the server. UI visibility (navigation, buttons) mirrors this but never
 * replaces it.
 */
export type Actor = { membershipId: string; organizationId: string; role: Role };

const RULES = {
  "org:update": ["ADMIN"],
  "org:settings": ["ADMIN"],
  "department:manage": ["ADMIN"],
  "team:manage": ["ADMIN"],
  "structure:read": ["ADMIN", "MANAGER", "EMPLOYEE"],
  "member:invite": ["ADMIN"],
  "member:manage": ["ADMIN"],
  "member:list": ["ADMIN", "MANAGER"],
  "audit:read": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof RULES;

export function can(actor: Pick<Actor, "role">, action: Action): boolean {
  return (RULES[action] as readonly Role[]).includes(actor.role);
}

export function assertCan(actor: Pick<Actor, "role">, action: Action): void {
  if (!can(actor, action)) throw forbidden();
}

/** Teams a manager may see: the teams they manage plus teams explicitly granted to them. */
export async function scopedTeamIds(db: Db, actor: Actor): Promise<string[]> {
  const [managed, granted] = await Promise.all([
    db.team.findMany({
      where: { organizationId: actor.organizationId, managerId: actor.membershipId },
      select: { id: true },
    }),
    db.managerTeamAccess.findMany({
      where: { organizationId: actor.organizationId, membershipId: actor.membershipId },
      select: { teamId: true },
    }),
  ]);
  return [...new Set([...managed.map((t) => t.id), ...granted.map((g) => g.teamId)])];
}

/**
 * Prisma `where` limiting memberships to those the actor may see.
 *  - Admin: everyone in their own organization.
 *  - Manager: direct reports, members of managed/granted teams (and optionally themselves).
 *  - Employee: only themselves.
 * `organizationId` is always pinned, so no scope can leak across organizations.
 */
export async function visibleMembershipWhere(
  db: Db,
  actor: Actor,
  opts: { includeSelf?: boolean } = {},
): Promise<Prisma.MembershipWhereInput> {
  const base = { organizationId: actor.organizationId };
  if (actor.role === "ADMIN") return base;
  if (actor.role === "EMPLOYEE") return { ...base, id: actor.membershipId };

  const teamIds = await scopedTeamIds(db, actor);
  const or: Prisma.MembershipWhereInput[] = [{ managerId: actor.membershipId }];
  if (teamIds.length) or.push({ teamId: { in: teamIds } });
  if (opts.includeSelf) or.push({ id: actor.membershipId });
  return { ...base, OR: or };
}
