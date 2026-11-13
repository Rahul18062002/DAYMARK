import type { Metadata } from "next";
import Link from "next/link";
import { getSessionState } from "@/server/auth/context";
import { previewInvitation } from "@/server/services/invitations";
import { Button } from "@/components/ui/button";
import { AuthHeading } from "../../auth-ui";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invitation" };
const ROLE_LABEL = { ADMIN: "an admin", MANAGER: "a manager", EMPLOYEE: "a team member" } as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvitation(token);

  if (!preview) {
    return (
      <>
        <AuthHeading title="This invitation isn't valid" description="It may have expired, been revoked, or already been used. Ask your admin to send a new invitation." />
        <Button asChild variant="secondary" className="w-full"><Link href="/login">Go to sign in</Link></Button>
      </>
    );
  }

  const state = await getSessionState();
  const signedInAsInvitee = state?.userEmail.toLowerCase() === preview.email.toLowerCase();
  const heading = `Join ${preview.organizationName}`;
  const sub = `${preview.inviterName} invited you to join as ${ROLE_LABEL[preview.role]}.`;

  return (
    <>
      <AuthHeading title={heading} description={sub} />
      <AcceptInviteForm
        token={token}
        email={preview.email}
        accountExists={preview.accountExists}
        signedInAsInvitee={signedInAsInvitee}
        signedInAsOther={Boolean(state) && !signedInAsInvitee}
      />
    </>
  );
}
