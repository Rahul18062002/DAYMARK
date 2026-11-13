import { route } from "@/server/http";
import { revokeInvitation } from "@/server/services/invitations";

export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => revokeInvitation(ctx, params.id));
