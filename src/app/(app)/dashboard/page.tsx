import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, ClipboardCheck, Network, PenLine, Sparkles, UserCheck, UserPlus, Users } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { adminOverview } from "@/server/services/overview";
import { getTodayStatus, getWeekOverview, listOwnUpdates } from "@/server/services/updates";
import { listTeamUpdates, teamHighlights, teamOverview, teamTrend } from "@/server/services/team-updates";
import { getMember } from "@/server/services/members";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { describeActivity, timeAgo } from "@/lib/activity";
import { OverviewCards } from "@/components/updates/overview-cards";
import { TrendChart } from "@/components/updates/trend-chart";
import { Highlights } from "@/components/updates/highlights";
import { WeekStrip } from "@/components/updates/week-strip";
import { BlockerBadge, UpdateStatusBadge } from "@/components/updates/badges";
import { formatDay } from "@/lib/dates";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, icon, hint }: { label: string; value: number | string; icon: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-sm text-muted">{label}<span className="text-primary">{icon}</span></div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export default async function DashboardPage() {
  const ctx = await requirePageContext();
  const first = ctx.userName.split(" ")[0];
  if (ctx.role === "ADMIN") return <AdminDashboard first={first} />;
  if (ctx.role === "MANAGER") return <ManagerDashboard first={first} />;
  return <EmployeeDashboard first={first} />;
}

async function AdminDashboard({ first }: { first: string }) {
  const ctx = await requirePageContext();
  const [o, upd, trend] = await Promise.all([adminOverview(ctx), teamOverview(ctx), teamTrend(ctx)]);
  const needsSetup = o.departments === 0 || o.teams === 0 || o.activePeople <= 1;
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description="Here's your organization at a glance." action={<Button asChild><Link href="/employees?invite=1"><UserPlus className="h-4 w-4" /> Invite people</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active people" icon={<Users className="h-4 w-4" />} value={o.activePeople} hint={`${o.admins} admin · ${o.managers} managers · ${o.employees} employees`} />
        <Stat label="Departments" icon={<Building2 className="h-4 w-4" />} value={o.departments} />
        <Stat label="Teams" icon={<Network className="h-4 w-4" />} value={o.teams} />
        <Stat label="Pending invitations" icon={<UserCheck className="h-4 w-4" />} value={o.pendingInvites} />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Update submissions today</h2>
      <OverviewCards o={upd} />
      <Card className="mt-4">
        <CardHeader title="Submissions" description="Submitted vs. expected over the last two weeks" action={<Button asChild variant="secondary" size="sm"><Link href="/team-updates">All updates</Link></Button>} />
        <div className="p-4"><TrendChart data={trend} /></div>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Organization activity" description="Recent changes in your workspace." />
          {o.activity.length === 0 ? <EmptyState title="No activity yet" /> : (
            <ul className="divide-y divide-border">
              {o.activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                  <span><span className="font-medium">{a.actor}</span> <span className="text-muted">{describeActivity(a.action, a.metadata)}</span></span>
                  <time className="shrink-0 text-xs text-muted" dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {needsSetup && (
          <Card className="lg:col-span-2">
            <CardHeader title="Get set up" description="A few steps to get your team ready." />
            <CardBody className="space-y-3 text-sm">
              <Step done={o.departments > 0} label="Create a department" href="/settings?tab=structure" />
              <Step done={o.teams > 0} label="Create a team" href="/settings?tab=structure" />
              <Step done={o.activePeople > 1} label="Invite your first employee" href="/employees?invite=1" />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function Step({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-muted">
      <span className="flex items-center gap-2.5">
        <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? "bg-success text-white" : "border border-border"}`}>{done ? "✓" : ""}</span>
        <span className={done ? "text-muted line-through" : "font-medium"}>{label}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
    </Link>
  );
}

async function ManagerDashboard({ first }: { first: string }) {
  const ctx = await requirePageContext();
  const [o, trend, highlights, missing] = await Promise.all([
    teamOverview(ctx), teamTrend(ctx), teamHighlights(ctx, { limit: 5 }), listTeamUpdates(ctx, { status: "missing" }),
  ]);
  const notSubmitted = missing.rows.filter((r) => r.date === o.today);
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description="Your team at a glance." action={<Button asChild><Link href="/team-updates">Team updates <ArrowRight className="h-4 w-4" /></Link></Button>} />
      <OverviewCards o={o} />
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Submissions" description="Submitted vs. expected over the last two weeks" />
          <div className="p-4"><TrendChart data={trend} /></div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Not submitted today" description={o.isWorkingDay ? "Still to submit" : "Today isn't a working day"} />
          {notSubmitted.length === 0 ? (
            <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title={o.totalMembers === 0 ? "No team members yet" : o.isWorkingDay ? "Everyone has submitted" : "Nothing due"} description={o.totalMembers === 0 ? "Once your admin assigns people to your teams, they'll appear here." : undefined} />
          ) : (
            <ul className="divide-y divide-border">
              {notSubmitted.slice(0, 8).map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div><div className="font-medium">{r.employeeName}</div><div className="text-xs text-muted">{r.teamName ?? "No team"}</div></div>
                  <UpdateStatusBadge status="MISSING" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-6"><Highlights h={highlights} /></div>
    </>
  );
}

async function EmployeeDashboard({ first }: { first: string }) {
  const ctx = await requirePageContext();
  const [today, week, recent, me] = await Promise.all([getTodayStatus(ctx), getWeekOverview(ctx), listOwnUpdates(ctx, 5), getMember(ctx, ctx.membershipId)]);
  const t = today.update;
  const cta = !t
    ? { label: "Submit Daily Update", href: "/my-updates/new", text: "You haven't submitted today's update yet.", tone: "primary" as const }
    : t.status === "DRAFT"
      ? { label: "Continue draft", href: `/my-updates/${t.id}/edit`, text: "You have a draft for today.", tone: "primary" as const }
      : { label: "View today's update", href: `/my-updates/${t.id}`, text: "Today's update is in. Thank you!", tone: "secondary" as const };
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description={formatDay(today.today, { weekday: "long", day: "numeric", month: "long" })}
        action={<Button asChild variant={cta.tone}><Link href={cta.href}><PenLine className="h-4 w-4" /> {cta.label}</Link></Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Today" />
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2">{t ? <UpdateStatusBadge status={t.status} /> : <UpdateStatusBadge status="MISSING" />}<span className="text-sm">{cta.text}</span></div>
            {!today.isWorkingDay && <p className="text-xs text-muted">Today isn&apos;t a working day for your organization — an update is optional.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="This week" description={`${week.submitted} of ${week.expected} expected updates submitted`} />
          <CardBody><WeekStrip days={week.days} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent updates" action={<Button asChild variant="ghost" size="sm"><Link href="/my-updates">View all</Link></Button>} />
          {recent.length === 0 ? <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No updates yet" description="Submit your first update to start your history." /> : (
            <ul className="divide-y divide-border">
              {recent.map((u) => (
                <li key={u.id}>
                  <Link href={u.status === "DRAFT" ? `/my-updates/${u.id}/edit` : `/my-updates/${u.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-surface-muted/50">
                    <div className="min-w-0"><div className="text-sm font-medium">{formatDay(u.updateDate, { weekday: "short", day: "numeric", month: "short" })}</div><p className="line-clamp-1 text-xs text-muted">{u.preview}</p></div>
                    <div className="flex shrink-0 items-center gap-1.5"><UpdateStatusBadge status={u.status} />{u.hasBlockers && <BlockerBadge has />}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Latest summary" />
          <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No summary yet" description="When AI summaries are enabled for your organization, the latest one will appear here." />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Your profile" />
          <dl className="grid divide-y divide-border text-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {[["Team", me.teamName], ["Department", me.departmentName], ["Manager", me.managerName], ["Role", me.jobTitle]].map(([k, v]) => (
              <div key={k} className="flex justify-between px-5 py-3 sm:block"><dt className="text-muted">{k}</dt><dd className="font-medium sm:mt-0.5">{v ?? "—"}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
