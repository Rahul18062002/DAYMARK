import { prisma } from "../db";
import { audit } from "../audit";
import type { Actor } from "../policy";
import { assertCan } from "../policy";
import { conflict, notFound, badRequest } from "../errors";
import { departmentSchema, teamSchema, teamUpdateSchema } from "../validation";
import { mapDbError } from "./db-errors";

type A = Actor & { userId: string };

export async function listDepartments(actor: Actor) {
  assertCan(actor, "structure:read");
  const rows = await prisma.department.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { teams: true, members: true } } },
  });
  return rows.map((d) => ({ id: d.id, name: d.name, teamCount: d._count.teams, memberCount: d._count.members }));
}

export async function listTeams(actor: Actor) {
  assertCan(actor, "structure:read");
  const rows = await prisma.team.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    include: {
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, user: { select: { name: true } } } },
      _count: { select: { members: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    departmentId: t.departmentId,
    departmentName: t.department?.name ?? null,
    managerId: t.managerId,
    managerName: t.manager?.user.name ?? null,
    memberCount: t._count.members,
  }));
}

export async function createDepartment(actor: A, input: unknown) {
  assertCan(actor, "department:manage");
  const { name } = departmentSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const d = await tx.department.create({ data: { organizationId: actor.organizationId, name } });
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "department.created", entityType: "Department", entityId: d.id, metadata: { name } });
      return d;
    });
  } catch (e) {
    mapDbError(e, { unique: "A department with that name already exists." });
  }
}

export async function renameDepartment(actor: A, id: string, input: unknown) {
  assertCan(actor, "department:manage");
  const { name } = departmentSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const found = await tx.department.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!found) throw notFound("Department");
      const d = await tx.department.update({ where: { id }, data: { name } });
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "department.renamed", entityType: "Department", entityId: id, metadata: { from: found.name, to: name } });
      return d;
    });
  } catch (e) {
    mapDbError(e, { unique: "A department with that name already exists." });
  }
}

export async function deleteDepartment(actor: A, id: string) {
  assertCan(actor, "department:manage");
  await prisma.$transaction(async (tx) => {
    const found = await tx.department.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { teams: true, members: true } } },
    });
    if (!found) throw notFound("Department");
    if (found._count.teams || found._count.members) {
      throw conflict("Move this department's teams and people elsewhere before deleting it.");
    }
    await tx.department.delete({ where: { id } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "department.deleted", entityType: "Department", entityId: id, metadata: { name: found.name } });
  });
}

async function assertValidTeamRefs(
  tx: Pick<typeof prisma, "department" | "membership">,
  organizationId: string,
  departmentId?: string | null,
  managerId?: string | null,
) {
  if (departmentId) {
    const d = await tx.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
    if (!d) throw badRequest("Choose a department from your organization.");
  }
  if (managerId) {
    const m = await tx.membership.findFirst({
      where: { id: managerId, organizationId, status: "ACTIVE", role: { in: ["MANAGER", "ADMIN"] } },
      select: { id: true },
    });
    if (!m) throw badRequest("A team manager must be an active manager or admin in your organization.");
  }
}

export async function createTeam(actor: A, input: unknown) {
  assertCan(actor, "team:manage");
  const data = teamSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertValidTeamRefs(tx, actor.organizationId, data.departmentId, data.managerId);
      const t = await tx.team.create({
        data: { organizationId: actor.organizationId, name: data.name, departmentId: data.departmentId ?? null, managerId: data.managerId ?? null },
      });
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "team.created", entityType: "Team", entityId: t.id, metadata: { name: t.name } });
      return t;
    });
  } catch (e) {
    mapDbError(e, { unique: "A team with that name already exists." });
  }
}

export async function updateTeam(actor: A, id: string, input: unknown) {
  assertCan(actor, "team:manage");
  const data = teamUpdateSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const found = await tx.team.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!found) throw notFound("Team");
      await assertValidTeamRefs(tx, actor.organizationId, data.departmentId, data.managerId);
      const t = await tx.team.update({
        where: { id },
        data: { name: data.name, departmentId: data.departmentId, managerId: data.managerId },
      });
      // Keep members' department in step with their team's department.
      if (data.departmentId !== undefined && data.departmentId !== found.departmentId) {
        await tx.membership.updateMany({
          where: { organizationId: actor.organizationId, teamId: id },
          data: { departmentId: data.departmentId },
        });
      }
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "team.updated", entityType: "Team", entityId: id, metadata: { changed: Object.keys(data) } });
      return t;
    });
  } catch (e) {
    mapDbError(e, { unique: "A team with that name already exists." });
  }
}

export async function deleteTeam(actor: A, id: string) {
  assertCan(actor, "team:manage");
  await prisma.$transaction(async (tx) => {
    const found = await tx.team.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { members: true } } },
    });
    if (!found) throw notFound("Team");
    if (found._count.members) throw conflict("Move this team's members to another team before deleting it.");
    await tx.team.delete({ where: { id } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "team.deleted", entityType: "Team", entityId: id, metadata: { name: found.name } });
  });
}
