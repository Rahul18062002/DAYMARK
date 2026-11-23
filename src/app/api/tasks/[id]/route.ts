import { route } from "@/server/http";
import { deleteTask, updateTask } from "@/server/services/goals";

export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => updateTask(ctx, params.id, await req.json()));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteTask(ctx, params.id));
