import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { aiAllowed, listReports } from "@/server/services/summaries";
import { goalFormOptions } from "@/server/services/goals";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState, InfoNotice, PageHeader } from "@/components/ui/states";
import { KIND_LABEL, ReportBody, ReportStatusBadge } from "@/components/reports/report-body";
import { RequestReportDialog } from "@/components/reports/review-actions";
import { Badge } from "@/components/ui/badge";
import { addDays, formatDay } from "@/lib/dates";

export const metadata: Metadata = { title: "Reports" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const base = await listReports(ctx, { view: "all" });                      // for the current/last week anchors
  const week = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.week) ?? "") ? one(sp.week)! : base.lastWeek;
  const reviewer = ctx.role === "ADMIN" || ctx.role === "MANAGER";
  const view = one(sp.view) === "published" ? "published" : one(sp.view) === "review" && reviewer ? "review" : reviewer ? "review" : "published";
  const [{ items }, allowed, opts] = await Promise.all([listReports(ctx, { weekStart: week, view }), aiAllowed(ctx.organizationId), reviewer ? goalFormOptions(ctx) : null]);
  const href = (w: string, v = view) => `/reports?week=${w}&view=${v}`;
  const requestOptions = opts && {
    kinds: [{ id: "TEAM_WEEK", label: "A team" }, { id: "PERSON_WEEK", label: "A person" }, ...(ctx.role === "ADMIN" ? [{ id: "DEPARTMENT_WEEK", label: "A department" }, { id: "COMPANY_WEEK", label: "The whole company" }] : [])],
    subjects: { TEAM_WEEK: opts.teams.map((t) => ({ id: t.id, name: t.name })), PERSON_WEEK: opts.people.map((p) => ({ id: p.id, name: p.name })), DEPARTMENT_WEEK: opts.departments.map((d) => ({ id: d.id, name: d.name })) },
  };
  const groups = (["COMPANY_WEEK", "DEPARTMENT_WEEK", "TEAM_WEEK", "PERSON_WEEK"] as const).map((k) => ({ k, rows: items.filter((i) => i.kind === k) })).filter((g) => g.rows.length);

  return (
    <>
      <PageHeader title="Reports" description="Weekly summaries of what people reported and how goals are moving, written by AI and reviewed by a person before they're published."
        action={reviewer && allowed && requestOptions ? <RequestReportDialog weekStart={week} options={requestOptions} /> : undefined} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <LinkTabs label="Report views" current={view} items={[...(reviewer ? [{ id: "review", label: "To review", href: href(week, "review") }] : []), { id: "published", label: "Published", href: href(week, "published") }]} />
        <div className="-mt-5 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-card" aria-label="Week">
          <Link href={href(addDays(week, -7))} aria-label="Previous week" className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></Link>
          <span className="min-w-36 px-2 text-center text-sm font-medium" aria-live="polite">Week of {formatDay(week, { day: "numeric", month: "short" })}</span>
          <Link href={href(addDays(week, 7))} aria-label="Next week" className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></Link>
        </div>
      </div>
      {reviewer && !allowed && <InfoNotice className="mb-4">AI reports are switched off. An admin can turn them on in Settings → Update schedule once an AI provider key has been added to the server.</InfoNotice>}

      {groups.length === 0 ? (
        <Card><EmptyState icon={<FileText className="h-5 w-5" />} title={view === "review" ? "Nothing waiting for your review" : "No published reports this week"} description={view === "review" ? "New weekly reports appear here on Monday morning. You can also write one yourself." : "Reports show up here once a reviewer approves them."} /></Card>
      ) : groups.map((g) => (
        <section key={g.k} className="mb-6" aria-label={`${KIND_LABEL[g.k]} reports`}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[g.k]} reports</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.rows.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/reports/${r.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{r.title}</Link>
                  <div className="flex items-center gap-1.5">{r.isMine && <Badge tone="primary">About you</Badge>}<ReportStatusBadge status={r.status} /></div>
                </div>
                <ReportBody r={r} compact />
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
