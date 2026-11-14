import { env } from "../../env";

/**
 * viaSocket is OPTIONAL. Everything in this folder is a no-op unless all three values are set,
 * and Daymark's core features never depend on it.
 */
export type ViaSocketConfig = { orgId: string; projectId: string; secret: string };

export function viaSocketConfig(): ViaSocketConfig | null {
  const e = env();
  const orgId = e.VIASOCKET_ORG_ID?.trim();
  const projectId = e.VIASOCKET_PROJECT_ID?.trim();
  const secret = e.VIASOCKET_EMBED_SECRET?.trim();
  return orgId && projectId && secret ? { orgId, projectId, secret } : null;
}

export const isViaSocketConfigured = () => viaSocketConfig() !== null;

/** The only host Daymark will ever POST an event to (flow run URLs are `https://flow.sokt.io/func/<id>`). */
export const FLOW_RUN_HOST = "flow.sokt.io";

/** Every Daymark organization is ONE viaSocket identity, derived on the server from the session. */
export const orgIdentity = (organizationId: string) => `daymark-org-${organizationId}`;
