import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Scale, Flame } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { canOpenTeamView } from "@/server/policy";
import { compare, type GroupBy } from "@/server/services/insights";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState, InfoNotice, PageHeader } from "@/components/ui/states";
import { MetricBar } from "@/components/goals/metric";

export const metadata: Metadata = { title: "Compare" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const GROUPS: { id: GroupBy; label: string }[] = [{ id: "team", label: "By team" }, { id: "department", label: "By department" }, { id: "manager", label: "By manager" }, { id: "level", label: "By level" }, { id: "all", label: "Everyone" }];

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  if (!(await canOpenTeamView(prisma, ctx))) redirect("/dashboard");
  const sp = await searchParams;
  const groupBy = (GROUPS.find((g) => g.id === one(sp.group))?.id ?? "team") as GroupBy;
  const weeks = one(sp.weeks) === "12" ? 12 : 4;
  const r = await compare(ctx, { groupBy, weeks });
  const q = (g: string, w: number) => `/compare?group=${g}&weeks=${w}`;

  return (
    <>
      <PageHeader title="Compare" description="See how people in the same group are getting on: how steadily they report, and how their goals are moving." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <LinkTabs label="Group people" current={groupBy} items={GROUPS.map((g) => ({ id: g.id, label: g.label, href: q(g.id, weeks) }))} />
        <div className="-mt-5 inline-flex rounded-lg border border-border bg-surface p-1 text-sm shadow-card" aria-label="Time window">
          {[4, 12].map((w) => <Link key={w} href={q(groupBy, w)} aria-current={w === weeks ? "true" : undefined} className={`rounded-md px-3 py-1 font-medium ${w === weeks ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground"}`}>{w} weeks</Link>)}
        </div>
      </div>
      <InfoNotice className="mb-5">These numbers describe reporting habits and goal progress over the last {weeks} weeks. They say nothing about the quality or value of anyone&apos;s work, so use them to start conversations, not to rank people. Everything is self-reported.</InfoNotice>

      {r.groups.length === 0 ? (
        <Card><EmptyState icon={<Scale className="h-5 w-5" />} title="Nobody to compare yet" description="People appear here once they've joined and your company's visibility settings allow you to see them." /></Card>
      ) : r.groups.map((g) => (
        <Card key={g.name} className="mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <div><h2 className="text-sm font-semibold">{g.name}</h2><p className="text-xs text-muted">{g.size} {g.size === 1 ? "person" : "people"}</p></div>
            <div className="flex gap-6 text-xs text-muted">
              <span>Median consistency <strong className="tabular ml-1 text-sm text-foreground">{g.medianConsistency === null ? "—" : `${Math.round(g.medianConsistency)}%`}</strong></span>
              <span>Median goal progress <strong className="tabular ml-1 text-sm text-foreground">{g.medianGoalProgress === null ? "—" : `${Math.round(g.medianGoalProgress)}%`}</strong></span>
            </div>
          </div>
          <div className="relative overflow-x-auto">
            <table className="data-table" data-testid="compare-table">
              <thead><tr><th>Person</th><th>Reporting consistency</th><th>On time</th><th>Streak</th><th>Goal progress</th><th>Tasks done</th><th>Updates tagged to goals</th></tr></thead>
              <tbody>
                {g.people.map((p) => (
                  <tr key={p.membershipId}>
                    <td><div className="flex items-center gap-3"><Avatar name={p.name} size="sm" /><div className="min-w-0"><Link href={`/people/${p.membershipId}`} className="block truncate font-medium hover:text-primary hover:underline">{p.name}{p.membershipId === ctx.membershipId && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</Link><div className="truncate text-xs text-muted">{[p.jobTitle, p.level ? `Level ${p.level}` : null].filter(Boolean).join(" · ") || "—"}</div></div></div></td>
                    <td><MetricBar value={p.consistency} label={`${p.name} reporting consistency`} /></td>
                    <td><MetricBar value={p.onTimeRate} label={`${p.name} on time`} /></td>
                    <td>{p.streak > 0 ? <span className="tabular inline-flex items-center gap-1 text-sm font-medium"><Flame className="h-3.5 w-3.5 text-warning" aria-hidden />{p.streak}<span className="text-xs font-normal text-muted"> day{p.streak === 1 ? "" : "s"}</span></span> : <span className="text-xs text-muted">—</span>}</td>
                    <td>{p.goals.owned === 0 ? <span className="text-xs text-muted">No goals</span> : <div><MetricBar value={p.goals.avgProgress} label={`${p.name} goal progress`} tone={p.goals.offTrack ? "danger" : p.goals.atRisk ? "warning" : undefined} /><div className="mt-1 text-[11px] text-muted">{p.goals.owned} goal{p.goals.owned === 1 ? "" : "s"}{p.goals.offTrack ? ` · ${p.goals.offTrack} off track` : p.goals.atRisk ? ` · ${p.goals.atRisk} at risk` : ""}</div></div>}</td>
                    <td className="tabular text-sm">{p.tasks.doneInWindow}{p.tasks.overdue > 0 && <span className="ml-1.5 text-xs text-danger">{p.tasks.overdue} overdue</span>}</td>
                    <td className="tabular text-sm">{p.taggedUpdates}<span className="text-xs text-muted"> of {p.submittedDays}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
