import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flag, ListChecks, Target } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { goalFormOptions, getObjective, listObjectives } from "@/server/services/goals";
import { AppError } from "@/server/errors";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoNotice } from "@/components/ui/states";
import { Progress } from "@/components/ui/progress";
import { HEALTH_LABEL, HealthBadge, LevelBadge, StatusBadge } from "@/components/goals/badges";
import { Sparkline } from "@/components/goals/sparkline";
import { AddTaskForm, CheckInButton, DeleteKeyResultButton, DeleteTaskButton, EditGoalButton, GoalActions, NewGoalButton, NewKeyResultButton, TaskStatusSelect } from "@/components/goals/goal-forms";
import { formatDay, formatInstant } from "@/lib/dates";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Goal" };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
const nextLevel = { COMPANY: "DEPARTMENT", DEPARTMENT: "TEAM", TEAM: "INDIVIDUAL", INDIVIDUAL: "INDIVIDUAL" } as const;

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const g = await getObjective(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const o = g.objective;
  const [options, list, org] = await Promise.all([goalFormOptions(ctx), listObjectives(ctx, { from: o.periodStart, to: o.periodEnd }), prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } })]);
  const parents = list.items.filter((i) => i.status === "ACTIVE" && i.id !== o.id).map((i) => ({ id: i.id, title: i.title, level: i.level }));
  const period = { from: o.periodStart, to: o.periodEnd };
  const peopleForWork = options.people.length ? options.people : [{ id: ctx.membershipId, name: "You" }];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/goals" className="inline-flex items-center gap-1.5 hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Goals</Link>
        {g.ancestors.map((a) => <span key={a.id} className="inline-flex items-center gap-1.5"><span aria-hidden>/</span><Link href={`/goals/${a.id}`} className="max-w-48 truncate hover:text-foreground hover:underline">{a.title}</Link></span>)}
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2"><LevelBadge level={o.level} /><StatusBadge status={o.status} /><HealthBadge health={o.health} progress={o.progress} /></div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{o.title}</h1>
          {o.description && <p className="mt-2 whitespace-pre-line text-sm text-muted">{o.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-center gap-2"><Avatar name={o.ownerName} size="sm" />{o.ownerName}</span>
            {(o.teamName || o.departmentName) && <span>{o.teamName ?? o.departmentName}</span>}
            <span>{formatDay(o.periodStart, { day: "numeric", month: "short", year: "numeric" })} – {formatDay(o.periodEnd, { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
        {g.canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <EditGoalButton options={options} parents={parents} period={period} goal={{ id: o.id, title: o.title, description: o.description, ownerId: o.ownerId, parentId: o.parentId, periodStart: o.periodStart, periodEnd: o.periodEnd, level: o.level }} />
            <GoalActions id={o.id} status={o.status} hasChildren={g.children.length > 0} parentId={o.parentId} />
          </div>
        )}
      </div>

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><div className="text-sm text-muted">Progress</div><div className="tabular text-4xl font-semibold tracking-tight">{o.progress === null ? "—" : `${Math.round(o.progress)}%`}</div></div>
          <div className="text-xs text-muted">{o.progress === null ? "Add a key result or a task to start measuring." : `${HEALTH_LABEL[o.health]} · from ${o.keyResultCount} key result${o.keyResultCount === 1 ? "" : "s"}${o.childCount ? `, ${o.childCount} goal${o.childCount === 1 ? "" : "s"} below` : ""}`}</div></div>
        <Progress className="mt-3" label="Goal progress" value={o.progress ?? 0} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Key results" description="Measurable results that show the goal is being achieved." action={g.canManage && o.status === "ACTIVE" ? <NewKeyResultButton objectiveId={o.id} people={options.people.length ? options.people : peopleForWork} selfId={ctx.membershipId} defaultOwnerId={o.ownerId} /> : undefined} />
            {g.keyResults.length === 0 ? <EmptyState icon={<Target className="h-5 w-5" />} title="No key results yet" description={g.canManage ? "Add the numbers that will tell you whether this goal is on track." : "The owner hasn't added key results yet."} /> : (
              <ul className="divide-y divide-border">
                {g.keyResults.map((k) => (
                  <li key={k.id} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{k.title}</span>{k.isKpi && <Badge tone="primary">KPI</Badge>}{k.weight > 1 && <Badge>Weight {k.weight}</Badge>}</div>
                        <div className="mt-0.5 text-xs text-muted">{k.ownerName}{k.lastCheckInAt ? ` · updated ${formatInstant(k.lastCheckInAt, org.timezone, true)}` : ""}</div></div>
                      <div className="flex items-center gap-1">{k.canCheckIn && <CheckInButton kr={k} />}{g.canManage && <DeleteKeyResultButton id={k.id} title={k.title} />}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Progress className="min-w-40 flex-1" label={`${k.title} progress`} value={k.progress} showValue />
                      <span className="tabular text-sm text-muted">{k.type === "BOOLEAN" ? (k.currentValue >= 1 ? "Done" : "Not done") : `${fmt(k.currentValue)} / ${fmt(k.targetValue)}${k.type === "PERCENT" ? "%" : k.unit ? ` ${k.unit}` : ""}`}</span>
                      <HealthBadge health={k.confidence} progress={k.progress} />
                      <Sparkline values={[...k.checkIns].reverse().map((c) => c.value)} />
                    </div>
                    {k.checkIns.length > 1 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Progress history ({k.checkIns.length})</summary>
                        <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                          {k.checkIns.map((c) => <li key={c.id} className="text-xs text-muted"><span className="tabular font-medium text-foreground">{fmt(c.value)}</span> · {formatInstant(c.createdAt, org.timezone, true)} · {c.authorName}{c.comment ? ` — ${c.comment}` : ""}</li>)}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Tasks" description="Small pieces of work that move this goal forward." />
            {g.tasks.length === 0 ? <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No tasks yet" description={g.canAddTask ? "Break the goal into tasks and give each one an owner." : undefined} /> : (
              <ul className="divide-y divide-border">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1"><div className={`text-sm font-medium ${t.status === "DONE" ? "text-muted line-through" : ""}`}>{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><Avatar name={t.assigneeName} size="sm" className="!h-5 !w-5 !text-[9px]" />{t.assigneeName}</span>{t.dueDate && <span className={t.status !== "DONE" && t.dueDate < g.today ? "font-medium text-danger" : ""}>Due {formatDay(t.dueDate, { day: "numeric", month: "short" })}</span>}</div></div>
                    <TaskStatusSelect id={t.id} status={t.status} title={t.title} disabled={!t.canUpdate} />
                    {t.canDelete && <DeleteTaskButton id={t.id} title={t.title} />}
                  </li>
                ))}
              </ul>
            )}
            {g.canAddTask && o.status === "ACTIVE" && <AddTaskForm objectiveId={o.id} keyResults={g.keyResults.map((k) => ({ id: k.id, title: k.title }))} people={peopleForWork} selfId={ctx.membershipId} canAssign={g.canManage} />}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Goals below this one" description="Departments, teams and people contributing to it." action={o.status === "ACTIVE" && o.level !== "INDIVIDUAL" ? <NewGoalButton variant="secondary" label="Add" options={options} parents={parents.concat([{ id: o.id, title: o.title, level: o.level }])} period={period} defaultParentId={o.id} defaultLevel={options.levels.includes(nextLevel[o.level]) ? nextLevel[o.level] : undefined} /> : undefined} />
            {g.children.length === 0 ? <EmptyState icon={<Flag className="h-5 w-5" />} title="Nothing below yet" description="Goals that support this one will appear here, with their progress." /> : (
              <ul className="divide-y divide-border">
                {g.children.map((c) => (
                  <li key={c.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2"><Link href={`/goals/${c.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{c.title}</Link><LevelBadge level={c.level} /></div>
                    <div className="text-xs text-muted">{c.ownerName}</div>
                    <Progress label={`${c.title} progress`} value={c.progress ?? 0} showValue />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent work" description="Daily updates that were tagged to this goal." />
            {g.recentWork.length === 0 ? <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No work tagged yet" description="When people tag their daily updates with this goal, it shows up here." /> : (
              <ul className="divide-y divide-border">
                {g.recentWork.map((w) => (
                  <li key={w.updateId} className="p-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted"><span className="font-medium text-foreground">{w.employeeName}{w.isOwn ? " (you)" : ""}</span><span>{formatDay(w.date, { day: "numeric", month: "short" })}</span></div>
                    <Link href={w.isOwn ? `/my-updates/${w.updateId}` : `/team-updates/${w.updateId}`} className="mt-1 line-clamp-2 text-sm text-muted hover:text-primary hover:underline">{w.preview || "View update"}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <InfoNotice>Progress is each owner&apos;s own reading and hasn&apos;t been independently verified. Every change is recorded.</InfoNotice>
        </div>
      </div>
    </>
  );
}
