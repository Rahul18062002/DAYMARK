import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { goalFormOptions, listObjectives } from "@/server/services/goals";
import { AppError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorNotice, PageHeader } from "@/components/ui/states";
import { Progress } from "@/components/ui/progress";
import { GoalTree } from "@/components/goals/goal-tree";
import { NewGoalButton } from "@/components/goals/goal-forms";
import { addDays } from "@/lib/dates";
import { quarterOf } from "@/lib/goals";

export const metadata: Metadata = { title: "Goals" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const mine = one(sp.view) === "mine";
  const filters = { ...(one(sp.from) && one(sp.to) ? { from: one(sp.from), to: one(sp.to) } : {}), ...(mine ? { mine: "1" } : {}) };
  let data: Awaited<ReturnType<typeof listObjectives>> | null = null;
  let error: string | null = null;
  try { data = await listObjectives(ctx, filters); }
  catch (e) { if (e instanceof AppError || (e as { name?: string }).name === "ZodError") error = e instanceof AppError ? e.message : "Check the period and try again."; else throw e; }
  const [options, fallback] = await Promise.all([goalFormOptions(ctx), data ? Promise.resolve(null) : listObjectives(ctx, {})]);
  const d = data ?? fallback!;

  // quarter navigation: previous / next calendar quarter
  const q = quarterOf(d.period.from);
  const prev = quarterOf(addDays(q.start, -1)), next = quarterOf(addDays(q.end, 1));
  const href = (p: { start: string; end: string }) => `/goals?from=${p.start}&to=${p.end}${mine ? "&view=mine" : ""}`;
  const items = d.items;
  const company = items.filter((i) => i.level === "COMPANY" && i.status !== "CANCELLED");
  const measured = items.filter((i) => i.progress !== null && i.status !== "CANCELLED");
  const count = (h: string) => measured.filter((i) => i.health === h).length;
  const avgCompany = company.filter((i) => i.progress !== null);
  const companyProgress = avgCompany.length ? avgCompany.reduce((s, i) => s + (i.progress as number), 0) / avgCompany.length : null;

  return (
    <>
      <PageHeader title="Goals" description="Objectives and key results, from the company down to each person. Progress rolls up automatically."
        action={<NewGoalButton options={options} parents={items.filter((i) => i.status === "ACTIVE").map((i) => ({ id: i.id, title: i.title, level: i.level }))} period={{ from: d.period.from, to: d.period.to }} />} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <LinkTabs label="Goal views" current={mine ? "mine" : "all"} items={[{ id: "all", label: "All goals", href: `/goals?from=${d.period.from}&to=${d.period.to}` }, { id: "mine", label: "My goals", href: `/goals?from=${d.period.from}&to=${d.period.to}&view=mine` }]} />
        <div className="-mt-5 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-card" aria-label="Period">
          <Link href={href(prev)} aria-label={`Previous quarter, ${prev.label}`} className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></Link>
          <span className="min-w-24 px-2 text-center text-sm font-medium" aria-live="polite">{d.period.label}</span>
          <Link href={href(next)} aria-label={`Next quarter, ${next.label}`} className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></Link>
        </div>
      </div>

      {error && <ErrorNotice className="mb-4">{error}</ErrorNotice>}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 sm:col-span-2">
          <div className="text-sm text-muted">Company progress</div>
          <div className="tabular mt-1 text-3xl font-semibold tracking-tight">{companyProgress === null ? "—" : `${Math.round(companyProgress)}%`}</div>
          <Progress className="mt-3" label="Company progress" value={companyProgress ?? 0} />
          <div className="mt-2 text-xs text-muted">{company.length === 0 ? "No company goals this period yet." : `Across ${company.length} company goal${company.length === 1 ? "" : "s"}.`}</div>
        </Card>
        <Card className="p-4 sm:col-span-2">
          <div className="text-sm text-muted">Health of {measured.length} measured goal{measured.length === 1 ? "" : "s"}</div>
          <div className="mt-1 grid grid-cols-3 gap-3">
            {([["On track", "ON_TRACK", "text-success"], ["At risk", "AT_RISK", "text-warning"], ["Off track", "OFF_TRACK", "text-danger"]] as const).map(([label, k, tone]) => (
              <div key={k}><div className={`tabular text-3xl font-semibold tracking-tight ${tone}`}>{count(k)}</div><div className="text-xs text-muted">{label}</div></div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted">A goal is at risk when it falls behind the calendar or its owner says so.</div>
        </Card>
      </div>

      <Card className="p-3 sm:p-4">
        {items.length === 0 ? (
          <EmptyState icon={<Target className="h-5 w-5" />} title={mine ? "You have no goals this period" : "No goals this period yet"}
            description={mine ? "Add a goal of your own and link it to a team or company goal so your work counts towards it." : "Start with a company goal, then let departments, teams and people add the goals that support it."}
            action={<NewGoalButton options={options} parents={[]} period={{ from: d.period.from, to: d.period.to }} label={mine ? "Add my first goal" : "Create the first goal"} />} />
        ) : <GoalTree items={items} />}
      </Card>
      <p className="mt-3 text-xs text-muted">Progress is each owner&apos;s own reading and hasn&apos;t been independently verified.</p>
    </>
  );
}
