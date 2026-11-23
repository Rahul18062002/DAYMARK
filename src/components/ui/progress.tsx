import { cn } from "@/lib/utils";

/** Accessible progress bar. `value` is 0–100; colour follows `tone` or, by default, how far along it is. */
export function Progress({ value, label, tone, className, showValue }: { value: number; label: string; tone?: "primary" | "success" | "warning" | "danger"; className?: string; showValue?: boolean }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const t = tone ?? (v >= 100 ? "success" : v >= 40 ? "primary" : "warning");
  const bar = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[t];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${v}%` }} />
      </div>
      {showValue && <span className="tabular w-10 shrink-0 text-right text-xs font-medium text-muted">{Math.round(v)}%</span>}
    </div>
  );
}
