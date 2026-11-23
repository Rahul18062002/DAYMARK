import { cn } from "@/lib/utils";

/** A number with a thin bar under it. `value` is 0–100 or null (not enough data yet). */
export function MetricBar({ value, label, suffix = "%", tone }: { value: number | null; label: string; suffix?: string; tone?: "primary" | "success" | "warning" | "danger" }) {
  if (value === null) return <span className="text-xs text-muted" title="Not enough data yet">—</span>;
  const t = tone ?? (value >= 85 ? "success" : value >= 60 ? "primary" : "warning");
  const bar = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[t];
  return (
    <div className="min-w-24">
      <div className="tabular text-sm font-medium">{Math.round(value)}{suffix}</div>
      <div role="img" aria-label={`${label}: ${Math.round(value)}${suffix}`} className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"><div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
    </div>
  );
}

/** Weekly bars, oldest to newest. A week with nothing expected is a faint stub. */
export function WeeklyBars({ weeks, label }: { weeks: { weekStart: string; rate: number | null }[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex h-24 items-end gap-1.5">
      {weeks.map((w) => (
        <div key={w.weekStart} className="group relative flex h-full flex-1 flex-col justify-end" title={`Week of ${w.weekStart}: ${w.rate === null ? "n/a" : `${Math.round(w.rate)}%`}`}>
          <div className={cn("w-full rounded-t-md", w.rate === null ? "h-1 bg-surface-muted" : w.rate >= 85 ? "bg-success" : w.rate >= 60 ? "bg-primary" : "bg-warning")} style={w.rate === null ? undefined : { height: `${Math.max(4, w.rate)}%` }} />
        </div>
      ))}
    </div>
  );
}
