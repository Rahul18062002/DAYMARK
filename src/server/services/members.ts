import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { assertCan, visibleMembershipWhere, type Actor } from "../policy";
import { badRequest, conflict, notFound } from "../errors";
import { memberFilterSchema, memberUpdateSchema } from "../validation";
import { lockOrganization } from "./db-errors";

type A = Actor & { userId: string };

const memberSelect = {
  id: true,
  role: true,
  status: true,
  jobTitle: true,
  departmentId: true,
  teamId: true,
  managerId: true,
  createdAt: true,
  deactivatedAt: true,
  user: { select: { name: true, email: true } },
  department: { select: { name: true } },
  team: { select: { name: true } },
  manager: { select: { user: { select: { name: true } } } },
  teamAccess: { select: { teamId: true } },
} satisfies Prisma.MembershipSelect;

type Row = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

export type MemberDto = ReturnType<typeof toDto>;

function toDto(m: Row) {
  return {
    id: m.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    jobTitle: m.jobTitle,
    departmentId: m.departmentId,
    departmentName: m.department?.name ?? null,
    teamId: m.teamId,
    teamName: m.team?.name ?? null,
    managerId: m.managerId,
    managerName: m.manager?.user.name ?? null,
    accessTeamIds: m.teamAccess.map((a) => a.teamId),
    createdAt: m.createdAt.toISOString(),
    deactivatedAt: m.deactivatedAt?.toISOString() ?? null,
  };
}

/** Members the actor is allowed to see (admin: all; manager: their scope only). */
export async function listMembers(actor: Actor, rawFilters: unknown = {}) {
  assertCan(actor, "member:list");
  const f = memberFilterSchema.parse(rawFilters);
  const scope = await visibleMembershipWhere(prisma, actor);
  const where: Prisma.MembershipWhereInput = {
    AND: [
      scope,
      {
        status: f.status,
        role: f.role,
        departmentId: f.departmentId,
        teamId: f.teamId,
        ...(f.q
          ? { user: { OR: [{ name: { contains: f.q } }, { email: { contains: f.q } }] } }
          : {}),
      },
    ],
  };
  const rows = await prisma.membership.findMany({
    where,
    select: memberSelect,
    orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
  });
  return rows.map(toDto);
}

export async function getMember(actor: Actor, id: string) {
  // Everyone can read themselves; otherwise the target must be inside the actor's scope.
  const where: Prisma.MembershipWhereInput =
    id === actor.membershipId
      ? { id, organizationId: actor.organizationId }
      : { AND: [{ id }, await (assertCan(actor, "member:list"), visibleMembershipWhere(prisma, actor))] };
  const m = await prisma.membership.findFirst({ where, select: memberSelect });
  if (!m) throw notFound("Person");
  return toDto(m);
}

/** Active managers/admins who can be chosen as someone's manager. */
export async function listAssignableManagers(actor: Actor) {
  assertCan(actor, "member:manage");
  const rows = await prisma.membership.findMany({
    where: { organizationId: actor.organizationId, status: "ACTIVE", role: { in: ["MANAGER", "ADMIN"] } },
    select: { id: true, role: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((r) => ({ id: r.id, name: r.user.name, role: r.role }));
}

/** Throws unless every reference belongs to the organization and is assignable. */
export async function resolveAssignment(
  tx: Tx | typeof prisma,
  organizationId: string,
  input: { departmentId?: string | null; teamId?: string | null; managerId?: string | null },
  selfId?: string,
): Promise<{ departmentId: string | null | undefined; teamId: string | null | undefined; managerId: string | null | undefined }> {
  let { departmentId, teamId, managerId } = input;

  if (teamId) {
    const team = await tx.team.findFirst({ where: { id: teamId, organizationId }, select: { id: true, departmentId: true } });
    if (!team) throw badRequest("Choose a team from your organization.");
    // A team belongs to (at most) one department; the member follows it.
    if (team.departmentId) departmentId = team.departmentId;
  }
  if (departmentId) {
    const dept = await tx.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
    if (!dept) throw badRequest("Choose a department from your organization.");
  }
  if (managerId) {
    if (managerId === selfId) throw badRequest("A person can't be their own manager.");
    const mgr = await tx.membership.findFirst({
      where: { id: managerId, organizationId, status: "ACTIVE", role: { in: ["MANAGER", "ADMIN"] } },
      select: { id: true },
    });
    if (!mgr) throw badRequest("A manager must be an active manager or admin in your organization.");
    // Reject reporting cycles (A → B → A).
    if (selfId) {
      let cursor: string | null = managerId;
      for (let i = 0; cursor && i < 100; i++) {
        if (cursor === selfId) throw badRequest("That would create a reporting loop.");
        const next: { managerId: string | null } | null = await tx.membership.findFirst({
          where: { id: cursor, organizationId },
          select: { managerId: true },
        });
        cursor = next?.managerId ?? null;
      }
    }
  }
  return { departmentId, teamId, managerId };
}

export async function updateMember(actor: A, id: string, input: unknown) {
  assertCan(actor, "member:manage");
  const data = memberUpdateSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);

    const target = await tx.membership.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!target) throw notFound("Person");

    const nextRole: Role = data.role ?? target.role;
    const nextStatus = data.status ?? target.status;

    if (target.id === actor.membershipId && (nextRole !== target.role || nextStatus !== "ACTIVE")) {
      throw badRequest("You can't change your own role or deactivate your own account.");
    }

    // Never leave an organization without an active admin.
    if (target.role === "ADMIN" && (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")) {
      const others = await tx.membership.count({
        where: { organizationId: actor.organizationId, role: "ADMIN", status: "ACTIVE", id: { not: target.id } },
      });
      if (others === 0) throw conflict("Your organization needs at least one active admin.");
    }

    const assignmentTouched = ["departmentId", "teamId", "managerId"].some((k) => k in data);
    const assigned = assignmentTouched
      ? await resolveAssignment(
          tx,
          actor.organizationId,
          {
            departmentId: "departmentId" in data ? data.departmentId : undefined,
            // If only the department changes, still honour the member's current team's department.
            teamId: "teamId" in data ? data.teamId : "departmentId" in data ? target.teamId : undefined,
            managerId: "managerId" in data ? data.managerId : undefined,
          },
          target.id,
        )
      : { departmentId: undefined, teamId: undefined, managerId: undefined };

    // Moving someone onto a team re-derives their department from the team.
    const departmentId = assigned.departmentId;

    const unassigned = { teams: 0, reports: 0 };
    if (target.role === "MANAGER" && nextRole === "EMPLOYEE") {
      // Their managerial links are removed explicitly (and audited), never silently orphaned.
      unassigned.teams = (await tx.team.updateMany({ where: { organizationId: actor.organizationId, managerId: target.id }, data: { managerId: null } })).count;
      unassigned.reports = (await tx.membership.updateMany({ where: { organizationId: actor.organizationId, managerId: target.id }, data: { managerId: null } })).count;
    }

    // Extra team access only makes sense for managers.
    if (nextRole !== "MANAGER") {
      await tx.managerTeamAccess.deleteMany({ where: { organizationId: actor.organizationId, membershipId: target.id } });
    } else if (data.accessTeamIds) {
      const ids = [...new Set(data.accessTeamIds)];
      const valid = await tx.team.count({ where: { organizationId: actor.organizationId, id: { in: ids } } });
      if (valid !== ids.length) throw badRequest("Choose teams from your organization.");
      await tx.managerTeamAccess.deleteMany({ where: { organizationId: actor.organizationId, membershipId: target.id } });
      if (ids.length) {
        await tx.managerTeamAccess.createMany({
          data: ids.map((teamId) => ({ organizationId: actor.organizationId, membershipId: target.id, teamId })),
        });
      }
    }

    const statusChanged = nextStatus !== target.status;
    const updated = await tx.membership.update({
      where: { id: target.id },
      data: {
        role: data.role,
        status: data.status,
        jobTitle: data.jobTitle === undefined ? undefined : data.jobTitle || null,
        departmentId,
        teamId: assigned.teamId,
        managerId: assigned.managerId,
        deactivatedAt: statusChanged ? (nextStatus === "DEACTIVATED" ? new Date() : null) : undefined,
      },
      select: memberSelect,
    });

    if (statusChanged && nextStatus === "DEACTIVATED") {
      // Sign the person out everywhere unless they still belong to another active workspace.
      const other = await tx.membership.count({ where: { userId: target.userId, status: "ACTIVE", id: { not: target.id } } });
      if (other === 0) await tx.session.deleteMany({ where: { userId: target.userId } });
    }

    await audit(tx, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: statusChanged ? (nextStatus === "DEACTIVATED" ? "member.deactivated" : "member.reactivated") : "member.updated",
      entityType: "Membership",
      entityId: target.id,
      metadata: {
        changed: Object.keys(data),
        from: { role: target.role, status: target.status, teamId: target.teamId, managerId: target.managerId, departmentId: target.departmentId },
        to: { role: updated.role, status: updated.status, teamId: updated.teamId, managerId: updated.managerId, departmentId: updated.departmentId },
        ...(unassigned.teams || unassigned.reports ? { unassigned } : {}),
      },
    });
    return { member: toDto(updated), unassigned };
  });
}
