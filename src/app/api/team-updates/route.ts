import { route } from "@/server/http";
import { listTeamUpdates } from "@/server/services/team-updates";

export const GET = route({}, async ({ req, ctx }) => listTeamUpdates(ctx, Object.fromEntries(new URL(req.url).searchParams)));
