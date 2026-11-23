"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/server/auth/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";
import { timezoneOptions } from "@/lib/timezones";

export function OnboardingForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const defaultTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const zones = useMemo(() => timezoneOptions(defaultTz), [defaultTz]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = {
      organizationName: String(f.get("organizationName")),
      timezone: String(f.get("timezone")),
      name: String(f.get("name")),
      email: String(f.get("email")),
      password: String(f.get("password")),
    };
    try {
      await api("/api/onboarding", { body });
      const { error: signInError } = await authClient.signIn.email({ email: body.email.trim().toLowerCase(), password: body.password });
      if (signInError) {
        router.replace("/login");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        setFields(err.fields);
        setError(Object.keys(err.fields).length ? null : err.message);
      } else setError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <ErrorNotice>{error}{error.includes("already exists") && <> <Link href="/login" className="font-medium underline">Sign in</Link></>}</ErrorNotice>}
      <Field label="Company name" htmlFor="organizationName" error={fields.organizationName}>
        <Input id="organizationName" name="organizationName" required autoFocus aria-invalid={!!fields.organizationName} placeholder="Acme Inc." />
      </Field>
      <Field label="Timezone" htmlFor="timezone" error={fields.timezone} hint="Used for daily update cut-offs and reports.">
        <Select id="timezone" name="timezone" defaultValue={defaultTz}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      <hr className="border-border" />
      <Field label="Your name" htmlFor="name" error={fields.name}>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fields.name} />
      </Field>
      <Field label="Work email" htmlFor="email" error={fields.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fields.email} placeholder="you@company.com" />
      </Field>
      <Field label="Password" htmlFor="password" error={fields.password} hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!fields.password} />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>Create workspace</Button>
      <p className="text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link></p>
    </form>
  );
}
