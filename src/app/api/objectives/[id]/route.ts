import { route } from "@/server/http";
import { deleteObjective, getObjective, updateObjective } from "@/server/services/goals";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getObjective(ctx, params.id));
export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => updateObjective(ctx, params.id, await req.json()));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteObjective(ctx, params.id));
