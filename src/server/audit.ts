import type { Db } from "./db";

export type AuditInput = {
  organizationId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Pass a transaction client so the audit row commits atomically with the change. */
export async function audit(db: Db, input: AuditInput) {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? undefined) as never,
    },
  });
}
