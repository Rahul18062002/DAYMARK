import { route } from "@/server/http";
import { createTask } from "@/server/services/goals";

export const POST = route<{ id: string }>({}, async ({ req, ctx, params }) => createTask(ctx, params.id, await req.json()));
