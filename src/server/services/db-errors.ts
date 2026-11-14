import { conflict } from "../errors";

/** Translate known Prisma constraint errors into friendly 409s. */
export function mapDbError(e: unknown, messages: { unique?: string; reference?: string }): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002") throw conflict(messages.unique ?? "That already exists.");
  if (code === "P2003" || code === "P2014") throw conflict(messages.reference ?? "That is still in use.");
  throw e;
}

/**
 * Serialize membership-changing transactions per organization (last-admin safety).
 * SQLite has no row locks; it has one writer. Starting the transaction with a WRITE to the organization
 * row takes the database write lock before anything is read, so two concurrent "remove the last admin"
 * transactions run one after the other and the second sees the first one's result.
 * (Within the single Embarko process, Prisma's SQLite adapter also runs transactions one at a time.)
 */
export async function lockOrganization(
  tx: { organization: { update: (a: { where: { id: string }; data: { updatedAt: Date } }) => Promise<unknown> } },
  organizationId: string,
) {
  await tx.organization.update({ where: { id: organizationId }, data: { updatedAt: new Date() } });
}
