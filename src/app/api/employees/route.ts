import { route } from "@/server/http";
import { listMembers } from "@/server/services/members";

export const GET = route({}, async ({ req, ctx }) => {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  return { employees: await listMembers(ctx, q) };
});
