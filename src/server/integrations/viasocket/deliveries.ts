import { prisma } from "../../db";
import { notFound } from "../../errors";
import type { Actor } from "../../policy";
import { assertAutomationsAccess } from "./access";
import { EVENT_CATALOG } from "./events";

/** Recent deliveries for the Automations page: status and retry history only — never payloads or URLs. */
export async function listRecentDeliveries(actor: Actor, limit = 25) {
  await assertAutomationsAccess(actor);
  const rows = await prisma.integrationDelivery.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true, status: true, attemptCount: true, nextAttemptAt: true, lastHttpStatus: true, lastError: true, createdAt: true, deliveredAt: true,
      event: { select: { eventId: true, type: true, isTest: true } },
      flow: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, status: r.status, attemptCount: r.attemptCount, nextAttemptAt: r.nextAttemptAt.toISOString(),
    lastHttpStatus: r.lastHttpStatus, lastError: r.lastError, createdAt: r.createdAt.toISOString(), deliveredAt: r.deliveredAt?.toISOString() ?? null,
    eventId: r.event.eventId, eventLabel: EVENT_CATALOG[r.event.type].label, isTest: r.event.isTest, flowTitle: r.flow.title,
  }));
}

export async function listAttempts(actor: Actor, deliveryId: string) {
  await assertAutomationsAccess(actor);
  const d = await prisma.integrationDelivery.findFirst({ where: { id: deliveryId, organizationId: actor.organizationId }, select: { id: true } });
  if (!d) throw notFound("Delivery");
  const rows = await prisma.integrationAttempt.findMany({ where: { deliveryId, organizationId: actor.organizationId }, orderBy: { attemptNumber: "asc" } });
  return rows.map((a) => ({
    attemptNumber: a.attemptNumber, startedAt: a.startedAt.toISOString(), durationMs: a.durationMs, outcome: a.outcome, httpStatus: a.httpStatus, errorCode: a.errorCode, errorMessage: a.errorMessage,
  }));
}
