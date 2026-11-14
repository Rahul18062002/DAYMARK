import { prisma } from "./db";
import { tooMany } from "./errors";

/**
 * Fixed-window rate limit stored in the database (shared by every request of the app, and kept across
 * restarts). One atomic upsert per call. Used for Daymark's own public endpoints; Better Auth
 * rate-limits its sign-in / password-reset routes itself.
 */
export async function throttle(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number | bigint }[]>`
    INSERT INTO "RequestThrottle" ("key", "count", "windowStart")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RequestThrottle"."windowStart" < ${windowStart} THEN 1 ELSE "RequestThrottle"."count" + 1 END,
      "windowStart" = CASE WHEN "RequestThrottle"."windowStart" < ${windowStart} THEN ${now} ELSE "RequestThrottle"."windowStart" END
    RETURNING "count"`;
  if (Number(rows[0]?.count ?? 0) > limit) throw tooMany();
}

export { clientIpFrom as clientIp } from "./client-ip";
