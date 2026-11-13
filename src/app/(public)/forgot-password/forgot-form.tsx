"use client";
import { useState } from "react";
import { authClient } from "@/server/auth/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";

export function ForgotForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    if (error && error.status === 429) return setError("Too many requests. Please wait a few minutes and try again.");
    setSent(true); // Same message whether or not the account exists.
  }

  if (sent) {
    return <div role="status" className="rounded-lg border border-success/30 bg-success-soft px-3 py-3 text-sm text-success">If an account exists for that email, a reset link is on its way. It expires in 1 hour.</div>;
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Work email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required autoFocus /></Field>
      <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
    </form>
  );
}
