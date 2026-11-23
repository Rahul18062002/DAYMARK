import { cn } from "@/lib/utils";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
const hue = (seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/** Initials on a soft, deterministic colour: the same person always gets the same colour. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const h = hue(name);
  const dims = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-12 w-12 text-base" : "h-9 w-9 text-xs";
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", dims, className)}
      style={{ background: `oklch(0.93 0.045 ${h})`, color: `oklch(0.38 0.1 ${h})` }}>
      {initials(name)}
    </span>
  );
}
