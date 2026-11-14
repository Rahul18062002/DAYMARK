import { route } from "@/server/http";
import { AppError } from "@/server/errors";
import { throttle } from "@/server/throttle";
import { syncFlows } from "@/server/integrations/viasocket/flows";

// The body is ignored on purpose: the browser only signals "something changed".
export const POST = route({}, async ({ ctx }) => {
  await throttle(`vs-sync:${ctx.organizationId}`, 60, 60);
  try {
    return { flows: await syncFlows(ctx) };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(502, "UPSTREAM", "viaSocket is not reachable right now. Daymark itself is unaffected.");
  }
});
