import { prisma } from "../db";
import { assertCan, type Actor } from "../policy";

export async function adminOverview(actor: Actor) {
  assertCan(actor, "audit:read");
  const orgId = actor.organizationId;
  const [byStatus, departments, teams, pendingInvites, activity] = await Promise.all([
    prisma.membership.groupBy({ by: ["role", "status"], where: { organizationId: orgId }, _count: true }),
    prisma.department.count({ where: { organizationId: orgId } }),
    prisma.team.count({ where: { organizationId: orgId } }),
    prisma.invitation.count({ where: { organizationId: orgId, status: "PENDING", expiresAt: { gt: new Date() } } }),
    prisma.auditLog.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const active = byStatus.filter((r) => r.status === "ACTIVE");
  const count = (role: string) => active.filter((r) => r.role === role).reduce((n, r) => n + r._count, 0);

  const userIds = [...new Set(activity.map((a) => a.userId).filter((v): v is string => !!v))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));

  return {
    activePeople: active.reduce((n, r) => n + r._count, 0),
    admins: count("ADMIN"),
    managers: count("MANAGER"),
    employees: count("EMPLOYEE"),
    deactivated: byStatus.filter((r) => r.status === "DEACTIVATED").reduce((n, r) => n + r._count, 0),
    departments,
    teams,
    pendingInvites,
    activity: activity.map((a) => ({
      id: a.id, action: a.action, entityType: a.entityType, actor: a.userId ? (names.get(a.userId) ?? "Someone") : "System",
      createdAt: a.createdAt.toISOString(), metadata: a.metadata as Record<string, unknown> | null,
    })),
  };
}
