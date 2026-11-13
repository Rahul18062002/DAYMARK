import { route } from "@/server/http";
import { deleteTeam, updateTeam } from "@/server/services/structure";

export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => ({ team: await updateTeam(ctx, params.id, await req.json()) }));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteTeam(ctx, params.id));
