import { headers } from "next/headers";
import { route } from "@/server/http";
import { auth } from "@/server/auth/auth";
import { badRequest, unauthorized } from "@/server/errors";
import { acceptInvitationExistingUser, acceptInvitationNewUser } from "@/server/services/invitations";

// Public. New people set a password here; existing accounts must be signed in as the invited email.
export const POST = route({ auth: false, limit: [20, 600, "invite-accept"] }, async ({ req }) => {
  const body = await req.json();
  if (body?.existingAccount === true) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw unauthorized("Sign in to accept this invitation.");
    if (typeof body.token !== "string") throw badRequest("Missing invitation token.");
    return acceptInvitationExistingUser({ id: session.user.id, email: session.user.email }, body.token);
  }
  const out = await acceptInvitationNewUser(body);
  return { email: out.email };
});
