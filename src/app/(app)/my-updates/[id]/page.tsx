import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Pencil } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { getOwnUpdate } from "@/server/services/updates";
import { AppError } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/states";
import { UpdateView } from "@/components/updates/update-view";
import { formatInstant } from "@/lib/dates";

export const metadata: Metadata = { title: "Update" };

export default async function OwnUpdatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string; edited?: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const sp = await searchParams;
  const update = await getOwnUpdate(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  if (update.status === "DRAFT") redirect(`/my-updates/${id}/edit`);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });

  return (
    <>
      <Link href="/my-updates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> My Updates</Link>
      <PageHeader title="Your update" action={update.canEdit ? <Button asChild variant="secondary"><Link href={`/my-updates/${id}/edit`}><Pencil className="h-4 w-4" /> Edit</Link></Button> : undefined} />
      {(sp.submitted || sp.edited) && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-success">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">{sp.submitted ? "Update submitted" : "Changes saved"}</div>
            <p className="text-sm">{sp.submitted ? "Thanks! Your manager can now see it." : "Your update was changed and the earlier version is kept in its history."}
              {update.editableUntil && ` You can still edit it until ${formatInstant(update.editableUntil, org.timezone)}.`}</p>
          </div>
        </div>
      )}
      <div className="max-w-3xl"><UpdateView update={update} timezone={org.timezone} /></div>
    </>
  );
}
