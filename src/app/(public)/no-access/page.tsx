import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/context";
import { AuthHeading } from "../auth-ui";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.ctx) redirect("/dashboard");
  return (
    <>
      <AuthHeading title="No active workspace" description={`${state.userEmail} isn't an active member of any Daymark workspace. If this is a mistake, ask your admin to reactivate your account.`} />
      <SignOutButton variant="secondary" className="w-full" />
    </>
  );
}
