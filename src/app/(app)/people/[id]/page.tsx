import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Flame, Minus } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { personInsights } from "@/server/services/insights";
import { AppError } from "@/server/errors";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, InfoNotice } from "@/components/ui/states";
import { HealthBadge, LevelBadge } from "@/components/goals/badges";
import { WeeklyBars } from "@/components/goals/metric";
import { BlockerBadge, LateBadge } from "@/components/updates/badges";
import { formatDay } from "@/lib/dates";

export const metadata: Metadata = { title: "Profile" };
const ROLE = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card className="p-4"><div className="text-sm text-muted">{label}</div><div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>{hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}</Card>;
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const d = await personInsights(ctx, id).catch((e) => { if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound(); throw e; });
  const p = d.person;
  const delta = d.trend.delta;
  const TrendIcon = delta === null || Math.abs(delta) < 1 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <>
      <Link href="/org-chart" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Org chart</Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={p.name} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}{d.isSelf && <span className="ml-2 text-sm font-normal text-muted">(you)</span>}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <Badge tone={p.role === "ADMIN" ? "primary" : p.role === "MANAGER" ? "warning" : "neutral"}>{ROLE[p.role]}</Badge>
            {p.level !== null && <Badge>Level {p.level}</Badge>}
            {[p.jobTitle, p.teamName, p.departmentName].filter(Boolean).length > 0 && <span>{[p.jobTitle, p.teamName, p.departmentName].filter(Boolean).join(" · ")}</span>}
            {p.managerName && <span>Reports to {p.managerName}</span>}
            {p.mentorName && <span>Mentor: {p.mentorName}</span>}
            <span>Joined {formatDay(p.joinedAt, { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Reporting consistency" value={p.consistency === null ? "—" : `${Math.round(p.consistency)}%`} hint={`${p.submittedDays} of ${p.expectedDays} working days`} />
        <Kpi label="On time" value={p.onTimeRate === null ? "—" : `${Math.round(p.onTimeRate)}%`} hint="of submitted updates" />
        <Card className="p-4"><div className="text-sm text-muted">Current streak</div><div className="tabular mt-1 inline-flex items-center gap-1.5 text-2xl font-semibold tracking-tight"><Flame className="h-5 w-5 text-warning" aria-hidden />{p.streak}</div><div className="mt-0.5 text-xs text-muted">working days in a row</div></Card>
        <Kpi label="Goal progress" value={p.goals.avgProgress === null ? "—" : `${Math.round(p.goals.avgProgress)}%`} hint={`${p.goals.owned} active goal${p.goals.owned === 1 ? "" : "s"}`} />
        <Kpi label="Tasks done" value={String(p.tasks.doneInWindow)} hint={`${p.tasks.open} open${p.tasks.overdue ? ` · ${p.tasks.overdue} overdue` : ""}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Reporting over time" description={`Share of expected working days with an update, week by week (last ${d.weeks} weeks).`}
              action={d.trend.delta !== null ? <span className="inline-flex items-center gap-1 text-sm font-medium text-muted"><TrendIcon className={`h-4 w-4 ${delta! > 0 ? "text-success" : delta! < 0 ? "text-warning" : ""}`} aria-hidden />{delta! > 0 ? "+" : ""}{delta}% vs the 4 weeks before</span> : undefined} />
            <div className="p-5"><WeeklyBars weeks={p.weekly} label={`${p.name} weekly reporting consistency`} />
              <div className="mt-2 flex justify-between text-[11px] text-muted"><span>{formatDay(d.from, { day: "numeric", month: "short" })}</span><span>This week</span></div></div>
          </Card>

          <Card>
            <CardHeader title="Recent updates" description="Their own words. Not independently verified." />
            {d.recentUpdates.length === 0 ? <EmptyState title="No updates in this period" /> : (
              <ul className="divide-y divide-border">
                {d.recentUpdates.map((u) => (
                  <li key={u.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0"><div className="text-xs text-muted">{formatDay(u.date, { weekday: "short", day: "numeric", month: "short" })}</div>
                      <Link href={d.isSelf ? `/my-updates/${u.id}` : `/team-updates/${u.id}`} className="line-clamp-2 text-sm hover:text-primary hover:underline">{u.preview || "View update"}</Link></div>
                    <div className="flex shrink-0 gap-1">{u.late && <LateBadge />}{u.hasBlockers && <BlockerBadge has />}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Goals" description="What they own this period." />
            {d.goals.length === 0 ? <EmptyState title="No goals yet" description="Goals they own will show up here." /> : (
              <ul className="divide-y divide-border">
                {d.goals.map((g) => (
                  <li key={g.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2"><Link href={`/goals/${g.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{g.title}</Link><LevelBadge level={g.level} /></div>
                    <div className="flex items-center gap-3"><Progress className="flex-1" label={`${g.title} progress`} value={g.progress ?? 0} showValue /><HealthBadge health={g.health} progress={g.progress} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <InfoNotice>These figures describe reporting habits and goal progress. They are not a rating of performance or of the value of someone&apos;s work.</InfoNotice>
        </div>
      </div>
    </>
  );
}
