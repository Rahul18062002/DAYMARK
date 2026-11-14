// Seeds automation rows directly in the test database with plain SQL, so UI tests never need (or reach) real viaSocket.
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { encryptSecret, flowKey } from "@/server/integrations/viasocket/crypto";

const id = () => `e2e${randomBytes(9).toString("hex")}`;

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export const orgIdOf = (email: string) =>
  withDb(async (c) => {
    const r = await c.query(`SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1 LIMIT 1`, [email]);
    if (!r.rows[0]) throw new Error(`no membership for ${email}`);
    return r.rows[0].organizationId as string;
  });

export async function seedFlow(organizationId: string, o: { title: string; status?: string; eventType?: string | null }) {
  const url = `https://flow.sokt.io/func/scriE2E${randomBytes(5).toString("hex")}`;
  const flowId = id();
  await withDb((c) =>
    c.query(
      `INSERT INTO "AutomationFlow" ("id","organizationId","flowKey","urlEnc","title","status","eventType","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::"IntegrationEventType",now())`,
      [flowId, organizationId, flowKey(url), encryptSecret(url), o.title, o.status ?? "active", o.eventType ?? null],
    ),
  );
  return { id: flowId };
}

/** An already-finished delivery (never PENDING, so nothing will try to send it) with its attempt history. */
export async function seedDelivery(
  organizationId: string, flowId: string,
  o: { status: "DELIVERED" | "FAILED"; attempts: Array<{ outcome: "SUCCESS" | "RETRYABLE_ERROR"; httpStatus: number; errorMessage?: string }>; type?: string },
) {
  const evId = id(), deliveryId = id(), key = `e2e:${randomBytes(6).toString("hex")}`;
  await withDb(async (c) => {
    await c.query(`INSERT INTO "IntegrationEvent" ("id","organizationId","eventId","eventKey","type","payload") VALUES ($1,$2,$3,$4,$5::"IntegrationEventType",$6)`, [evId, organizationId, `evt_${randomBytes(16).toString("hex")}`, key, o.type ?? "UPDATE_SUBMITTED", JSON.stringify({ seeded: true })]);
    await c.query(
      `INSERT INTO "IntegrationDelivery" ("id","organizationId","integrationEventId","automationFlowId","status","attemptCount","lastHttpStatus","lastError","deliveredAt","updatedAt") VALUES ($1,$2,$3,$4,$5::"DeliveryStatus",$6,$7,$8,$9,now())`,
      [deliveryId, organizationId, evId, flowId, o.status, o.attempts.length, o.attempts.at(-1)?.httpStatus ?? null, o.status === "FAILED" ? "viaSocket answered with status 503." : null, o.status === "DELIVERED" ? new Date() : null],
    );
    for (const [i, a] of o.attempts.entries()) {
      await c.query(`INSERT INTO "IntegrationAttempt" ("id","organizationId","deliveryId","attemptNumber","durationMs","outcome","httpStatus","errorMessage") VALUES ($1,$2,$3,$4,$5,$6::"AttemptOutcome",$7,$8)`, [id(), organizationId, deliveryId, i + 1, 120 + i, a.outcome, a.httpStatus, a.errorMessage ?? null]);
    }
  });
  return { delivery: { id: deliveryId } };
}
