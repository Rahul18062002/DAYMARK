import { prisma } from "./db";
import { tooMany } from "./errors";

/**
 * Fixed-window rate limit stored in PostgreSQL so it holds across serverless
 * instances. Used for Daymark's own public endpoints; Better Auth rate-limits
 * its sign-in / password-reset routes itself.
 */
export async function throttle(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RequestThrottle" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RequestThrottle"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "RequestThrottle"."count" + 1 END,
      "windowStart" = CASE WHEN "RequestThrottle"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                           THEN now() ELSE "RequestThrottle"."windowStart" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) throw tooMany();
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
