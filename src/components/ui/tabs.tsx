import Link from "next/link";
import { cn } from "@/lib/utils";

/** Link-based tabs (the selected tab lives in the URL, so it survives reloads and can be shared). */
export function LinkTabs({ items, current, label }: { items: { href: string; label: string; id: string }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors", t.id === current ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
