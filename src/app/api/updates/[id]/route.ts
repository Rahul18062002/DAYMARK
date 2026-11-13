import { route } from "@/server/http";
import { deleteDraft, getOwnUpdate, updateUpdate } from "@/server/services/updates";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ update: await getOwnUpdate(ctx, params.id) }));
export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => updateUpdate(ctx, params.id, await req.json()));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteDraft(ctx, params.id));
