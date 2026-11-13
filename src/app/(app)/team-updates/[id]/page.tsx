import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { can } from "@/server/policy";
import { getTeamUpdate } from "@/server/services/team-updates";
import { AppError } from "@/server/errors";
import { PageHeader, InfoNotice } from "@/components/ui/states";
import { UpdateView } from "@/components/updates/update-view";

export const metadata: Metadata = { title: "Team update" };

export default async function TeamUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  if (!can(ctx, "update:team")) redirect("/dashboard");
  const { id } = await params;
  // Out-of-scope, draft and cross-organization updates all resolve to the same "not found".
  const update = await getTeamUpdate(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
  return (
    <>
      <Link href="/team-updates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Team Updates</Link>
      <PageHeader title={`${update.employee.name}'s update`} />
      <div className="max-w-3xl space-y-6">
        <UpdateView update={update} timezone={org.timezone} showEmployee />
        <InfoNotice>This is the employee&apos;s own report and hasn&apos;t been independently verified.</InfoNotice>
      </div>
    </>
  );
}
