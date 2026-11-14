import type { IntegrationEventType } from "@/generated/prisma/enums";
import { prisma } from "../../db";
import { audit } from "../../audit";
import { badRequest, notFound } from "../../errors";
import type { Actor } from "../../policy";
import { assertAutomationsAccess } from "./access";
import { isViaSocketConfigured, orgIdentity } from "./config";
import { encryptSecret, flowKey } from "./crypto";
import { gateway } from "./gateway";
import { deliverPendingForEvent, type Deps } from "./dispatch";
import { EVENT_TYPES, enqueueEvent, newTestEventKey, samplePayload } from "./events";
import { z } from "zod";

type A = Actor & { userId: string };

// viaSocket reports an unpublished flow as "drafted"; it can't receive events and means nothing to an admin yet.
const normalizeStatus = (s: string): string => (s === "drafted" ? "draft" : ["active", "paused", "deleted"].includes(s) ? s : "unknown");

/**
 * Re-read the organization's flows from viaSocket (server-side, for the SESSION's organization
 * identity) and cache them. The browser only ever says "something changed"; it never supplies a
 * flow id or URL we would trust.
 */
export async function syncFlows(actor: A) {
  await assertAutomationsAccess(actor);
  if (!isViaSocketConfigured()) throw badRequest("Automations aren't configured on this server.");
  const flows = await gateway().listFlows(orgIdentity(actor.organizationId));

  const seen = new Set<string>();
  for (const f of flows) {
    if (!f.id || !f.webhook) continue;
    let host: string;
    try { host = new URL(f.webhook).host; } catch { continue; }
    if (host !== "flow.sokt.io") continue; // only genuine viaSocket run URLs are ever stored
    const key = flowKey(f.id);
    seen.add(key);
    const data = { title: (f.title || "Untitled automation").slice(0, 200), description: f.description?.slice(0, 500) || null, status: normalizeStatus(f.status), urlEnc: encryptSecret(f.webhook), lastSyncedAt: new Date() };
    await prisma.automationFlow.upsert({
      where: { organizationId_flowKey: { organizationId: actor.organizationId, flowKey: key } },
      create: { organizationId: actor.organizationId, flowKey: key, ...data },
      update: data,
    });
  }
  // Flows that viaSocket no longer lists are gone.
  await prisma.automationFlow.updateMany({
    where: { organizationId: actor.organizationId, flowKey: { notIn: [...seen] }, status: { not: "deleted" } },
    data: { status: "deleted", lastSyncedAt: new Date() },
  });
  return listFlowsForOrg(actor);
}

export async function listFlowsForOrg(actor: Actor) {
  await assertAutomationsAccess(actor);
  const rows = await prisma.automationFlow.findMany({
    where: { organizationId: actor.organizationId, status: { notIn: ["deleted", "draft"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, description: true, status: true, eventType: true, lastSyncedAt: true },
  });
  return rows.map((r) => ({ ...r, lastSyncedAt: r.lastSyncedAt.toISOString() }));
}

const linkSchema = z.object({ eventType: z.enum(EVENT_TYPES as [IntegrationEventType, ...IntegrationEventType[]]).nullable() });

/** Admin chooses which Daymark event starts a flow (or unlinks it). Scoped to the caller's organization. */
export async function linkFlow(actor: A, flowId: string, input: unknown) {
  await assertAutomationsAccess(actor);
  const { eventType } = linkSchema.parse(input);
  const flow = await prisma.automationFlow.findFirst({ where: { id: flowId, organizationId: actor.organizationId, status: { not: "deleted" } } });
  if (!flow) throw notFound("Automation");
  await prisma.$transaction(async (tx) => {
    await tx.automationFlow.update({ where: { id: flowId }, data: { eventType } });
    await audit(tx, {
      organizationId: actor.organizationId, userId: actor.userId,
      action: eventType ? "automation.flow_linked" : "automation.flow_unlinked", entityType: "AutomationFlow", entityId: flowId,
      metadata: { eventType, from: flow.eventType },
    });
  });
  return { ok: true };
}

/** "Send test event": a clearly synthetic payload to ONE flow, so users can test without real employee data. */
export async function sendTestEvent(actor: A, flowId: string, deps: Deps = {}) {
  await assertAutomationsAccess(actor);
  const flow = await prisma.automationFlow.findFirst({ where: { id: flowId, organizationId: actor.organizationId, status: { not: "deleted" } } });
  if (!flow) throw notFound("Automation");
  if (!flow.eventType) throw badRequest("Choose which Daymark event starts this automation first.");
  if (flow.status !== "active") throw badRequest("This automation is paused in viaSocket.");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true } });
  const type = flow.eventType;
  const r = await enqueueEvent({
    organizationId: actor.organizationId, type, eventKey: newTestEventKey(flow.id), isTest: true, onlyFlowId: flow.id,
    payload: (eventId) => samplePayload(type, eventId, org.name),
  });
  if (!r.integrationEventId) throw badRequest("Could not create the test event.");
  const results = await deliverPendingForEvent(r.integrationEventId, deps);
  return { results };
}
