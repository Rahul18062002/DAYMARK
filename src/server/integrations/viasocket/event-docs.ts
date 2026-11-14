// Pure data (safe for the browser): what each event sends and where every value comes from.
// A test keeps this in lock-step with the real payloads.
export type EventKey = "UPDATE_SUBMITTED" | "UPDATE_BLOCKER_REPORTED" | "UPDATE_MISSING";
export type FieldDoc = { path: string; source: string; note?: string; optional?: boolean };

const COMMON: FieldDoc[] = [
  { path: "schemaVersion", source: "Daymark", note: "Always 1 for now." },
  { path: "eventId", source: "Daymark", note: "Stable for the life of the event. Delivery is at-least-once, so use this to ignore duplicates." },
  { path: "eventType", source: "Daymark" },
  { path: "occurredAt", source: "Daymark", note: "ISO-8601, UTC." },
  { path: "test", source: "Daymark", note: "true for “Send test event”." },
  { path: "organization.name", source: "Daymark" },
];

export const EVENT_FIELDS: Record<EventKey, FieldDoc[]> = {
  UPDATE_SUBMITTED: [
    ...COMMON,
    { path: "employee.name", source: "Daymark" },
    { path: "employee.team", source: "Daymark", note: "null when the person has no team." },
    { path: "update.date", source: "Daymark", note: "The day the update is for (YYYY-MM-DD)." },
    { path: "update.isLate", source: "Daymark", note: "Submitted after the day's cut-off." },
    { path: "update.hasBlockers", source: "Daymark" },
    { path: "update.url", source: "Daymark", note: "Link to the update in Daymark. Opening it still requires sign-in and permission." },
    { path: "manager.name", source: "Daymark", note: "The employee's manager (else their team's manager). null if none." },
    { path: "manager.email", source: "Daymark" },
  ],
  UPDATE_BLOCKER_REPORTED: [
    ...COMMON,
    { path: "employee.name", source: "Daymark" },
    { path: "employee.team", source: "Daymark" },
    { path: "update.date", source: "Daymark" },
    { path: "update.url", source: "Daymark" },
    { path: "manager.name", source: "Daymark" },
    { path: "manager.email", source: "Daymark" },
    { path: "blocker.count", source: "Daymark", note: "Number of real blockers (“None” / “N/A” don't count)." },
    { path: "blocker.text", source: "Daymark", optional: true, note: "Only when an admin enabled “Include blocker text”: the first blocker, up to 280 characters." },
  ],
  UPDATE_MISSING: [
    ...COMMON,
    { path: "employee.name", source: "Daymark" },
    { path: "employee.email", source: "Daymark", note: "So a reminder can reach the person." },
    { path: "employee.team", source: "Daymark" },
    { path: "reminder.date", source: "Daymark" },
    { path: "reminder.submitUrl", source: "Daymark", note: "Opens the update form for that day." },
    { path: "reminder.cutoffTime", source: "Daymark", note: "The organization's cut-off (HH:MM)." },
    { path: "reminder.timezone", source: "Daymark" },
  ],
};
