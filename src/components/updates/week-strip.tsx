import { cn } from "@/lib/utils";
import type { WeekDayStatus } from "@/server/services/updates";
import { formatDay } from "@/lib/dates";

const STYLE: Record<WeekDayStatus | "TODAY", string> = {
  SUBMITTED: "bg-success-soft text-success border-success/30",
  EDITED: "bg-success-soft text-success border-success/30",
  DRAFT: "bg-warning-soft text-warning border-warning/30",
  MISSING: "bg-danger-soft text-danger border-danger/30",
  UPCOMING: "bg-surface text-muted border-border",
  OFF: "bg-surface-muted text-muted/60 border-transparent",
  TODAY: "bg-primary-soft text-primary border-primary/30",
};
const LABEL: Record<WeekDayStatus | "TODAY", string> = {
  SUBMITTED: "Submitted", EDITED: "Submitted (edited)", DRAFT: "Draft", MISSING: "Missed", UPCOMING: "Upcoming", OFF: "Not a working day", TODAY: "Due today",
};

export function WeekStrip({ days }: { days: { day: string; isToday: boolean; status: WeekDayStatus }[] }) {
  return (
    <ul className="grid grid-cols-7 gap-1.5 sm:gap-2" aria-label="This week">
      {days.map((d) => {
        const key = d.isToday && (d.status === "UPCOMING" || d.status === "MISSING") ? "TODAY" : d.status;
        return (
          <li key={d.day} className={cn("rounded-lg border px-1 py-2 text-center", STYLE[key], d.isToday && "ring-2 ring-primary/40")}>
            <div className="text-[11px] font-medium uppercase">{formatDay(d.day, { weekday: "short" })}</div>
            <div className="text-sm font-semibold">{formatDay(d.day, { day: "numeric" })}</div>
            <span className="sr-only">{`${formatDay(d.day)}: ${LABEL[key]}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
