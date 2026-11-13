import { route } from "@/server/http";
import { createInvitation, listInvitations } from "@/server/services/invitations";

export const GET = route({}, async ({ ctx }) => ({ invitations: await listInvitations(ctx) }));
export const POST = route({}, async ({ req, ctx }) => createInvitation(ctx, await req.json()));
