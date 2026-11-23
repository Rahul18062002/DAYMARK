import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { can, canOpenTeamView } from "@/server/policy";
import { prisma } from "@/server/db";
import { filterOptions, listTeamUpdates, teamHighlights, teamOverview, teamTrend, type TeamRow } from "@/server/services/team-updates";
import { AppError } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorNotice, InfoNotice, PageHeader } from "@/components/ui/states";
import { BlockerBadge, LateBadge, UpdateStatusBadge } from "@/components/updates/badges";
import { OverviewCards } from "@/components/updates/overview-cards";
import { Highlights } from "@/components/updates/highlights";
import { TrendChart } from "@/components/updates/trend-chart";
import { formatDay } from "@/lib/dates";

export const metadata: Metadata = { title: "Team Updates" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function RowLink({ r, children }: { r: TeamRow; children: React.ReactNode }) {
  return r.updateId ? <Link href={`/team-updates/${r.updateId}`} className="font-medium text-primary hover:underline">{children}</Link> : <span className="font-medium">{children}</span>;
}

export default async function TeamUpdatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  if (!can(ctx, "update:team") || !(await canOpenTeamView(prisma, ctx))) redirect("/dashboard");
  const sp = await searchParams;
  const filters = Object.fromEntries(
    (["from", "to", "departmentId", "teamId", "membershipId", "status", "blockers", "page"] as const).flatMap((k) => (one(sp[k]) ? [[k, one(sp[k])!]] : [])),
  );

  let list: Awaited<ReturnType<typeof listTeamUpdates>> | null = null;
  let error: string | null = null;
  try { list = await listTeamUpdates(ctx, filters); }
  catch (e) { if (e instanceof AppError || (e as { name?: string }).name === "ZodError") error = e instanceof AppError ? e.message : "Check the filters and try again."; else throw e; }

  const [overview, trend, highlights, options] = await Promise.all([teamOverview(ctx), teamTrend(ctx), teamHighlights(ctx), filterOptions(ctx)]);
  const rows = list?.rows ?? [];
  const filtered = Object.keys(filters).filter((k) => k !== "page").length > 0;
  const pageHref = (n: number) => `/team-updates?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([k]) => k !== "page")), page: String(n) }).toString()}`;

  return (
    <>
      <PageHeader title={ctx.role === "EMPLOYEE" ? "Colleagues" : "Team Updates"} description={ctx.role === "ADMIN" ? "Updates across your whole organization." : ctx.role === "MANAGER" ? "Updates from your reporting line and the teams you manage." : "What your colleagues are working on. This is read-only."} />
      <OverviewCards o={overview} />

      <Card className="mt-6">
        <CardHeader title="Submissions" description="Submitted vs. expected over the last two weeks" />
        <div className="p-4"><TrendChart data={trend} /></div>
      </Card>

      <Card className="mt-6">
        <form key={JSON.stringify(filters)} method="get" className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter updates">
          <Field label="From" htmlFor="f-from"><Input id="f-from" name="from" type="date" defaultValue={list?.from ?? filters.from} /></Field>
          <Field label="To" htmlFor="f-to"><Input id="f-to" name="to" type="date" defaultValue={list?.to ?? filters.to} /></Field>
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option><option value="submitted">Submitted</option><option value="edited">Edited</option>{overview.canSeeMissing && <option value="missing">Not submitted</option>}
            </Select>
          </Field>
          <Field label="Employee" htmlFor="f-emp">
            <Select id="f-emp" name="membershipId" defaultValue={filters.membershipId ?? ""}>
              <option value="">Everyone</option>{options.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Department" htmlFor="f-dept">
            <Select id="f-dept" name="departmentId" defaultValue={filters.departmentId ?? ""}>
              <option value="">All departments</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Team" htmlFor="f-team">
            <Select id="f-team" name="teamId" defaultValue={filters.teamId ?? ""}>
              <option value="">All teams</option>{options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-end gap-2 pb-2.5 text-sm"><input type="checkbox" name="blockers" value="1" defaultChecked={filters.blockers === "1"} /> Only with blockers</label>
          <div className="flex items-end gap-2">
            <Button type="submit">Apply filters</Button>
            {filtered && <Button asChild variant="ghost"><Link href="/team-updates">Reset</Link></Button>}
          </div>
        </form>

        {error && <div className="p-4"><ErrorNotice>{error}</ErrorNotice></div>}
        {list && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted" aria-live="polite">
              <span>{list.total} {list.total === 1 ? "result" : "results"}{list.totalPages > 1 ? ` · page ${list.page} of ${list.totalPages}` : ""} · {list.from === list.to ? formatDay(list.from) : `${formatDay(list.from, { day: "numeric", month: "short" })} – ${formatDay(list.to, { day: "numeric", month: "short" })}`}</span>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="Nothing to show" description={filtered ? "No updates match these filters. Try widening the dates or clearing a filter." : "Updates from your team will appear here once they're submitted."} />
            ) : (
              <>
                {/* Desktop table */}
                <div className="relative hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm" data-testid="updates-table">
                    <thead className="border-y border-border text-xs uppercase tracking-wide text-muted">
                      <tr><th className="px-5 py-3 font-medium">Employee</th><th className="px-3 py-3 font-medium">Team</th><th className="px-3 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Update</th><th className="px-3 py-3 font-medium">Blockers</th><th className="px-3 py-3 font-medium">Last updated</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.key} className="align-top hover:bg-surface-muted/50">
                          <td className="px-5 py-3"><RowLink r={r}>{r.employeeName}</RowLink></td>
                          <td className="px-3 py-3 text-muted">{r.teamName ?? "—"}{r.departmentName && <div className="text-xs">{r.departmentName}</div>}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatDay(r.date, { day: "numeric", month: "short" })}</td>
                          <td className="px-3 py-3"><div className="flex flex-wrap gap-1"><UpdateStatusBadge status={r.status} />{r.submittedLate && <LateBadge />}</div></td>
                          <td className="max-w-xs px-3 py-3"><p className="line-clamp-2 break-words text-muted">{r.preview || "—"}</p></td>
                          <td className="px-3 py-3">{r.status === "MISSING" ? <span className="text-xs text-muted">—</span> : <BlockerBadge has={r.hasBlockers} />}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <ul className="divide-y divide-border border-t border-border md:hidden">
                  {rows.map((r) => (
                    <li key={r.key} className="space-y-1.5 px-5 py-4">
                      <div className="flex items-start justify-between gap-2"><RowLink r={r}>{r.employeeName}</RowLink><span className="text-xs text-muted">{formatDay(r.date, { day: "numeric", month: "short" })}</span></div>
                      <div className="text-xs text-muted">{[r.teamName, r.departmentName].filter(Boolean).join(" · ") || "No team"}</div>
                      <div className="flex flex-wrap items-center gap-1.5"><UpdateStatusBadge status={r.status} />{r.submittedLate && <LateBadge />}{r.hasBlockers && <BlockerBadge has />}</div>
                      {r.preview && <p className="line-clamp-2 break-words text-sm text-muted">{r.preview}</p>}
                    </li>
                  ))}
                </ul>
                {list.totalPages > 1 && (
                  <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
                    {list.page > 1 ? <Link href={pageHref(list.page - 1)} className="font-medium text-primary hover:underline">← Previous</Link> : <span className="text-muted">← Previous</span>}
                    <span className="tabular text-xs text-muted">Page {list.page} of {list.totalPages}</span>
                    {list.page < list.totalPages ? <Link href={pageHref(list.page + 1)} className="font-medium text-primary hover:underline">Next →</Link> : <span className="text-muted">Next →</span>}
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </Card>

      <div className="mt-6"><Highlights h={highlights} /></div>
      <InfoNotice className="mt-6">Everything above is what people reported themselves. It hasn&apos;t been independently verified.</InfoNotice>
    </>
  );
}
