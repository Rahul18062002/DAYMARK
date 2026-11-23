import Link from "next/link";
import { ArrowRight, ListChecks, Target } from "lucide-react";
import type { Actor } from "@/server/policy";
import { listObjectives, myGoals } from "@/server/services/goals";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Progress } from "@/components/ui/progress";
import { HealthBadge } from "./badges";
import { formatDay } from "@/lib/dates";

/** A compact view of the company's goals, the person's own goals and their open tasks, for the dashboards. */
export async function GoalsSnapshot({ ctx }: { ctx: Actor }) {
  const [all, mine] = await Promise.all([listObjectives(ctx, {}), myGoals(ctx)]);
  const company = all.items.filter((i) => i.level === "COMPANY" && i.status === "ACTIVE").slice(0, 3);
  const own = mine.objectives.filter((o) => o.status === "ACTIVE").slice(0, 3);
  const tasks = mine.tasks.slice(0, 3);
  return (
    <Card>
      <CardHeader title={`Goals · ${all.period.label}`} description="How the company, and you, are doing against what you set out to achieve." action={<Button asChild variant="ghost" size="sm"><Link href="/goals">All goals <ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>} />
      {company.length === 0 && own.length === 0 && tasks.length === 0 ? (
        <EmptyState icon={<Target className="h-5 w-5" />} title="No goals yet" description="Goals set for this quarter will show up here, from the company down to you." action={<Button asChild variant="secondary"><Link href="/goals">Go to goals</Link></Button>} />
      ) : (
        <div className="grid divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <section className="space-y-3 p-5" aria-label="Company goals">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Company</h3>
            {company.length === 0 ? <p className="text-sm text-muted">No company goals this quarter.</p> : company.map((g) => (
              <div key={g.id} className="space-y-1.5"><div className="flex items-start justify-between gap-2"><Link href={`/goals/${g.id}`} className="text-sm font-medium hover:text-primary hover:underline">{g.title}</Link><HealthBadge health={g.health} progress={g.progress} /></div><Progress label={`${g.title} progress`} value={g.progress ?? 0} showValue /></div>
            ))}
          </section>
          <section className="space-y-3 p-5" aria-label="Your goals">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Yours</h3>
            {own.length === 0 ? <p className="text-sm text-muted">You don&apos;t own a goal this quarter. <Link href="/goals?view=mine" className="font-medium text-primary hover:underline">Add one</Link>.</p> : own.map((g) => (
              <div key={g.id} className="space-y-1.5"><Link href={`/goals/${g.id}`} className="text-sm font-medium hover:text-primary hover:underline">{g.title}</Link><Progress label={`${g.title} progress`} value={g.progress ?? 0} showValue /></div>
            ))}
          </section>
          <section className="space-y-3 p-5" aria-label="Your tasks">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Your open tasks</h3>
            {tasks.length === 0 ? <p className="text-sm text-muted">Nothing waiting on you.</p> : tasks.map((t) => (
              <Link key={t.id} href={`/goals/${t.objectiveId}`} className="flex items-start gap-2 rounded-lg text-sm hover:text-primary"><ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="block truncate font-medium">{t.title}</span><span className={`text-xs ${t.overdue ? "text-danger" : "text-muted"}`}>{t.dueDate ? `Due ${formatDay(t.dueDate, { day: "numeric", month: "short" })}` : "No due date"}</span></span></Link>
            ))}
          </section>
        </div>
      )}
    </Card>
  );
}
