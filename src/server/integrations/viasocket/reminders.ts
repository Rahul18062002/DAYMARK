import { prisma } from "../../db";
import { appUrl } from "../../env";
import { isoWeekday, localDay, zonedTimeToUtc } from "@/lib/dates";
import { parseWorkingDays } from "@/lib/working-days";
import { isViaSocketConfigured } from "./config";
import { EVENT_CATALOG, enqueueEvent, eventKeys, type ReminderPayload } from "./events";

/**
 * Daily reminders: one `update.reminder` event per person who hasn't submitted yet, once the organization's reminder
 * time has passed on a working day and before its cut-off (after the cut-off the "missing" event takes over).
 *
 * Like the missing-update check it is a reconciliation, not a timer: "who still owes an update right now?". A late,
 * skipped or duplicated scheduler run changes nothing about the outcome, and the unique event key means a person is
 * never reminded twice for the same day. Time zones and daylight saving are handled per organization.
 * Only organizations that switched reminders on AND linked an automation to the event are examined.
 */
export async function runReminderCheck(opts: { now?: Date } = {}): Promise<{ organizations: number; created: number }> {
  if (!isViaSocketConfigured()) return { organizations: 0, created: 0 };
  const now = opts.now ?? new Date();
  const listening = await prisma.automationFlow.findMany({
    where: { eventType: "UPDATE_REMINDER", status: "active", organization: { is: { settings: { is: { reminderEnabled: true } } } } },
    distinct: ["organizationId"], select: { organizationId: true },
  });
  let created = 0;
  for (const { organizationId } of listening) {
    try { created += await remindOrganization(organizationId, now); }
    catch (e) { console.error("[daymark] reminder check failed for an organization:", e instanceof Error ? e.name : "error"); } // one organization never blocks the others
  }
  return { organizations: listening.length, created };
}

async function remindOrganization(organizationId: string, now: Date): Promise<number> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
  const s = org.settings;
  if (!s?.reminderEnabled) return 0;
  const tz = org.timezone, cutoff = s.updateCutoffTime, remindAt = s.reminderTime;
  if (remindAt >= cutoff) return 0;                                            // misconfigured: a reminder after the cut-off would be the "missing" event
  const today = localDay(now, tz);
  if (!parseWorkingDays(s.workingDays).includes(isoWeekday(today))) return 0;
  const from = zonedTimeToUtc(today, remindAt, tz), until = zonedTimeToUtc(today, cutoff, tz);
  if (now < from || now >= until) return 0;

  const [members, submitted] = await Promise.all([
    prisma.membership.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, createdAt: true, user: { select: { name: true, email: true } }, team: { select: { name: true } } } }),
    prisma.dailyUpdate.findMany({ where: { organizationId, updateDate: today, status: { in: ["SUBMITTED", "EDITED"] } }, select: { membershipId: true } }),
  ]);
  const done = new Set(submitted.map((u) => u.membershipId));
  let created = 0;
  for (const m of members) {
    if (done.has(m.id)) continue;
    if (m.createdAt >= from) continue;                                         // joined after today's reminder time: nothing was due yet
    const r = await enqueueEvent({
      organizationId, type: "UPDATE_REMINDER", eventKey: eventKeys.reminder(m.id, today), now,
      payload: (eventId): ReminderPayload => ({
        schemaVersion: 1, eventId, eventType: EVENT_CATALOG.UPDATE_REMINDER.name, occurredAt: now.toISOString(), test: false,
        organization: { name: org.name },
        employee: { name: m.user.name, email: m.user.email, team: m.team?.name ?? null },
        reminder: { date: today, submitUrl: `${appUrl()}/my-updates/new?date=${today}`, cutoffTime: cutoff, timezone: tz },
      }),
    });
    if (r.created) created++;
  }
  return created;
}
