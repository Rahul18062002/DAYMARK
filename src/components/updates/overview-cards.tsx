import { AlertTriangle, CalendarCheck, Clock, Users, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

type Overview = { totalMembers: number; submitted: number; pending: number; withBlockers: number; isWorkingDay: boolean; weekly: { updates: number; contributors: number } };

function Stat({ id, label, value, hint, icon, tone }: { id: string; label: string; value: number; hint?: string; icon: React.ReactNode; tone?: "danger" | "warning" }) {
  const chip = tone === "danger" ? "bg-danger-soft text-danger" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary";
  return (
    <Card className="p-4 transition-shadow hover:shadow-[var(--shadow-pop)]" data-testid={`stat-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-muted">{label}</div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
      </div>
      <div className="tabular mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function OverviewCards({ o }: { o: Overview }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat id="members" label="Team members" value={o.totalMembers} icon={<Users className="h-4 w-4" />} />
      <Stat id="submitted" label="Submitted today" value={o.submitted} icon={<CalendarCheck className="h-4 w-4" />} hint={o.isWorkingDay ? undefined : "Not a working day"} />
      <Stat id="pending" label="Pending today" value={o.pending} icon={<Clock className="h-4 w-4" />} tone={o.pending > 0 ? "warning" : undefined} hint={o.isWorkingDay ? undefined : "Not a working day"} />
      <Stat id="blockers" label="Reporting blockers" value={o.withBlockers} icon={<AlertTriangle className="h-4 w-4" />} tone={o.withBlockers > 0 ? "danger" : undefined} />
      <Stat id="week" label="This week" value={o.weekly.updates} icon={<Activity className="h-4 w-4" />} hint={`updates from ${o.weekly.contributors} ${o.weekly.contributors === 1 ? "person" : "people"}`} />
    </div>
  );
}
