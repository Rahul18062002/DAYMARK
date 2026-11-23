import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Network } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { orgTree, type OrgNode } from "@/server/services/org-tree";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, InfoNotice, PageHeader } from "@/components/ui/states";

export const metadata: Metadata = { title: "Org chart" };

const roleTone = { ADMIN: "primary", MANAGER: "warning", EMPLOYEE: "neutral" } as const;
const roleLabel = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;

function NodeRow({ n }: { n: OrgNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 py-2">
      <Avatar name={n.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link href={`/people/${n.id}`} className="truncate text-sm font-semibold hover:text-primary hover:underline">{n.name}{n.isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</Link>
          <Badge tone={roleTone[n.role]}>{roleLabel[n.role]}</Badge>
          {n.level !== null && <Badge>Level {n.level}</Badge>}
        </div>
        <div className="truncate text-xs text-muted">
          {[n.jobTitle, n.teamName, n.departmentName].filter(Boolean).join(" · ") || "No title or team"}
          {n.mentorName && <> · Mentor: {n.mentorName}</>}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-3 text-xs text-muted sm:flex">
        {n.submittedToday !== null && <Badge tone={n.submittedToday ? "success" : "neutral"}>{n.submittedToday ? "Updated today" : "No update yet"}</Badge>}
        {n.reportCount > 0 && <span className="tabular">{n.reportCount} {n.reportCount === 1 ? "person" : "people"} below</span>}
      </div>
    </div>
  );
}

function Branch({ n, depth }: { n: OrgNode; depth: number }) {
  if (n.children.length === 0) return <li className="pl-7"><NodeRow n={n} /></li>;
  return (
    <li>
      <details open={depth < 2} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg pr-2 hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
          <NodeRow n={n} />
        </summary>
        <ul className="ml-3 border-l border-border pl-4">
          {n.children.map((c) => <Branch key={c.id} n={c} depth={depth + 1} />)}
        </ul>
      </details>
    </li>
  );
}

export default async function OrgChartPage() {
  const ctx = await requirePageContext();
  const t = await orgTree(ctx);
  return (
    <>
      <PageHeader title="Org chart" description="Who reports to whom, from the top of the company down." action={<Link href="/employees" className="text-sm font-medium text-primary hover:underline">{ctx.role === "ADMIN" ? "Manage people" : ""}</Link>} />
      {t.restricted && <InfoNotice className="mb-4">You see your own reporting chain and the people your company&apos;s visibility setting lets you see.</InfoNotice>}
      <Card className="p-3 sm:p-4">
        {t.roots.length === 0 ? (
          <EmptyState icon={<Network className="h-5 w-5" />} title="Nobody to show yet" description="Assign managers on the Employees page to build the reporting tree." />
        ) : (
          <ul aria-label="Reporting tree" className="space-y-1">{t.roots.map((r) => <Branch key={r.id} n={r} depth={0} />)}</ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">{t.total} {t.total === 1 ? "person" : "people"} shown.</p>
    </>
  );
}
