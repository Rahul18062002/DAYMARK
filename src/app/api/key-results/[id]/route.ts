import { route } from "@/server/http";
import { deleteKeyResult, updateKeyResult } from "@/server/services/goals";

export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => updateKeyResult(ctx, params.id, await req.json()));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteKeyResult(ctx, params.id));
