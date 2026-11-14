import { ViaSocket } from "viasocket-apps";
import { viaSocketConfig } from "./config";

/** The few viaSocket calls Daymark makes, behind one small interface (real SDK in production, a fake in tests). */
export type FlowSummary = { id: string; title: string; status: string; webhook: string; description: string };

export interface ViaSocketGateway {
  /** Short-lived embed token for one identity — the only viaSocket value a browser may hold. */
  embedToken(identity: string): Promise<string>;
  /** `service_id`s for app slugs (what the embed's `open` option takes). */
  serviceIds(identity: string, slugs: string[]): Promise<Record<string, string>>;
  /** The identity's flows, read server-side (never trusting a URL from the browser). */
  listFlows(identity: string): Promise<FlowSummary[]>;
}

const g = globalThis as unknown as { __daymarkVsClient?: ViaSocket; __daymarkVsGateway?: ViaSocketGateway };

function sdk(): ViaSocket {
  const cfg = viaSocketConfig();
  if (!cfg) throw new Error("viaSocket is not configured");
  return (g.__daymarkVsClient ??= new ViaSocket({ orgId: cfg.orgId, projectId: cfg.projectId, secret: cfg.secret }));
}

const real: ViaSocketGateway = {
  embedToken: (identity) => sdk().user(identity).token(),
  async serviceIds(identity, slugs) {
    const user = sdk().user(identity);
    return Object.fromEntries(await Promise.all(slugs.map(async (slug) => [slug, await user.serviceIdFor(slug)] as const)));
  },
  async listFlows(identity) {
    const flows = await sdk().user(identity).listFlows();
    return flows.map((f) => ({ id: f.id, title: f.title, status: f.status, webhook: f.webhook, description: f.description }));
  },
};

export const gateway = (): ViaSocketGateway => g.__daymarkVsGateway ?? real;

/** Test hook: swap the gateway (pass undefined to restore the real one). */
export function setGatewayForTests(fake: ViaSocketGateway | undefined) {
  g.__daymarkVsGateway = fake;
}
