import { z } from "zod";
import { route } from "@/server/http";
import { reviewReport } from "@/server/services/summaries";

const schema = z.object({ action: z.enum(["approve", "reject", "reopen"]), note: z.string().max(1000).nullish() });
export const POST = route<{ id: string }>({}, async ({ req, ctx, params }) => reviewReport(ctx, params.id, schema.parse(await req.json())));
