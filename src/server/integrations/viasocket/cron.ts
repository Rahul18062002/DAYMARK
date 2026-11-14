import { prisma } from "../../db";
import { purgeOldIntegrationData, sweepDeliveries } from "./dispatch";
import { runMissingUpdateCheck } from "./missing";

const LOCK_KEY = 727401; // arbitrary app-wide advisory-lock id for this job

/**
 * One reconciliation pass: detect missing updates, deliver/retry everything due, apply retention.
 * Vercel Cron is best-effort (a run can be skipped or delivered twice, and runs can overlap), so:
 *  - an advisory lock makes overlapping runs a no-op,
 *  - every step is idempotent (unique event keys, claim leases), and
 *  - each pass re-derives what is outstanding instead of trusting that the previous pass ran.
 */
export async function runIntegrationCron(now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
      if (!locked) return { skipped: "another run is in progress" as const };
      const missing = await runMissingUpdateCheck({ now });
      const sweep = await sweepDeliveries({ limit: 200 }, { now: () => now });
      const purge = await purgeOldIntegrationData(now);
      return { missing, sweep, purge };
    },
    { timeout: 55_000, maxWait: 5_000 },
  );
}
