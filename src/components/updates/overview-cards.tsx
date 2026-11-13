import { AlertTriangle, CalendarCheck, Clock, Users, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

type Overview = { totalMembers: number; submitted: number; pending: number; withBlockers: number; isWorkingDay: boolean; weekly: { updates: number; contributors: number } };

function Stat({ id, label, value, hint, icon, tone }: { id: string; label: string; value: number; hint?: string; icon: React.ReactNode; tone?: "danger" | "warning" }) {
  return (
    <Card className="p-4" data-testid={`stat-${id}`}>
      <div className="flex items-center justify-between text-sm text-muted">{label}<span className={tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-primary"}>{icon}</span></div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
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
