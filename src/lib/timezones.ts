/**
 * Timezones offered in the pickers.
 *
 * `Intl.supportedValuesOf("timeZone")` lists some zones only under their legacy names (India appears as
 * "Asia/Calcutta", not "Asia/Kolkata"), while browsers such as Firefox and Safari report the modern name and
 * the server accepts both. Without the extra names, an organization stored as "Asia/Kolkata" had a picker that
 * could not show its own value. So we add the modern spellings and always include the value currently in use.
 */
const MODERN_NAMES = ["Asia/Kolkata", "Asia/Kathmandu", "Asia/Ho_Chi_Minh", "Asia/Yangon", "Europe/Kyiv", "America/Nuuk"];

function isValid(tz: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

export function timezoneOptions(current?: string): string[] {
  const base: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const set = new Set<string>(["UTC", ...base]);
  for (const z of [...MODERN_NAMES, current ?? ""]) if (z && isValid(z)) set.add(z);
  return ["UTC", ...[...set].filter((z) => z !== "UTC").sort((a, b) => a.localeCompare(b))];
}
