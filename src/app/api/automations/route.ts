import { route } from "@/server/http";
import { automationsAccess } from "@/server/integrations/viasocket/access";
import { isViaSocketConfigured } from "@/server/integrations/viasocket/config";
import { EVENT_CATALOG } from "@/server/integrations/viasocket/events";
import { listFlowsForOrg } from "@/server/integrations/viasocket/flows";
import { listRecentDeliveries } from "@/server/integrations/viasocket/deliveries";
import { getAutomationSettings } from "@/server/integrations/viasocket/settings";
import { forbidden } from "@/server/errors";

export const GET = route({}, async ({ ctx }) => {
  const access = await automationsAccess(ctx);
  if (!access.allowed) throw forbidden("You don't have access to Automations.");
  const configured = isViaSocketConfigured();
  const [settings, flows, deliveries] = await Promise.all([
    getAutomationSettings(ctx.organizationId), configured ? listFlowsForOrg(ctx) : [], configured ? listRecentDeliveries(ctx) : [],
  ]);
  return { configured, isAdmin: access.isAdmin, settings, events: EVENT_CATALOG, flows, deliveries };
});
