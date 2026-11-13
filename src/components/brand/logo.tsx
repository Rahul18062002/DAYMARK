import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/** Daymark mark: a day rising over a horizon line. Colors come from theme tokens, so it works in light and dark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} role="img" aria-label={BRAND.name}>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M7 21a9 9 0 0 1 18 0z" fill="var(--primary-foreground)" />
      <rect x="5" y="23.5" width="22" height="2.4" rx="1.2" fill="var(--primary-foreground)" opacity=".9" />
    </svg>
  );
}

export function Logo({ className, showTagline }: { className?: string; showTagline?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-lg font-semibold tracking-tight">{BRAND.name}</div>
        {showTagline && <div className="text-xs text-muted">{BRAND.tagline}</div>}
      </div>
    </div>
  );
}
