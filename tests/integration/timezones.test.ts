import { describe, expect, it } from "vitest";
import { timezoneOptions } from "../../src/lib/timezones";
import { timezoneSchema } from "../../src/server/validation";

describe("timezone picker options", () => {
  it("offers India under the modern and the legacy name, so a stored Asia/Kolkata can be shown", () => {
    const z = timezoneOptions();
    expect(z).toContain("Asia/Kolkata");
    expect(z).toContain("Asia/Calcutta");
    expect(z[0]).toBe("UTC");
  });
  it("always includes the value currently in use (and ignores invalid ones)", () => {
    expect(timezoneOptions("Pacific/Chatham")).toContain("Pacific/Chatham");
    expect(timezoneOptions("Not/AZone")).not.toContain("Not/AZone");
  });
  it("has no duplicates and every option is accepted by the server", () => {
    const z = timezoneOptions("Asia/Kolkata");
    expect(new Set(z).size).toBe(z.length);
    for (const name of z) expect(timezoneSchema.safeParse(name).success, name).toBe(true);
  });
});
