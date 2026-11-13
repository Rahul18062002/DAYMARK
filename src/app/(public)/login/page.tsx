import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/context";
import { AuthHeading, safeNext } from "../auth-ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const state = await getSessionState();
  if (state?.ctx) redirect(next);
  return (
    <>
      <AuthHeading title="Welcome back" description="Sign in to your Daymark workspace." />
      <LoginForm next={next} reset={sp.reset === "1"} />
    </>
  );
}
