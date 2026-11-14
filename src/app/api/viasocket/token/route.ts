import { route } from "@/server/http";
import { AppError, badRequest } from "@/server/errors";
import { throttle } from "@/server/throttle";
import { assertAutomationsAccess } from "@/server/integrations/viasocket/access";
import { isViaSocketConfigured, orgIdentity } from "@/server/integrations/viasocket/config";
import { gateway } from "@/server/integrations/viasocket/gateway";

// The ONLY place a browser can obtain a viaSocket token. The identity is derived from the
// session's organization — nothing about it is read from the request.
export const GET = route({}, async ({ req, ctx }) => {
  await assertAutomationsAccess(ctx);
  if (!isViaSocketConfigured()) throw new AppError(503, "NOT_CONFIGURED", "Automations aren't configured on this server.");
  await throttle(`vs-token:${ctx.userId}`, 30, 60);
  const slugs = (new URL(req.url).searchParams.get("apps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length > 3 || slugs.some((s) => !/^[a-z0-9-]{1,40}$/.test(s))) throw badRequest("Invalid app list.");
  const identity = orgIdentity(ctx.organizationId);
  try {
    const [token, serviceIds] = await Promise.all([gateway().embedToken(identity), slugs.length ? gateway().serviceIds(identity, slugs) : {}]);
    return { token, serviceIds };
  } catch {
    throw new AppError(502, "UPSTREAM", "viaSocket is not reachable right now. Daymark itself is unaffected.");
  }
});
