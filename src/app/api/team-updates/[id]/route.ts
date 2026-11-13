import { route } from "@/server/http";
import { getTeamUpdate } from "@/server/services/team-updates";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ update: await getTeamUpdate(ctx, params.id) }));
