import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/context";
import { AuthHeading } from "../auth-ui";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const state = await getSessionState();
  if (state?.ctx) redirect("/dashboard");
  return (
    <>
      <AuthHeading title="Create your Daymark workspace" description="Set up your company and your admin account. You can invite your team next." />
      <OnboardingForm />
    </>
  );
}
