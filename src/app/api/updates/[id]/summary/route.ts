import { route } from "@/server/http";
import { getUpdateSummary, requestUpdateSummary } from "@/server/services/summaries";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ summary: await getUpdateSummary(ctx, params.id) }));
export const POST = route<{ id: string }>({}, async ({ ctx, params }) => requestUpdateSummary(ctx, params.id));
