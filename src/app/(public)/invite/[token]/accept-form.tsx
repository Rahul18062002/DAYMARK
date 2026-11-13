"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/server/auth/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice, InfoNotice } from "@/components/ui/states";

export function AcceptInviteForm(p: { token: string; email: string; accountExists: boolean; signedInAsInvitee: boolean; signedInAsOther: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const done = () => { router.replace("/dashboard"); router.refresh(); };
  const fail = (err: unknown) => {
    setBusy(false);
    if (err instanceof ApiError) { setFields(err.fields); setError(Object.keys(err.fields).length ? null : err.message); }
    else setError("Something went wrong. Please try again.");
  };

  // Existing Daymark account: sign in as the invited email, then accept.
  if (p.accountExists) {
    if (!p.signedInAsInvitee) {
      const next = encodeURIComponent(`/invite/${p.token}`);
      return (
        <div className="space-y-4">
          <InfoNotice>An account already exists for <strong className="text-foreground">{p.email}</strong>. {p.signedInAsOther ? "You're signed in as someone else — sign out and sign in with that account to accept." : "Sign in to accept this invitation."}</InfoNotice>
          {p.signedInAsOther ? (
            <Button className="w-full" variant="secondary" onClick={async () => { await authClient.signOut(); router.push(`/login?next=${next}`); router.refresh(); }}>Sign out and continue</Button>
          ) : (
            <Button asChild className="w-full"><Link href={`/login?next=${next}`}>Sign in to accept</Link></Button>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Button className="w-full" loading={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await api("/api/invitations/accept", { body: { token: p.token, existingAccount: true } }); done(); } catch (e) { fail(e); }
        }}>Accept invitation</Button>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setBusy(true);
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    try {
      await api("/api/invitations/accept", { body: { token: p.token, name: String(f.get("name")), password } });
      const { error: signInError } = await authClient.signIn.email({ email: p.email, password });
      if (signInError) { router.replace("/login"); return; }
      done();
    } catch (err) { fail(err); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label="Email" htmlFor="email"><Input id="email" value={p.email} readOnly disabled /></Field>
      <Field label="Your name" htmlFor="name" error={fields.name}><Input id="name" name="name" autoComplete="name" required autoFocus aria-invalid={!!fields.name} /></Field>
      <Field label="Choose a password" htmlFor="password" error={fields.password} hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!fields.password} />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>Create account &amp; join</Button>
    </form>
  );
}
