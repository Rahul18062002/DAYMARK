import { withJobLock } from "../../job-lock";
import { purgeOldIntegrationData, sweepDeliveries } from "./dispatch";
import { runMissingUpdateCheck } from "./missing";
import { runReminderCheck } from "./reminders";

const LOCK_NAME = "integrations-cron";
const LOCK_TTL_MS = 5 * 60_000; // the scheduler gives each call 5 minutes; a dead run frees the lease after that

/**
 * One reconciliation pass: send due reminders, detect missing updates, deliver/retry everything due, apply retention.
 * The scheduler is best-effort (a run can be skipped, repeated or overlap), so:
 *  - a lease row (JobLock) makes an overlapping run a no-op,
 *  - every step is idempotent (unique event keys, claim leases), and
 *  - each pass re-derives what is outstanding instead of trusting that the previous pass ran.
 * No database transaction is held across the network calls.
 */
export async function runIntegrationCron(now = new Date()) {
  const r = await withJobLock(LOCK_NAME, LOCK_TTL_MS, async () => {
    const reminders = await runReminderCheck({ now });
    const missing = await runMissingUpdateCheck({ now });
    const sweep = await sweepDeliveries({ limit: 200 }, { now: () => now });
    const purge = await purgeOldIntegrationData(now);
    return { reminders, missing, sweep, purge };
  }, () => now);
  return r.ran ? r.value : { skipped: "another run is in progress" as const };
}
