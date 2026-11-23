import { route } from "@/server/http";
import { recordCheckIn } from "@/server/services/goals";

export const POST = route<{ id: string }>({}, async ({ req, ctx, params }) => recordCheckIn(ctx, params.id, await req.json()));
