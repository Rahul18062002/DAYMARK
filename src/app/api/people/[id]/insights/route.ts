import { route } from "@/server/http";
import { personInsights } from "@/server/services/insights";

export const GET = route<{ id: string }>({}, async ({ req, ctx, params }) => personInsights(ctx, params.id, { weeks: Number(new URL(req.url).searchParams.get("weeks") ?? 12) }));
