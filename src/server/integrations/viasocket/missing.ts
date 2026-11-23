import { prisma } from "../../db";
import { appUrl } from "../../env";
import { isoWeekday, localDay, zonedTimeToUtc } from "@/lib/dates";
import { parseWorkingDays } from "@/lib/working-days";
import { isViaSocketConfigured } from "./config";
import { EVENT_CATALOG, enqueueEvent, eventKeys, type MissingPayload } from "./events";

/**
 * Detect people who haven't submitted by their organization's cut-off, and enqueue one
 * `update.missing` event per person per day. Designed for an unreliable scheduler (a platform scheduler is
 * best-effort, can skip a run or fire twice): it is a pure reconciliation of "who is still missing
 * today", and the unique event key makes any number of repeat runs harmless.
 * Only organizations with an active automation linked to this event are examined.
 */
export async function runMissingUpdateCheck(opts: { now?: Date } = {}): Promise<{ organizations: number; created: number }> {
  if (!isViaSocketConfigured()) return { organizations: 0, created: 0 };
  const now = opts.now ?? new Date();
  const listening = await prisma.automationFlow.findMany({
    where: { eventType: "UPDATE_MISSING", status: "active" }, distinct: ["organizationId"], select: { organizationId: true },
  });
  let created = 0;
  for (const { organizationId } of listening) {
    try {
      created += await checkOrganization(organizationId, now);
    } catch (e) {
      // One organization's problem never blocks the others.
      console.error("[daymark] missing-update check failed for an organization:", e instanceof Error ? e.name : "error");
    }
  }
  return { organizations: listening.length, created };
}

async function checkOrganization(organizationId: string, now: Date): Promise<number> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
  const tz = org.timezone;
  const cutoff = org.settings?.updateCutoffTime ?? "18:00";
  const workingDays = parseWorkingDays(org.settings?.workingDays);
  const today = localDay(now, tz);
  if (!workingDays.includes(isoWeekday(today))) return 0;
  const cutoffAt = zonedTimeToUtc(today, cutoff, tz);
  if (now < cutoffAt) return 0;

  const [members, submitted] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, createdAt: true, user: { select: { name: true, email: true } }, team: { select: { name: true } } },
    }),
    prisma.dailyUpdate.findMany({
      where: { organizationId, updateDate: today, status: { in: ["SUBMITTED", "EDITED"] } },
      select: { membershipId: true },
    }),
  ]);
  const done = new Set(submitted.map((u) => u.membershipId));
  let created = 0;
  for (const m of members) {
    if (done.has(m.id)) continue;
    if (m.createdAt >= cutoffAt) continue; // joined after today's cut-off: nothing was due from them yet
    const r = await enqueueEvent({
      organizationId, type: "UPDATE_MISSING", eventKey: eventKeys.missing(m.id, today), now,
      payload: (eventId): MissingPayload => ({
        schemaVersion: 1, eventId, eventType: EVENT_CATALOG.UPDATE_MISSING.name, occurredAt: now.toISOString(), test: false,
        organization: { name: org.name },
        employee: { name: m.user.name, email: m.user.email, team: m.team?.name ?? null },
        reminder: { date: today, submitUrl: `${appUrl()}/my-updates/new?date=${today}`, cutoffTime: cutoff, timezone: tz },
      }),
    });
    if (r.created) created++;
  }
  return created;
}
