import { randomBytes } from "node:crypto";
import { prisma } from "./db";

/**
 * Run `fn` only if no other run holds the named lease. Replaces PostgreSQL advisory locks:
 * a lease row with an expiry, taken by one atomic statement, so overlapping scheduler calls
 * (or a retried call) are a no-op, and a run that crashes cannot block the job past `ttlMs`.
 * No database transaction is held while `fn` runs (it may do network calls).
 */
export async function withJobLock<T>(name: string, ttlMs: number, fn: () => Promise<T>, now: () => Date = () => new Date()): Promise<{ ran: true; value: T } | { ran: false }> {
  const owner = randomBytes(8).toString("hex");
  const t = now();
  const until = new Date(t.getTime() + ttlMs);
  const acquired = await prisma.$queryRaw<{ name: string }[]>`
    INSERT INTO "JobLock" ("name", "owner", "lockedUntil", "updatedAt") VALUES (${name}, ${owner}, ${until}, ${t})
    ON CONFLICT ("name") DO UPDATE SET "owner" = excluded."owner", "lockedUntil" = excluded."lockedUntil", "updatedAt" = excluded."updatedAt"
    WHERE "JobLock"."lockedUntil" < ${t}
    RETURNING "name"`;
  if (acquired.length === 0) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    // Release only if we still own it (our lease may have expired and been taken over).
    await prisma.$executeRaw`UPDATE "JobLock" SET "lockedUntil" = ${new Date(0)} WHERE "name" = ${name} AND "owner" = ${owner}`.catch(() => undefined);
  }
}
