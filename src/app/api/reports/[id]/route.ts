import { route } from "@/server/http";
import { editReport, getReport } from "@/server/services/summaries";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => getReport(ctx, params.id));
export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => editReport(ctx, params.id, await req.json()));
