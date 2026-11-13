import { ExternalLink, History } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BlockerBadge, LateBadge, UpdateStatusBadge } from "./badges";
import { formatDay, formatInstant } from "@/lib/dates";
import type { UpdateDetail } from "@/server/services/updates";

const SECTIONS = [
  ["WORKED_ON", "What I worked on"],
  ["COMPLETED", "Completed"],
  ["PENDING", "Still pending"],
  ["BLOCKER", "Challenges & blockers"],
  ["NEXT_PRIORITY", "Priorities for tomorrow"],
] as const;

type Sections = UpdateDetail["sections"];

// Links were validated as http(s) on the way in; re-checked here so a bad row can never become a clickable script URL.
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : null);

function SectionList({ sections }: { sections: Sections }) {
  const filled = SECTIONS.filter(([k]) => sections[k].length > 0);
  if (filled.length === 0) return <p className="text-sm text-muted">No content.</p>;
  return (
    <div className="space-y-5">
      {filled.map(([key, title]) => (
        <section key={key} aria-labelledby={`sec-${key}`}>
          <h3 id={`sec-${key}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
          <ul className="space-y-1.5">
            {sections[key].map((t, i) => (
              <li key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed">{t}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function UpdateView({ update, timezone, showEmployee }: { update: UpdateDetail; timezone: string; showEmployee?: boolean }) {
  const { revisions } = update;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {showEmployee && <div className="text-base font-semibold">{update.employee.name}</div>}
            <h2 className={showEmployee ? "text-sm text-muted" : "text-base font-semibold"}>{formatDay(update.updateDate)}</h2>
            {showEmployee && (update.employee.teamName || update.employee.departmentName) && (
              <div className="mt-0.5 text-xs text-muted">{[update.employee.teamName, update.employee.departmentName].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UpdateStatusBadge status={update.status} />
            {update.submittedLate && <LateBadge />}
            {update.hasBlockers && <BlockerBadge has />}
          </div>
        </div>
        <CardBody className="space-y-6" data-testid="current-update">
          <SectionList sections={update.sections} />
          {update.links.length > 0 && (
            <section aria-labelledby="sec-links">
              <h3 id="sec-links" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Supporting links</h3>
              <ul className="space-y-1">
                {update.links.map((l, i) => {
                  const href = safeHref(l.url);
                  return (
                    <li key={i} className="text-sm">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-primary hover:underline">
                          {l.label || l.url}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                        </a>
                      ) : <span className="break-all text-muted">{l.label || l.url}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </CardBody>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border bg-surface-muted/50 px-5 py-3 text-xs text-muted">
          {update.firstSubmittedAt && <span>Submitted {formatInstant(update.firstSubmittedAt, timezone)}</span>}
          {update.lastEditedAt && <span>Last edited {formatInstant(update.lastEditedAt, timezone)}</span>}
          <span>Via {update.source.toLowerCase().replace("_", " ")}</span>
        </div>
      </Card>

      {revisions.length > 1 && (
        <Card>
          <CardHeader title="Version history" description="Every submission and edit is kept. The original submission is never overwritten." />
          <ul className="divide-y divide-border">
            {[...revisions].reverse().map((r) => (
              <li key={r.revisionNumber}>
                <details className="group px-5 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2"><History className="h-4 w-4 text-muted" aria-hidden />
                      <span className="font-medium">Version {r.revisionNumber}</span>
                      <span className="text-muted">· {r.kind === "SUBMITTED" ? "Original submission" : "Edited"}</span>
                    </span>
                    <time className="text-xs text-muted" dateTime={r.createdAt}>{formatInstant(r.createdAt, timezone)}</time>
                  </summary>
                  <div className="mt-4 border-l-2 border-border pl-4">
                    <SectionList sections={r.snapshot.sections} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
