import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { linkableGoals } from "@/server/services/goals";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { getOwnUpdate, getTodayStatus, MAX_BACKDATE_DAYS } from "@/server/services/updates";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui/states";
import { UpdateForm } from "@/components/updates/update-form";
import { addDays, formatInstant } from "@/lib/dates";

export const metadata: Metadata = { title: "Edit update" };

export default async function EditUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const u = await getOwnUpdate(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  if (!u.canEdit) redirect(`/my-updates/${id}`); // edit window closed
  const [{ today }, org] = await Promise.all([getTodayStatus(ctx), prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } })]);

  return (
    <>
      <Link href={u.status === "DRAFT" ? "/my-updates" : `/my-updates/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
      <PageHeader title={u.status === "DRAFT" ? "Continue your draft" : "Edit your update"} />
      <div className="max-w-3xl">
        <UpdateForm
          key={u.updatedAt}
          mode="edit" id={id} status={u.status} updateDate={u.updateDate} minDate={addDays(today, -MAX_BACKDATE_DAYS)} maxDate={today}
          initial={{ workedOn: u.sections.WORKED_ON.length ? u.sections.WORKED_ON : [""], completed: u.sections.COMPLETED, pending: u.sections.PENDING, blockers: u.sections.BLOCKER, nextPriorities: u.sections.NEXT_PRIORITY }}
          initialLinks={u.links.map((l) => ({ url: l.url, label: l.label ?? "" }))}
          goals={await linkableGoals(ctx)} initialGoalIds={u.goals.map((g) => g.id)}
          editableUntilLabel={u.editableUntil ? formatInstant(u.editableUntil, org.timezone) : null}
        />
      </div>
    </>
  );
}
