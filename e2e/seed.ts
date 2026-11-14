// Seeds automation rows directly in the test database with plain SQL, so UI tests never need (or reach) real viaSocket.
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { databaseFile } from "@/server/db-path";
import { encryptSecret, flowKey } from "@/server/integrations/viasocket/crypto";

const id = () => `e2e${randomBytes(9).toString("hex")}`;
const iso = (d = new Date()) => d.toISOString();

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(databaseFile());
  db.pragma("busy_timeout = 10000");
  try { return fn(db); } finally { db.close(); }
}

export const orgIdOf = async (email: string) =>
  withDb((db) => {
    const r = db.prepare(`SELECT m."organizationId" AS id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = ? LIMIT 1`).get(email) as { id: string } | undefined;
    if (!r) throw new Error(`no membership for ${email}`);
    return r.id;
  });

export async function seedFlow(organizationId: string, o: { title: string; status?: string; eventType?: string | null }) {
  const url = `https://flow.sokt.io/func/scriE2E${randomBytes(5).toString("hex")}`;
  const flowId = id();
  withDb((db) =>
    db.prepare(`INSERT INTO "AutomationFlow" ("id","organizationId","flowKey","urlEnc","title","status","eventType","updatedAt") VALUES (?,?,?,?,?,?,?,?)`)
      .run(flowId, organizationId, flowKey(url), encryptSecret(url), o.title, o.status ?? "active", o.eventType ?? null, iso()),
  );
  return { id: flowId };
}

/** An already-finished delivery (never PENDING, so nothing will try to send it) with its attempt history. */
export async function seedDelivery(
  organizationId: string, flowId: string,
  o: { status: "DELIVERED" | "FAILED"; attempts: Array<{ outcome: "SUCCESS" | "RETRYABLE_ERROR"; httpStatus: number; errorMessage?: string }>; type?: string },
) {
  const evId = id(), deliveryId = id(), key = `e2e:${randomBytes(6).toString("hex")}`;
  withDb((db) => {
    db.prepare(`INSERT INTO "IntegrationEvent" ("id","organizationId","eventId","eventKey","type","payload") VALUES (?,?,?,?,?,?)`)
      .run(evId, organizationId, `evt_${randomBytes(16).toString("hex")}`, key, o.type ?? "UPDATE_SUBMITTED", JSON.stringify({ seeded: true }));
    db.prepare(`INSERT INTO "IntegrationDelivery" ("id","organizationId","integrationEventId","automationFlowId","status","attemptCount","lastHttpStatus","lastError","deliveredAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(deliveryId, organizationId, evId, flowId, o.status, o.attempts.length, o.attempts.at(-1)?.httpStatus ?? null, o.status === "FAILED" ? "viaSocket answered with status 503." : null, o.status === "DELIVERED" ? iso() : null, iso());
    for (const [i, a] of o.attempts.entries()) {
      db.prepare(`INSERT INTO "IntegrationAttempt" ("id","organizationId","deliveryId","attemptNumber","durationMs","outcome","httpStatus","errorMessage") VALUES (?,?,?,?,?,?,?,?)`)
        .run(id(), organizationId, deliveryId, i + 1, 120 + i, a.outcome, a.httpStatus, a.errorMessage ?? null);
    }
  });
  return { delivery: { id: deliveryId } };
}
