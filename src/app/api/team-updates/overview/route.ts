import { route } from "@/server/http";
import { teamHighlights, teamOverview, teamTrend } from "@/server/services/team-updates";

export const GET = route({}, async ({ ctx }) => {
  const [overview, trend, highlights] = await Promise.all([teamOverview(ctx), teamTrend(ctx), teamHighlights(ctx)]);
  return { overview, trend, highlights };
});
