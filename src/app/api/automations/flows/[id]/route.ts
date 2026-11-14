import { route } from "@/server/http";
import { linkFlow } from "@/server/integrations/viasocket/flows";

export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => linkFlow(ctx, params.id, await req.json()));
