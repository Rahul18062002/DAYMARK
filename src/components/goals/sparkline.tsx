/** Tiny trend line of check-in values, oldest to newest. Decorative: the numbers are always shown next to it. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 96, h = 28, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - min) / span) * (h - 6)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className={className ?? "h-7 w-24"} fill="none">
      <polyline points={pts.join(" ")} stroke="var(--chart-1)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--chart-1)" />
    </svg>
  );
}
