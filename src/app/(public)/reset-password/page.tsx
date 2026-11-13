import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthHeading } from "../auth-ui";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <>
        <AuthHeading title="This reset link isn't valid" description="It may have expired or already been used. Request a new one." />
        <Button asChild className="w-full"><Link href="/forgot-password">Request a new link</Link></Button>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Choose a new password" />
      <ResetForm token={token} />
    </>
  );
}
