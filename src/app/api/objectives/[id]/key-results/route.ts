import { route } from "@/server/http";
import { createKeyResult } from "@/server/services/goals";

export const POST = route<{ id: string }>({}, async ({ req, ctx, params }) => createKeyResult(ctx, params.id, await req.json()));
