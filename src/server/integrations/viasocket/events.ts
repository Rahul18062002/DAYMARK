import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import type { IntegrationEventType } from "@/generated/prisma/enums";
import { prisma } from "../../db";
import { appUrl } from "../../env";
import { isViaSocketConfigured } from "./config";
import { deliverPendingForEvent } from "./dispatch";

// ───────────────────────── catalogue (single source of truth for UI + docs) ─────────────────────────

export const EVENT_CATALOG: Record<IntegrationEventType, { name: string; label: string; description: string }> = {
  UPDATE_SUBMITTED: {
    name: "update.submitted",
    label: "Daily Update Submitted",
    description: "Sent once, when an employee first submits a daily update.",
  },
  UPDATE_BLOCKER_REPORTED: {
    name: "update.blocker_reported",
    label: "Employee Reports a Blocker",
    description: "Sent once per update, the first time it contains a real blocker (\"None\" or \"N/A\" doesn't count).",
  },
  UPDATE_REMINDER: {
    name: "update.reminder",
    label: "Daily Update Reminder",
    description: "Sent at most once per person per day, at the organization's reminder time on a working day, to people who haven't submitted yet (before the cut-off).",
  },
  UPDATE_MISSING: {
    name: "update.missing",
    label: "Daily Update Missing",
    description: "Sent at most once per person per day, after the organization's cut-off time on a working day, if no update was submitted.",
  },
};

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as IntegrationEventType[];

// ───────────────────────── payloads (minimal on purpose) ─────────────────────────

type Envelope = {
  schemaVersion: 1;
  /** Stable for the life of the event. Flows should dedupe on this: delivery is at-least-once. */
  eventId: string;
  eventType: string;
  occurredAt: string;
  test: boolean;
  organization: { name: string };
};
type Person = { name: string; team: string | null };
type Manager = { name: string; email: string } | null;

export type SubmittedPayload = Envelope & {
  employee: Person;
  update: { date: string; isLate: boolean; hasBlockers: boolean; url: string };
  manager: Manager;
};
export type BlockerPayload = Envelope & {
  employee: Person;
  update: { date: string; url: string };
  manager: Manager;
  blocker: { count: number; text?: string };
};
export type MissingPayload = Envelope & {
  employee: Person & { email: string };
  reminder: { date: string; submitUrl: string; cutoffTime: string; timezone: string };
};
/** Same shape as the missing-update event: who to nudge, the day, a link to the form, and the organization's cut-off. */
export type ReminderPayload = MissingPayload;
export type EventPayload = SubmittedPayload | BlockerPayload | MissingPayload | ReminderPayload;

const MAX_BLOCKER_TEXT = 280;
const NO_BLOCKER = /^(none|no|nil|n\/a|na|nothing|not any|no blockers?|no issues?|no challenges?|-+|\.+)[.!\s]*$/i;

/** Deterministic: the same logical event always gets the same ID. */
export const eventIdFor = (organizationId: string, eventKey: string) =>
  `evt_${createHash("sha256").update(`${organizationId}|${eventKey}`).digest("hex").slice(0, 32)}`;

export const eventKeys = {
  submitted: (updateId: string) => `update.submitted:${updateId}`,
  blocker: (updateId: string) => `update.blocker_reported:${updateId}`,
  missing: (membershipId: string, day: string) => `update.missing:${membershipId}:${day}`,
  reminder: (membershipId: string, day: string) => `update.reminder:${membershipId}:${day}`,
};

function envelope(type: IntegrationEventType, eventId: string, orgName: string, test: boolean, now: Date): Envelope {
  return { schemaVersion: 1, eventId, eventType: EVENT_CATALOG[type].name, occurredAt: now.toISOString(), test, organization: { name: orgName } };
}

/** Synthetic payload for "Send test event" — a clearly fake person, never real employee data. */
export function samplePayload(type: IntegrationEventType, eventId: string, orgName: string, now = new Date()): EventPayload {
  const base = envelope(type, eventId, orgName, true, now);
  const day = now.toISOString().slice(0, 10);
  const person = { name: "Test Employee", team: "Sample Team" };
  const manager = { name: "Test Manager", email: "test.manager@example.invalid" };
  if (type === "UPDATE_SUBMITTED") return { ...base, employee: person, update: { date: day, isLate: false, hasBlockers: false, url: `${appUrl()}/team-updates/sample` }, manager };
  if (type === "UPDATE_BLOCKER_REPORTED") return { ...base, employee: person, update: { date: day, url: `${appUrl()}/team-updates/sample` }, manager, blocker: { count: 1 } };
  return { ...base, employee: { ...person, email: "test.employee@example.invalid" }, reminder: { date: day, submitUrl: `${appUrl()}/my-updates/new`, cutoffTime: "18:00", timezone: "UTC" } };
}

async function loadUpdateContext(organizationId: string, updateId: string) {
  const row = await prisma.dailyUpdate.findFirst({
    where: { id: updateId, organizationId, status: { in: ["SUBMITTED", "EDITED"] } },
    select: {
      updateDate: true, submittedLate: true, hasBlockers: true,
      items: { where: { section: "BLOCKER" }, orderBy: { position: "asc" }, select: { text: true } },
      membership: {
        select: {
          user: { select: { name: true } },
          team: { select: { name: true, manager: { select: { status: true, user: { select: { name: true, email: true } } } } } },
          manager: { select: { status: true, user: { select: { name: true, email: true } } } },
        },
      },
      organization: { select: { name: true, settings: { select: { automationsIncludeBlockerText: true } } } },
    },
  });
  if (!row) return null;
  // The person's own manager, else their team's manager — only if still active.
  const m = [row.membership.manager, row.membership.team?.manager].find((x) => x?.status === "ACTIVE");
  return {
    row,
    manager: (m ? { name: m.user.name, email: m.user.email } : null) as Manager,
    includeText: row.organization.settings?.automationsIncludeBlockerText === true,
  };
}

export async function buildUpdateEventPayload(
  organizationId: string, updateId: string, type: "UPDATE_SUBMITTED" | "UPDATE_BLOCKER_REPORTED", eventId: string, now = new Date(),
): Promise<SubmittedPayload | BlockerPayload | null> {
  const ctx = await loadUpdateContext(organizationId, updateId);
  if (!ctx) return null;
  const { row, manager, includeText } = ctx;
  const date = row.updateDate;
  const employee = { name: row.membership.user.name, team: row.membership.team?.name ?? null };
  const base = envelope(type, eventId, row.organization.name, false, now);
  if (type === "UPDATE_SUBMITTED") {
    return { ...base, employee, update: { date, isLate: row.submittedLate, hasBlockers: row.hasBlockers, url: `${appUrl()}/team-updates/${updateId}` }, manager } as SubmittedPayload;
  }
  const real = row.items.map((i) => i.text).filter((t) => !NO_BLOCKER.test(t.trim()));
  const first = real[0];
  const blocker: BlockerPayload["blocker"] = { count: real.length };
  if (includeText && first) blocker.text = first.length > MAX_BLOCKER_TEXT ? `${first.slice(0, MAX_BLOCKER_TEXT - 1)}…` : first;
  return { ...base, employee, update: { date, url: `${appUrl()}/team-updates/${updateId}` }, manager, blocker } as BlockerPayload;
}

// ───────────────────────── enqueue (idempotent) ─────────────────────────

/**
 * Creates the event and one delivery per active linked flow — or does nothing.
 *  - No active flow linked to this event type ⇒ nothing is stored.
 *  - Same (organization, eventKey) twice ⇒ the second call changes nothing (unique constraint),
 *    so duplicate triggers, retries of the caller and double cron runs are all safe.
 *  - Only the call that actually creates the event creates its deliveries (never retroactive).
 */
export async function enqueueEvent(args: {
  organizationId: string; type: IntegrationEventType; eventKey: string; isTest?: boolean;
  payload: (eventId: string) => Promise<EventPayload | null> | EventPayload | null; onlyFlowId?: string; now?: Date;
}): Promise<{ created: boolean; integrationEventId: string | null; deliveries: number }> {
  const { organizationId, type, eventKey } = args;
  const flows = await prisma.automationFlow.findMany({
    where: { organizationId, eventType: type, status: "active", ...(args.onlyFlowId ? { id: args.onlyFlowId } : {}) },
    select: { id: true },
  });
  if (flows.length === 0) return { created: false, integrationEventId: null, deliveries: 0 };

  const eventId = eventIdFor(organizationId, eventKey);
  const existing = await prisma.integrationEvent.findUnique({ where: { organizationId_eventKey: { organizationId, eventKey } }, select: { id: true } });
  if (existing) return { created: false, integrationEventId: existing.id, deliveries: 0 };

  const payload = await args.payload(eventId);
  if (!payload) return { created: false, integrationEventId: null, deliveries: 0 };

  try {
    return await prisma.$transaction(async (tx) => {
      const ev = await tx.integrationEvent.create({
        data: { organizationId, eventId, eventKey, type, isTest: args.isTest ?? false, payload: payload as never },
        select: { id: true },
      });
      const made = await tx.integrationDelivery.createMany({
        data: flows.map((f) => ({ organizationId, integrationEventId: ev.id, automationFlowId: f.id, nextAttemptAt: args.now ?? new Date() })),
      });
      return { created: true, integrationEventId: ev.id, deliveries: made.count };
    });
  } catch (e) {
    // Lost a race with a concurrent identical emission: the other one owns it.
    if ((e as { code?: string })?.code === "P2002") return { created: false, integrationEventId: null, deliveries: 0 };
    throw e;
  }
}

// ───────────────────────── post-commit hook used by the updates service ─────────────────────────

/** Run work after the response where possible (Next `after`), else fire-and-forget. Never throws. */
export function runInBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[daymark] automation background task failed:", e instanceof Error ? e.name : "error"));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/**
 * Called by the updates service AFTER its transaction committed. Best-effort by design: it can
 * never fail or slow the core action (errors are swallowed, delivery happens in the background),
 * and it does nothing unless viaSocket is configured and a flow is linked.
 */
export function notifyUpdateChanged(args: { organizationId: string; updateId: string; submittedNow: boolean; blockerNow: boolean }) {
  try {
    if (!(args.submittedNow || args.blockerNow) || !isViaSocketConfigured()) return;
    runInBackground(async () => {
      const kinds: Array<["UPDATE_SUBMITTED" | "UPDATE_BLOCKER_REPORTED", string]> = [];
      if (args.submittedNow) kinds.push(["UPDATE_SUBMITTED", eventKeys.submitted(args.updateId)]);
      if (args.blockerNow) kinds.push(["UPDATE_BLOCKER_REPORTED", eventKeys.blocker(args.updateId)]);
      for (const [type, eventKey] of kinds) {
        const r = await enqueueEvent({
          organizationId: args.organizationId, type, eventKey,
          payload: (eventId) => buildUpdateEventPayload(args.organizationId, args.updateId, type, eventId),
        });
        if (r.created && r.integrationEventId) await deliverPendingForEvent(r.integrationEventId);
      }
    });
  } catch {
    /* never affect the caller */
  }
}

export const newTestEventKey = (flowId: string) => `test:${flowId}:${randomUUID()}`;
