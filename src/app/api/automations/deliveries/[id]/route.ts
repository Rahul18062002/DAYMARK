import { route } from "@/server/http";
import { listAttempts } from "@/server/integrations/viasocket/deliveries";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ attempts: await listAttempts(ctx, params.id) }));
