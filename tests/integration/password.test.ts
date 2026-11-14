import { describe, expect, it } from "vitest";
import { hashPassword as betterAuthHash, verifyPassword as betterAuthVerify } from "better-auth/crypto";
import { hashPassword, passwordHashStats, verifyPassword } from "@/server/auth/password";

describe("password hashing (memory-bounded scrypt)", () => {
  it("is format-compatible with Better Auth in both directions", async () => {
    const mine = await hashPassword("correct horse battery");
    expect(mine).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await betterAuthVerify({ hash: mine, password: "correct horse battery" })).toBe(true);
    const theirs = await betterAuthHash("another passphrase ü");
    expect(await verifyPassword({ hash: theirs, password: "another passphrase ü" })).toBe(true);
  });

  it("rejects wrong passwords and malformed hashes", async () => {
    const h = await hashPassword("right-password-1");
    expect(await verifyPassword({ hash: h, password: "wrong-password-1" })).toBe(false);
    expect(await verifyPassword({ hash: "garbage", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "aa:", password: "x" })).toBe(false);
  });

  it("never runs more than one hash at a time, however many arrive together", async () => {
    const before = passwordHashStats().peakRunning;
    const hashes = await Promise.all(Array.from({ length: 10 }, (_, i) => hashPassword(`pw-${i}-xxxxxxxx`)));
    expect(new Set(hashes).size).toBe(10);
    expect(passwordHashStats().peakRunning).toBeLessThanOrEqual(Math.max(before, 1));
    expect(passwordHashStats()).toMatchObject({ running: 0, waiting: 0 });
  }, 60_000);
});
