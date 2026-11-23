import { route } from "@/server/http";
import { listReports } from "@/server/services/summaries";

export const GET = route({}, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams, v = sp.get("view");
  return listReports(ctx, { weekStart: sp.get("week") ?? undefined, view: v === "review" || v === "published" ? v : "all" });
});
