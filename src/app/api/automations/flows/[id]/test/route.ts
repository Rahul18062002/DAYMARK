import { route } from "@/server/http";
import { throttle } from "@/server/throttle";
import { sendTestEvent } from "@/server/integrations/viasocket/flows";

export const POST = route<{ id: string }>({}, async ({ ctx, params }) => {
  await throttle(`vs-test:${ctx.organizationId}`, 20, 60);
  return sendTestEvent(ctx, params.id);
});
