"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/server/auth/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== String(f.get("confirm"))) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) { setBusy(false); return setError("This link is invalid or has expired. Request a new one."); }
    router.replace("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="New password" htmlFor="password" hint="At least 10 characters."><Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus /></Field>
      <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <Button type="submit" className="w-full" loading={busy}>Update password</Button>
    </form>
  );
}
