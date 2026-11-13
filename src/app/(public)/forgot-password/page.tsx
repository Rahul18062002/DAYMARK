import type { Metadata } from "next";
import Link from "next/link";
import { isEmailConfigured } from "@/server/email/mailer";
import { InfoNotice } from "@/components/ui/states";
import { AuthHeading } from "../auth-ui";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };
// Email configuration is a runtime property; never freeze it at build time.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const emailReady = isEmailConfigured();
  return (
    <>
      <AuthHeading title="Reset your password" description="Enter your work email and we'll send you a reset link." />
      {emailReady ? (
        <ForgotForm />
      ) : (
        <InfoNotice>Email delivery isn&apos;t configured for this Daymark instance, so password reset links can&apos;t be sent. Please contact your workspace administrator.</InfoNotice>
      )}
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-primary hover:underline">Back to sign in</Link></p>
    </>
  );
}
