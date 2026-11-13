import { route } from "@/server/http";
import { createTeam, listTeams } from "@/server/services/structure";

export const GET = route({}, async ({ ctx }) => ({ teams: await listTeams(ctx) }));
export const POST = route({}, async ({ req, ctx }) => ({ team: await createTeam(ctx, await req.json()) }));
