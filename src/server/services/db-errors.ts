import { conflict } from "../errors";

/** Translate known Prisma constraint errors into friendly 409s. */
export function mapDbError(e: unknown, messages: { unique?: string; reference?: string }): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002") throw conflict(messages.unique ?? "That already exists.");
  if (code === "P2003" || code === "P2014") throw conflict(messages.reference ?? "That is still in use.");
  throw e;
}

/** Row lock on the organization: serializes membership-changing transactions (last-admin safety). */
export async function lockOrganization(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  organizationId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
}
