import { route } from "@/server/http";
import { getMember } from "@/server/services/members";

export const GET = route({}, async ({ ctx }) => ({
  user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail },
  organizationId: ctx.organizationId,
  membership: await getMember(ctx, ctx.membershipId),
}));
