"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/server/auth/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";

export function LoginForm({ next, reset }: { next: string; reset?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({ email: String(f.get("email")).trim(), password: String(f.get("password")) });
    if (error) {
      setBusy(false);
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Incorrect email or password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {reset && <div role="status" className="rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-sm text-success">Password updated. Sign in with your new password.</div>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="you@company.com" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link>
        <Link href="/onboarding" className="text-muted hover:text-foreground">Create a workspace</Link>
      </div>
      <p className="text-center text-xs text-muted">Joining a team? Use the invitation link your admin sent you.</p>
    </form>
  );
}
