import { route } from "@/server/http";
import { resendInvitation } from "@/server/services/invitations";

export const POST = route<{ id: string }>({}, async ({ ctx, params }) => resendInvitation(ctx, params.id));
