import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageContext } from "@/server/auth/context";
import { automationsAccess } from "@/server/integrations/viasocket/access";
import { isViaSocketConfigured } from "@/server/integrations/viasocket/config";
import { EVENT_CATALOG } from "@/server/integrations/viasocket/events";
import { EVENT_FIELDS } from "@/server/integrations/viasocket/event-docs";
import { listFlowsForOrg } from "@/server/integrations/viasocket/flows";
import { listRecentDeliveries } from "@/server/integrations/viasocket/deliveries";
import { getAutomationSettings } from "@/server/integrations/viasocket/settings";
import { PageHeader } from "@/components/ui/states";
import { AutomationsClient } from "./automations-client";

export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const ctx = await requirePageContext();
  const access = await automationsAccess(ctx);
  if (!access.allowed) redirect("/dashboard"); // hidden in nav, refused here, and again in every API
  const configured = isViaSocketConfigured();
  const [settings, flows, deliveries] = await Promise.all([
    getAutomationSettings(ctx.organizationId), configured ? listFlowsForOrg(ctx) : [], configured ? listRecentDeliveries(ctx) : [],
  ]);
  return (
    <>
      <PageHeader title="Automations" description="Connect your apps and decide what happens when something occurs in Daymark." />
      <AutomationsClient
        configured={configured} isAdmin={access.isAdmin} settings={settings} initialFlows={flows} initialDeliveries={deliveries}
        events={Object.entries(EVENT_CATALOG).map(([key, v]) => ({ key, label: v.label, description: v.description, name: v.name, fields: EVENT_FIELDS[key as keyof typeof EVENT_FIELDS] }))}
      />
    </>
  );
}
