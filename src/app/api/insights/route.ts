import { route } from "@/server/http";
import { compare, type GroupBy } from "@/server/services/insights";

export const GET = route({}, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  const g = sp.get("group");
  const groupBy: GroupBy = g === "department" || g === "manager" || g === "level" || g === "all" ? g : "team";
  return compare(ctx, { groupBy, weeks: Number(sp.get("weeks") ?? 4) });
});
