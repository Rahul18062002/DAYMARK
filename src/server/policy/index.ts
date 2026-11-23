import type { Prisma } from "@/generated/prisma/client";
import type { Role, VisibilityScope } from "@/generated/prisma/enums";
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
  // Everyone who works in the organization submits their own updates...
  "update:write": ["ADMIN", "MANAGER", "EMPLOYEE"],
  // ...and read other people's within their scope. Managers: their reporting line. Everyone else: only what the
  // organization's visibility setting opens up (see readScope; an employee with visibility OWN is refused there).
  "update:team": ["ADMIN", "MANAGER", "EMPLOYEE"],
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

/** Everyone below `rootId` in the reporting line, at any depth (cycle-safe: UNION removes repeats). */
export async function reportingSubtreeIds(db: Db, organizationId: string, rootId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub(id) AS (
      SELECT "id" FROM "Membership" WHERE "organizationId" = ${organizationId} AND "managerId" = ${rootId}
      UNION
      SELECT m."id" FROM "Membership" m JOIN sub ON m."managerId" = sub.id WHERE m."organizationId" = ${organizationId}
    )
    SELECT "id" FROM sub`;
  return rows.map((r) => r.id);
}

/**
 * Prisma `where` limiting memberships to those the actor MANAGES (the management scope).
 *  - Admin: everyone in their own organization.
 *  - Manager: their whole reporting line (reports of reports, at any depth), members of managed/granted teams
 *    (and optionally themselves).
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

  const [teamIds, subtree] = await Promise.all([scopedTeamIds(db, actor), reportingSubtreeIds(db, actor.organizationId, actor.membershipId)]);
  const or: Prisma.MembershipWhereInput[] = [];
  if (subtree.length) or.push({ id: { in: subtree } });
  if (teamIds.length) or.push({ teamId: { in: teamIds } });
  if (opts.includeSelf) or.push({ id: actor.membershipId });
  return or.length ? { ...base, OR: or } : { ...base, id: "__none__" };
}

/** The chain of managers above `id`, nearest first (cycle-safe). */
export async function ancestorIds(db: Db, organizationId: string, id: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE up(id) AS (
      SELECT "managerId" FROM "Membership" WHERE "id" = ${id} AND "organizationId" = ${organizationId} AND "managerId" IS NOT NULL
      UNION
      SELECT m."managerId" FROM "Membership" m JOIN up ON m."id" = up.id WHERE m."organizationId" = ${organizationId} AND m."managerId" IS NOT NULL
    )
    SELECT "id" FROM up`;
  return rows.map((r) => r.id);
}

export type Visibility = { scope: VisibilityScope; peersSeeBlockers: boolean };

export async function orgVisibility(db: Db, organizationId: string): Promise<Visibility> {
  const s = await db.orgSettings.findUnique({ where: { organizationId }, select: { visibilityScope: true, peersSeeBlockers: true } });
  return { scope: s?.visibilityScope ?? "OWN", peersSeeBlockers: s?.peersSeeBlockers ?? false };
}

export type ReadScope = {
  /** Whose submitted updates the actor may read. */
  where: Prisma.MembershipWhereInput;
  /** Admin or manager: may also see who has NOT submitted, and manage people. Everyone else reads submitted work only. */
  isManagement: boolean;
  visibility: Visibility;
  /** May the actor read this person's blockers? Own and managed people always; peers only when the company allows it. */
  blockersFor(membershipId: string): boolean;
  /** Limit for queries that must only see blocker text: null = no restriction needed. */
  blockerMembershipIds: string[] | null;
};

/**
 * What the actor may READ about other people (transparency), as opposed to what they may manage.
 *  management scope  ∪  whatever the organization's `visibilityScope` opens up  ∪  themselves.
 * An employee in a company that has not opened visibility (OWN) gets no team view at all.
 */
export async function readScope(db: Db, actor: Actor): Promise<ReadScope> {
  const vis = await orgVisibility(db, actor.organizationId);
  const base = { organizationId: actor.organizationId };
  const isManagement = actor.role === "ADMIN" || actor.role === "MANAGER";
  if (actor.role === "ADMIN") return { where: base, isManagement, visibility: vis, blockersFor: () => true, blockerMembershipIds: null };
  if (!isManagement && vis.scope === "OWN") throw forbidden();

  const me = await db.membership.findFirstOrThrow({ where: { id: actor.membershipId, ...base }, select: { teamId: true, departmentId: true, managerId: true } });
  const mgmt = await visibleMembershipWhere(db, actor);
  const extra: Prisma.MembershipWhereInput[] = [];
  if (vis.scope === "COMPANY") extra.push(base);
  else if (vis.scope === "TEAM" || vis.scope === "DEPARTMENT") {
    // your own managers, all the way up, are part of your picture
    const up = await ancestorIds(db, actor.organizationId, actor.membershipId);
    if (up.length) extra.push({ ...base, id: { in: up } });
    if (me.teamId) extra.push({ ...base, teamId: me.teamId });
    if (me.managerId) extra.push({ ...base, managerId: me.managerId });
    if (vis.scope === "DEPARTMENT" && me.departmentId) extra.push({ ...base, departmentId: me.departmentId });
  }
  const where: Prisma.MembershipWhereInput = vis.scope === "COMPANY" ? base : { AND: [{ OR: [mgmt, ...extra] }, base] };

  const managed = new Set((await db.membership.findMany({ where: mgmt, select: { id: true } })).map((m) => m.id));
  managed.add(actor.membershipId);
  const blockersFor = (id: string) => vis.peersSeeBlockers || managed.has(id);
  return { where, isManagement, visibility: vis, blockersFor, blockerMembershipIds: vis.peersSeeBlockers ? null : [...managed] };
}

/** Can this person open the team view at all? Admins and managers always; everyone else only when the company opened visibility. */
export async function canOpenTeamView(db: Db, actor: Actor): Promise<boolean> {
  if (actor.role === "ADMIN" || actor.role === "MANAGER") return true;
  return (await orgVisibility(db, actor.organizationId)).scope !== "OWN";
}
