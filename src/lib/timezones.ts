export function timezoneOptions(): string[] {
  const list: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return list.includes("UTC") ? list : ["UTC", ...list];
}
