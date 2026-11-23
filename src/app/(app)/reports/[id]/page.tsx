import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { getReport } from "@/server/services/summaries";
import { AppError } from "@/server/errors";
import { Card, CardBody } from "@/components/ui/card";
import { InfoNotice } from "@/components/ui/states";
import { KIND_LABEL, ReportBody, ReportStatusBadge } from "@/components/reports/report-body";
import { RegenerateButton, ReviewActions } from "@/components/reports/review-actions";
import { formatDay, formatInstant } from "@/lib/dates";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const r = await getReport(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
  const subjectId = r.kind === "PERSON_WEEK" ? r.subjectId : r.kind === "TEAM_WEEK" ? r.teamId : r.kind === "DEPARTMENT_WEEK" ? r.departmentId : null;
  return (
    <>
      <Link href={`/reports?week=${r.periodStart}&view=${r.status === "PUBLISHED" ? "published" : "review"}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Reports</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[r.kind]} report</span><ReportStatusBadge status={r.status} /></div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{r.title}</h1>
          <p className="mt-1 text-sm text-muted">{formatDay(r.periodStart, { day: "numeric", month: "short" })} – {formatDay(r.periodEnd, { day: "numeric", month: "short", year: "numeric" })} · written {formatInstant(r.generatedAt, org.timezone, true)}</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardBody><ReportBody r={r} /></CardBody></Card>
        <div className="space-y-4">
          {r.canReview ? (
            <Card><CardBody className="space-y-4">
              <div><h2 className="text-sm font-semibold">Review</h2><p className="mt-1 text-xs text-muted">{r.status === "PUBLISHED" ? "Published. Reopen it to make changes." : "Check it against what you know, edit anything that's off, then publish. Nothing is shared until you approve it."}</p></div>
              <ReviewActions id={r.id} status={r.status} canEdit={r.canEdit} content={r.content} />
              {r.status !== "PUBLISHED" && <div className="border-t border-border pt-4"><RegenerateButton kind={r.kind} subjectId={subjectId ?? undefined} weekStart={r.periodStart} label="Write it again" /><p className="mt-2 text-xs text-muted">Replaces this draft with a fresh one from the latest updates.</p></div>}
            </CardBody></Card>
          ) : <InfoNotice>This report was reviewed and published by {r.reviewedByName ?? "a reviewer"}.</InfoNotice>}
          {(r.reviewedByName || r.reviewNote) && (
            <Card><CardBody className="space-y-1 text-sm"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Review</div>{r.reviewedByName && <div>{r.status === "REJECTED" ? "Rejected" : "Approved"} by <strong>{r.reviewedByName}</strong>{r.reviewedAt ? ` · ${formatInstant(r.reviewedAt, org.timezone, true)}` : ""}</div>}{r.reviewNote && <p className="text-muted">“{r.reviewNote}”</p>}</CardBody></Card>
          )}
        </div>
      </div>
    </>
  );
}
