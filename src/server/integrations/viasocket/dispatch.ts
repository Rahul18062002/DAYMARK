import { Prisma } from "@/generated/prisma/client";
import type { AttemptOutcome } from "@/generated/prisma/enums";
import { prisma } from "../../db";
import { audit } from "../../audit";
import { FLOW_RUN_HOST, isViaSocketConfigured } from "./config";
import { decryptSecret } from "./crypto";

export const REQUEST_TIMEOUT_MS = 8_000;
/** Delay before attempt 2, 3, 4, 5. Retries are picked up by the cron sweep, so real granularity is the cron interval. */
export const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const LEASE_MS = 2 * 60_000;

export type Deps = { fetch?: typeof fetch; allowedHosts?: string[]; now?: () => Date };

// Test hook: lets hook-driven tests (which can't pass deps) avoid real network calls.
let testDeps: Deps | undefined;
export function setDispatchDepsForTests(d: Deps | undefined) {
  testDeps = d;
}
export type DeliveryResult = {
  deliveryId: string;
  status: "DELIVERED" | "RETRY_SCHEDULED" | "FAILED" | "SKIPPED" | "NOT_CLAIMED" | "DEFERRED";
  httpStatus?: number;
  errorCode?: string;
};

type Classified = { outcome: AttemptOutcome; httpStatus?: number; errorCode?: string; flowState?: "paused" | "deleted" };

async function classify(res: Response): Promise<Classified> {
  const s = res.status;
  if (s >= 200 && s < 300) return { outcome: "SUCCESS", httpStatus: s };
  if (s === 400) {
    // viaSocket answers 400 "Flow is currently paused" / "Flow has been deleted": nothing to retry.
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    if (/paused/i.test(text)) return { outcome: "PERMANENT_ERROR", httpStatus: s, errorCode: "FLOW_PAUSED", flowState: "paused" };
    if (/deleted/i.test(text)) return { outcome: "PERMANENT_ERROR", httpStatus: s, errorCode: "FLOW_DELETED", flowState: "deleted" };
    return { outcome: "PERMANENT_ERROR", httpStatus: s, errorCode: "HTTP_400" };
  }
  if (s === 408 || s === 425 || s === 429 || s >= 500) return { outcome: "RETRYABLE_ERROR", httpStatus: s, errorCode: `HTTP_${s}` };
  if (s >= 300 && s < 400) return { outcome: "PERMANENT_ERROR", httpStatus: s, errorCode: "REDIRECT_NOT_FOLLOWED" };
  return { outcome: "PERMANENT_ERROR", httpStatus: s, errorCode: `HTTP_${s}` };
}

const ERROR_TEXT: Record<string, string> = {
  TIMEOUT: "viaSocket did not answer in time.",
  NETWORK: "Could not reach viaSocket.",
  FLOW_PAUSED: "The automation is paused in viaSocket.",
  FLOW_DELETED: "The automation was deleted in viaSocket.",
  FLOW_INACTIVE: "The automation is not active.",
  BLOCKED_HOST: "Refused: not a viaSocket run URL.",
  UNREADABLE_URL: "The stored automation URL could not be read. Re-sync Automations.",
  PAYLOAD_PURGED: "The event data was already deleted (retention).",
  REDIRECT_NOT_FOLLOWED: "viaSocket answered with a redirect.",
};
// Messages never contain the URL, the payload or a response body.
const messageFor = (code: string) => ERROR_TEXT[code] ?? (code.startsWith("HTTP_") ? `viaSocket answered with status ${code.slice(5)}.` : "Delivery failed.");

/**
 * Process ONE delivery. Safe to call any number of times, from any number of workers:
 * the claim below succeeds for exactly one caller, and a finished delivery can't be claimed again.
 */
export async function processDelivery(deliveryId: string, deps: Deps = {}): Promise<DeliveryResult> {
  deps = { ...testDeps, ...deps };
  const now = deps.now?.() ?? new Date();
  const lease = new Date(now.getTime() + LEASE_MS);

  // Atomic claim (status + due + not leased) — duplicate-safe across instances.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "IntegrationDelivery" SET "lockedUntil" = ${lease}
    WHERE "id" = ${deliveryId} AND "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
      AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
    RETURNING "id"`;
  if (claimed.length === 0) return { deliveryId, status: "NOT_CLAIMED" };
  return runClaimed(deliveryId, now, deps);
}

async function finish(deliveryId: string, organizationId: string, attemptNumber: number, startedAt: Date, durationMs: number, c: Classified, finalStatus: "DELIVERED" | "FAILED" | "SKIPPED" | "RETRY", nextAt?: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.integrationAttempt.create({
      data: {
        organizationId, deliveryId, attemptNumber, startedAt, durationMs, outcome: c.outcome,
        httpStatus: c.httpStatus, errorCode: c.errorCode, errorMessage: c.errorCode ? messageFor(c.errorCode) : null,
      },
    });
    await tx.integrationDelivery.update({
      where: { id: deliveryId },
      data: {
        attemptCount: attemptNumber, lockedUntil: null, lastHttpStatus: c.httpStatus ?? null,
        lastError: c.errorCode ? messageFor(c.errorCode) : null,
        ...(finalStatus === "RETRY" ? { nextAttemptAt: nextAt } : { status: finalStatus, deliveredAt: finalStatus === "DELIVERED" ? new Date() : null }),
      },
    });
    if (finalStatus === "FAILED") {
      await audit(tx, { organizationId, action: "automation.delivery_failed", entityType: "IntegrationDelivery", entityId: deliveryId, metadata: { attempts: attemptNumber, code: c.errorCode ?? null } });
    }
  });
}

async function runClaimed(deliveryId: string, now: Date, deps: Deps): Promise<DeliveryResult> {
  const d = await prisma.integrationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: { select: { payload: true, eventId: true, isTest: true } }, flow: { select: { id: true, urlEnc: true, status: true } } },
  });
  if (!d) return { deliveryId, status: "NOT_CLAIMED" };

  // Not configured right now (e.g. env removed): leave it PENDING, release the lease.
  if (!isViaSocketConfigured()) {
    await prisma.integrationDelivery.update({ where: { id: deliveryId }, data: { lockedUntil: null } });
    return { deliveryId, status: "DEFERRED" };
  }

  const attemptNumber = d.attemptCount + 1;
  const started = new Date();
  const skip = async (code: string, flowState?: "paused" | "deleted") => {
    if (flowState) await prisma.automationFlow.update({ where: { id: d.flow.id }, data: { status: flowState } });
    await finish(deliveryId, d.organizationId, attemptNumber, started, 0, { outcome: "PERMANENT_ERROR", errorCode: code }, "SKIPPED");
    return { deliveryId, status: "SKIPPED", errorCode: code } as DeliveryResult;
  };
  if (d.event.payload == null) return skip("PAYLOAD_PURGED");
  if (d.flow.status !== "active") return skip("FLOW_INACTIVE");

  let url: URL;
  try {
    url = new URL(decryptSecret(d.flow.urlEnc));
  } catch {
    await finish(deliveryId, d.organizationId, attemptNumber, started, 0, { outcome: "PERMANENT_ERROR", errorCode: "UNREADABLE_URL" }, "FAILED");
    return { deliveryId, status: "FAILED", errorCode: "UNREADABLE_URL" };
  }
  const allowed = deps.allowedHosts ?? [FLOW_RUN_HOST];
  if (url.protocol !== "https:" && !deps.allowedHosts) return fail("BLOCKED_HOST");
  if (!allowed.includes(url.host)) return fail("BLOCKED_HOST");

  async function fail(code: string): Promise<DeliveryResult> {
    await finish(deliveryId, d!.organizationId, attemptNumber, started, 0, { outcome: "PERMANENT_ERROR", errorCode: code }, "FAILED");
    return { deliveryId, status: "FAILED", errorCode: code };
  }

  const body = JSON.stringify({ ...(d.event.payload as object), attempt: attemptNumber });
  const t0 = Date.now();
  let c: Classified;
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Daymark-Event-Id": d.event.eventId },
      body,
      redirect: "manual", // a redirect is never followed
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    c = await classify(res);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    c = { outcome: "RETRYABLE_ERROR", errorCode: timedOut ? "TIMEOUT" : "NETWORK" };
  }
  const durationMs = Date.now() - t0;

  if (c.outcome === "SUCCESS") {
    await finish(deliveryId, d.organizationId, attemptNumber, started, durationMs, c, "DELIVERED");
    return { deliveryId, status: "DELIVERED", httpStatus: c.httpStatus };
  }
  if (c.flowState) {
    await prisma.automationFlow.update({ where: { id: d.flow.id }, data: { status: c.flowState } });
    await finish(deliveryId, d.organizationId, attemptNumber, started, durationMs, c, "SKIPPED");
    return { deliveryId, status: "SKIPPED", httpStatus: c.httpStatus, errorCode: c.errorCode };
  }
  if (c.outcome === "RETRYABLE_ERROR" && attemptNumber < MAX_ATTEMPTS) {
    const next = new Date(now.getTime() + RETRY_DELAYS_MS[attemptNumber - 1]);
    await finish(deliveryId, d.organizationId, attemptNumber, started, durationMs, c, "RETRY", next);
    return { deliveryId, status: "RETRY_SCHEDULED", httpStatus: c.httpStatus, errorCode: c.errorCode };
  }
  await finish(deliveryId, d.organizationId, attemptNumber, started, durationMs, c, "FAILED");
  return { deliveryId, status: "FAILED", httpStatus: c.httpStatus, errorCode: c.errorCode };
}

/** Deliver everything pending for one event right now (first attempts, right after it was created). */
export async function deliverPendingForEvent(integrationEventId: string, deps: Deps = {}): Promise<DeliveryResult[]> {
  const rows = await prisma.integrationDelivery.findMany({ where: { integrationEventId, status: "PENDING" }, select: { id: true } });
  const out: DeliveryResult[] = [];
  for (const r of rows) out.push(await processDelivery(r.id, deps));
  return out;
}

/**
 * Cron sweep: lease due deliveries with one atomic UPDATE … RETURNING (SQLite has a single writer, so
 * two overlapping sweeps never get the same row), then process each. Concurrency is small and bounded.
 */
export async function sweepDeliveries(opts: { limit?: number; budgetMs?: number } = {}, deps: Deps = {}): Promise<{ processed: number; released: number; results: Record<string, number> }> {
  deps = { ...testDeps, ...deps };
  const now = deps.now?.() ?? new Date();
  const lease = new Date(now.getTime() + LEASE_MS);
  const limit = opts.limit ?? 50;
  // A cron invocation has a hard duration limit (60 s). Stop taking new work after the budget and
  // hand back what was leased but not started, so the next pass picks it up immediately.
  const budgetMs = opts.budgetMs ?? 45_000;
  const startedAt = Date.now();
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "IntegrationDelivery" SET "lockedUntil" = ${lease}
    WHERE "id" IN (
      SELECT "id" FROM "IntegrationDelivery"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now} AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
      ORDER BY "nextAttemptAt" LIMIT ${limit})
    RETURNING "id"`;

  const results: Record<string, number> = {};
  const queue = ids.map((r) => r.id);
  let processed = 0;
  const worker = async () => {
    while (Date.now() - startedAt < budgetMs) {
      const id = queue.shift();
      if (!id) return;
      // Already leased by this sweep, so go straight to the claimed path.
      const r = await runClaimed(id, now, deps).catch(() => ({ deliveryId: id, status: "FAILED" as const }));
      processed++;
      results[r.status] = (results[r.status] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(queue.length, 1)) }, worker));
  const unstarted = queue.splice(0);
  if (unstarted.length) await prisma.integrationDelivery.updateMany({ where: { id: { in: unstarted }, status: "PENDING" }, data: { lockedUntil: null } });
  return { processed, released: unstarted.length, results };
}

/** Retention: clear payloads after 30 days; drop events (and their history) after 180. */
export async function purgeOldIntegrationData(now = new Date()) {
  const day = 86_400_000;
  const cleared = await prisma.integrationEvent.updateMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * day) }, payload: { not: Prisma.DbNull } }, data: { payload: Prisma.DbNull } });
  const deleted = await prisma.integrationEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 180 * day) } } });
  return { payloadsCleared: cleared.count, eventsDeleted: deleted.count };
}
