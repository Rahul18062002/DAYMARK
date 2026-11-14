import { route } from "@/server/http";
import { updateAutomationSettings } from "@/server/integrations/viasocket/settings";

export const PATCH = route({}, async ({ req, ctx }) => ({ settings: await updateAutomationSettings(ctx, await req.json()) }));
