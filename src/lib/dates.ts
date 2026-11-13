// Calendar-day helpers. A "day" is a plain `YYYY-MM-DD` string meaning a calendar day in the
// ORGANIZATION's timezone. Prisma `@db.Date` values come back as UTC-midnight Dates; convert
// with `toDayString`. Nothing here depends on the server's own timezone.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseDay = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const toDayString = (d: Date) => d.toISOString().slice(0, 10);

export function isValidDay(day: string): boolean {
  return DAY_RE.test(day) && !Number.isNaN(parseDay(day).getTime()) && toDayString(parseDay(day)) === day;
}

/** The calendar day an instant falls on in `timeZone`. */
export function localDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDayString(d);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  return ((parseDay(day).getUTCDay() + 6) % 7) + 1;
}

export const weekStart = (day: string) => addDays(day, -(isoWeekday(day) - 1));

/** Inclusive list of days from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads `day` + `HH:MM`. */
export function zonedTimeToUtc(day: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, m);
  let ts = wall - tzOffsetMs(new Date(wall), timeZone);
  ts = wall - tzOffsetMs(new Date(ts), timeZone); // second pass settles DST edges
  return new Date(ts);
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(parseDay(day));
}

/** Format an ISO instant in the organization's timezone, e.g. "13 Nov, 14:30". */
export function formatInstant(iso: string, timeZone: string, withDate = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(withDate ? { day: "numeric", month: "short" } : {}),
  }).format(new Date(iso));
}
