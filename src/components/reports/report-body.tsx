import { AlertTriangle, EyeOff, Sparkles, Target, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ReportDto } from "@/server/services/summaries";

export const KIND_LABEL = { DAILY_UPDATE: "Daily", PERSON_WEEK: "Person", TEAM_WEEK: "Team", DEPARTMENT_WEEK: "Department", COMPANY_WEEK: "Company" } as const;

export function ReportStatusBadge({ status }: { status: ReportDto["status"] }) {
  return status === "PUBLISHED" ? <Badge tone="success">Published</Badge> : status === "REJECTED" ? <Badge tone="danger">Rejected</Badge> : <Badge tone="warning">Draft · needs review</Badge>;
}

function List({ title, icon, items, tone }: { title: string; icon: React.ReactNode; items: string[]; tone?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone ?? "text-muted"}`}>{icon}{title}</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted">{items.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul>
    </section>
  );
}

/** The report as people read it. Plain text only, never markup, and always labelled as AI-generated and unverified. */
export function ReportBody({ r, compact }: { r: Pick<ReportDto, "content" | "blockersHidden" | "provider" | "model" | "sourceCount" | "kind" | "editedAt">; compact?: boolean }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className={compact ? "text-sm font-semibold" : "text-lg font-semibold tracking-tight"}>{r.content.headline}</h2>
        <p className="mt-1.5 whitespace-pre-line text-sm text-foreground/90">{r.content.summary}</p>
      </div>
      {!compact && (
        <>
          <List title="Highlights" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />} items={r.content.highlights} />
          <List title="Goals" icon={<Target className="h-3.5 w-3.5" aria-hidden />} items={r.content.goals} />
          <List title="Risks to goals" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />} items={r.content.risks} tone="text-warning" />
          <List title="Blockers reported" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />} items={r.content.blockers} tone="text-danger" />
          {r.blockersHidden && <p className="flex items-center gap-1.5 text-xs text-muted"><EyeOff className="h-3.5 w-3.5" aria-hidden />Blockers are only shown to the people involved and their managers.</p>}
        </>
      )}
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted"><Sparkles className="h-3.5 w-3.5" aria-hidden />AI-generated from {r.sourceCount} self-reported update{r.sourceCount === 1 ? "" : "s"}{r.kind !== "DAILY_UPDATE" ? " and goal data" : ""} ({r.provider} · {r.model}){r.editedAt ? ", then edited by a reviewer" : ""}. Not independently verified.</p>
    </div>
  );
}
