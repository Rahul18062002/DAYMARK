/** ISO weekdays 1 (Mon) … 7 (Sun). Stored as "1,2,3,4,5" because SQLite has no list columns. */
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export function parseWorkingDays(stored: string | null | undefined): number[] {
  if (!stored) return [...DEFAULT_WORKING_DAYS];
  const days = [...new Set(stored.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort();
  return days.length ? days : [...DEFAULT_WORKING_DAYS];
}

export const formatWorkingDays = (days: number[]): string => [...new Set(days)].sort().join(",");
