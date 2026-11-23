import Link from "next/link";
import { ChevronRight, ListChecks, Target } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { HealthBadge, LevelBadge, StatusBadge } from "./badges";
import { formatDay } from "@/lib/dates";
import type { ObjectiveSummary } from "@/server/services/goals";

type Node = ObjectiveSummary & { children: Node[] };

export function buildGoalTree(items: ObjectiveSummary[]): Node[] {
  const byId = new Map<string, Node>(items.map((i) => [i.id, { ...i, children: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p && p !== n) p.children.push(n); else roots.push(n);
  }
  const order = (a: Node, b: Node) => (a.status === "CANCELLED" ? 1 : 0) - (b.status === "CANCELLED" ? 1 : 0) || a.title.localeCompare(b.title);
  const sort = (ns: Node[]) => { ns.sort(order); ns.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}

function Row({ n }: { n: Node }) {
  const dim = n.status === "CANCELLED";
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-4 ${dim ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/goals/${n.id}`} className="truncate text-sm font-semibold hover:text-primary hover:underline">{n.title}</Link>
          <LevelBadge level={n.level} /><StatusBadge status={n.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><Avatar name={n.ownerName} size="sm" className="!h-5 !w-5 !text-[9px]" />{n.ownerName}</span>
          {(n.teamName || n.departmentName) && <span>{n.teamName ?? n.departmentName}</span>}
          <span>{formatDay(n.periodStart, { day: "numeric", month: "short" })} – {formatDay(n.periodEnd, { day: "numeric", month: "short" })}</span>
          {n.keyResultCount > 0 && <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" aria-hidden />{n.keyResultCount} key result{n.keyResultCount === 1 ? "" : "s"}</span>}
          {n.taskTotal > 0 && <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" aria-hidden />{n.taskDone}/{n.taskTotal} tasks</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:w-72">
        <Progress className="flex-1" label={`${n.title} progress`} value={n.progress ?? 0} showValue tone={n.progress === null ? "primary" : undefined} />
        <span className="flex w-28 shrink-0 justify-end"><HealthBadge health={n.health} progress={n.progress} /></span>
      </div>
    </div>
  );
}

function Branch({ n, depth }: { n: Node; depth: number }) {
  if (n.children.length === 0) return <li className="pl-6"><Row n={n} /></li>;
  return (
    <li>
      <details open={depth < 2} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-1 rounded-lg pr-2 hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="mt-4 h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
          <Row n={n} />
        </summary>
        <ul className="ml-3 border-l border-border pl-4">{n.children.map((c) => <Branch key={c.id} n={c} depth={depth + 1} />)}</ul>
      </details>
    </li>
  );
}

export function GoalTree({ items }: { items: ObjectiveSummary[] }) {
  const roots = buildGoalTree(items);
  return <ul aria-label="Goals" className="space-y-1">{roots.map((r) => <Branch key={r.id} n={r} depth={0} />)}</ul>;
}
