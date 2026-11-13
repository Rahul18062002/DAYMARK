import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Network, UserCheck, UserPlus, Users } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { adminOverview, managerOverview } from "@/server/services/overview";
import { getMember } from "@/server/services/members";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { describeActivity, timeAgo } from "@/lib/activity";

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
  const o = await adminOverview(ctx);
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
  const o = await managerOverview(ctx);
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description="Your team overview." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Team members" icon={<Users className="h-4 w-4" />} value={o.people.length} />
        <Stat label="Teams in your scope" icon={<Network className="h-4 w-4" />} value={o.teams.length} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Your people" description="Only people on teams you manage, were granted, or who report to you." action={<Button asChild variant="secondary" size="sm"><Link href="/employees">View all</Link></Button>} />
        {o.people.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No team members yet" description="Once your admin assigns people to your teams, they'll appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {o.people.slice(0, 8).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.jobTitle ?? p.email}</div></div>
                <Badge>{p.teamName ?? "No team"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

async function EmployeeDashboard({ first }: { first: string }) {
  const ctx = await requirePageContext();
  const me = await getMember(ctx, ctx.membershipId);
  const org = await prisma.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true } });
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description={`You're part of ${org?.name}.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your profile" />
          <dl className="divide-y divide-border text-sm">
            {[["Team", me.teamName], ["Department", me.departmentName], ["Manager", me.managerName], ["Role", me.jobTitle]].map(([k, v]) => (
              <div key={k} className="flex justify-between px-5 py-3"><dt className="text-muted">{k}</dt><dd className="font-medium">{v ?? "—"}</dd></div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Daily updates" />
          <EmptyState icon={<UserCheck className="h-5 w-5" />} title="Daily updates are coming soon" description="Your daily update form and history will appear here." />
        </Card>
      </div>
    </>
  );
}
