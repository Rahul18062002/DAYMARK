import { parseWorkingDays } from "@/lib/working-days";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageContext } from "@/server/auth/context";
import { can } from "@/server/policy";
import { getOrganization } from "@/server/services/organization";
import { listDepartments, listTeams } from "@/server/services/structure";
import { listAssignableManagers } from "@/server/services/members";
import { PageHeader } from "@/components/ui/states";
import { SettingsTabs } from "./settings-tabs";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  if (!can(ctx, "org:settings")) redirect("/dashboard");
  const sp = await searchParams;
  const [org, departments, teams, managers] = await Promise.all([
    getOrganization(ctx), listDepartments(ctx), listTeams(ctx), listAssignableManagers(ctx),
  ]);
  const s = org.settings;
  return (
    <>
      <PageHeader title="Settings" description="Manage your organization, structure and update schedule." />
      <SettingsTabs
        initialTab={sp.tab === "structure" || sp.tab === "schedule" ? sp.tab : "organization"}
        org={{ name: org.name, timezone: org.timezone, logoUrl: org.logoUrl ?? "" }}
        settings={{ updateCutoffTime: s?.updateCutoffTime ?? "18:00", editWindowHours: s?.editWindowHours ?? 24, workingDays: parseWorkingDays(s?.workingDays), aiEnabled: s?.aiEnabled ?? true }}
        departments={departments}
        teams={teams}
        managers={managers}
      />
    </>
  );
}
