import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { throttle } from "../throttle";
import { withJobLock } from "../job-lock";
import { appUrl } from "../env";
import { AiError, aiConfigured, getAiProvider, type AiProvider } from "../ai/provider";
import { RETRY_SUFFIX, SYSTEM_PROMPT, parseSummary, summaryContentSchema, type SummaryContent } from "../ai/prompts";
import { buildDailyInput, buildWeeklyInput, scopeKeyOf, weekOf, type WeekSubject } from "../ai/inputs";
import type { Actor } from "../policy";
import { viewerContext } from "./goals";
import { EVENT_CATALOG, enqueueEvent, eventKeys, runInBackground, type ReportPayload } from "../integrations/viasocket/events";
import { deliverPendingForEvent } from "../integrations/viasocket/dispatch";
import { isViaSocketConfigured } from "../integrations/viasocket/config";
import { localDay } from "@/lib/dates";

type A = Actor & { userId: string };
type Kind = "DAILY_UPDATE" | "PERSON_WEEK" | "TEAM_WEEK" | "DEPARTMENT_WEEK" | "COMPANY_WEEK";

// ───────────────────────── is AI allowed for this organization? ─────────────────────────

/** Needs the admin's recorded opt-in (employees' text goes to an outside AI provider) AND a provider key on the server. */
export async function aiAllowed(organizationId: string): Promise<boolean> {
  if (!aiConfigured()) return false;
  const s = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { aiEnabled: true, aiConsentAt: true } });
  return !!s?.aiEnabled && !!s.aiConsentAt;
}

// ───────────────────────── calling the model ─────────────────────────

async function ask(provider: AiProvider, user: string, maxTokens: number) {
  let tokensIn = 0, tokensOut = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await provider.complete({ system: SYSTEM_PROMPT, user: attempt === 0 ? user : user + RETRY_SUFFIX, maxTokens });
    tokensIn += r.inputTokens ?? 0; tokensOut += r.outputTokens ?? 0;
    try { return { content: parseSummary(r.text), provider: r.provider, model: r.model, inputTokens: tokensIn, outputTokens: tokensOut }; }
    catch (e) { if (!(e instanceof AiError && e.code === "BAD_OUTPUT") || attempt === 1) throw e; }
  }
  throw new AiError("BAD_OUTPUT", "The AI reply wasn't in the expected format.");
}

export type GenerateResult = { status: "created" | "updated" | "unchanged" | "skipped" | "busy"; id?: string };

/**
 * Create or refresh ONE weekly report. Idempotent and cheap to repeat:
 *  - nothing to report (no submitted updates) → skipped, no AI call
 *  - same input as last time → unchanged, no AI call
 *  - published, rejected or hand-edited reports are never overwritten unless `force` (an explicit "regenerate")
 *  - two generators for the same report at once → one runs, the other reports "busy"
 */
export async function generateWeekly(organizationId: string, subject: WeekSubject, week: { start: string; end: string }, opts: { now?: Date; force?: boolean; provider?: AiProvider } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getAiProvider();
  const scopeKey = scopeKeyOf(subject);
  const run = await withJobLock(`summary:${organizationId}:${scopeKey}:${week.start}`, 180_000, async (): Promise<GenerateResult> => {
    const built = await buildWeeklyInput(organizationId, subject, week, provider.model, now);
    if (!built) return { status: "skipped" };
    const existing = await prisma.aiSummary.findUnique({ where: { organizationId_kind_scopeKey_periodStart: { organizationId, kind: subject.kind, scopeKey, periodStart: week.start } } });
    if (existing && !opts.force && (existing.status !== "GENERATED" || existing.editedAt || existing.inputHash === built.inputHash)) return { status: "unchanged", id: existing.id };
    const out = await ask(provider, built.user, 1000);
    const data = {
      title: built.title, periodEnd: week.end, content: out.content as Prisma.InputJsonValue, provider: out.provider, model: out.model, inputHash: built.inputHash, sourceCount: built.sourceCount,
      inputTokens: out.inputTokens, outputTokens: out.outputTokens, status: "GENERATED" as const, reviewedById: null, reviewedAt: null, reviewNote: null, editedAt: null, generatedAt: now,
    };
    if (existing) { await prisma.aiSummary.update({ where: { id: existing.id }, data }); return { status: "updated", id: existing.id }; }
    const row = await prisma.aiSummary.create({
      data: {
        organizationId, kind: subject.kind, scopeKey, periodStart: week.start, ...data,
        subjectId: subject.kind === "PERSON_WEEK" ? subject.membershipId : null, teamId: subject.kind === "TEAM_WEEK" ? subject.teamId : null, departmentId: subject.kind === "DEPARTMENT_WEEK" ? subject.departmentId : null,
      },
      select: { id: true },
    });
    return { status: "created", id: row.id };
  }, () => now);
  return run.ran ? run.value : { status: "busy" };
}

/** A short summary of one submitted update. Shown with the update, labelled AI-generated; no review step (it only restates one person's own words). */
export async function generateDaily(organizationId: string, updateId: string, opts: { now?: Date; force?: boolean; provider?: AiProvider } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getAiProvider();
  const built = await buildDailyInput(organizationId, updateId, provider.model);
  if (!built) return { status: "skipped" };
  const scopeKey = `update:${updateId}`;
  const run = await withJobLock(`summary:${organizationId}:${scopeKey}`, 120_000, async (): Promise<GenerateResult> => {
    const existing = await prisma.aiSummary.findUnique({ where: { organizationId_kind_scopeKey_periodStart: { organizationId, kind: "DAILY_UPDATE", scopeKey, periodStart: built.updateDate } } });
    if (existing && !opts.force && existing.inputHash === built.inputHash) return { status: "unchanged", id: existing.id };
    const out = await ask(provider, built.user, 500);
    const data = { title: built.title, periodEnd: built.updateDate, content: out.content as Prisma.InputJsonValue, provider: out.provider, model: out.model, inputHash: built.inputHash, sourceCount: 1, inputTokens: out.inputTokens, outputTokens: out.outputTokens, status: "PUBLISHED" as const, generatedAt: now };
    if (existing) { await prisma.aiSummary.update({ where: { id: existing.id }, data }); return { status: "updated", id: existing.id }; }
    const row = await prisma.aiSummary.create({ data: { organizationId, kind: "DAILY_UPDATE", scopeKey, periodStart: built.updateDate, subjectId: built.membershipId, updateId, ...data }, select: { id: true } });
    return { status: "created", id: row.id };
  }, () => now);
  return run.ran ? run.value : { status: "busy" };
}

let dailyQueueEnabled = true;
/** Tests switch the background trigger off so call counts are deterministic; production never calls this. */
export const setDailySummaryQueueForTests = (on: boolean) => { dailyQueueEnabled = on; };

/** After an update is submitted or edited: summarize it in the background. Never affects, delays or fails the submission. */
export function queueDailySummary(organizationId: string, updateId: string) {
  if (!dailyQueueEnabled) return;
  try {
    runInBackground(async () => {
      if (!(await aiAllowed(organizationId))) return;
      await generateDaily(organizationId, updateId).catch((e) => console.error("[daymark] daily summary failed:", e instanceof AiError ? e.code : "error"));
    });
  } catch { /* never affect the caller */ }
}

// ───────────────────────── who may read and review ─────────────────────────

type Row = Prisma.AiSummaryGetPayload<{ include: { subject: { select: { user: { select: { name: true } } } }; team: { select: { name: true; managerId: true } }; department: { select: { name: true } }; reviewedBy: { select: { user: { select: { name: true } } } } } }>;
const include = {
  subject: { select: { user: { select: { name: true } } } }, team: { select: { name: true, managerId: true } }, department: { select: { name: true } },
  reviewedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.AiSummaryInclude;

async function access(actor: Actor) {
  const v = await viewerContext(prisma, actor);
  const vis = await prisma.orgSettings.findUnique({ where: { organizationId: actor.organizationId }, select: { visibilityScope: true, peersSeeBlockers: true } });
  const scope = vis?.visibilityScope ?? "OWN", peersSeeBlockers = vis?.peersSeeBlockers ?? false;
  const manages = (id: string | null) => !!id && (v.isAdmin || v.managed!.has(id));
  /** Reviewers: admins; managers for the people and teams in their line. Department/company reports are the admin's. */
  const canReview = (r: Row) => v.isAdmin || (actor.role === "MANAGER" && (
    ((r.kind === "PERSON_WEEK" || r.kind === "DAILY_UPDATE") && manages(r.subjectId)) ||
    (r.kind === "TEAM_WEEK" && !!r.teamId && (manages(r.team?.managerId ?? null) || v.me.teamId === r.teamId))));
  const canRead = (r: Row) => {
    if (canReview(r)) return true;
    if (r.kind === "DAILY_UPDATE" || r.kind === "PERSON_WEEK") return r.status === "PUBLISHED" && !!r.subjectId && v.readIds!.has(r.subjectId);
    if (r.status !== "PUBLISHED") return false;
    if (r.kind === "COMPANY_WEEK") return true;
    if (r.kind === "DEPARTMENT_WEEK") return v.me.departmentId === r.departmentId || scope === "COMPANY" || scope === "DEPARTMENT";
    return v.me.teamId === r.teamId || scope === "COMPANY" || scope === "DEPARTMENT" || (scope === "TEAM" && v.me.teamId === r.teamId);
  };
  // Blockers are reviewer- and owner-only unless the company lets colleagues see them.
  const showBlockers = (r: Row) => canReview(r) || peersSeeBlockers || (!!r.subjectId && r.subjectId === actor.membershipId);
  return { v, canReview, canRead, showBlockers };
}

export type ReportDto = ReturnType<typeof toDto>;
function toDto(r: Row, a: Awaited<ReturnType<typeof access>>, actor: Actor) {
  const content = r.content as SummaryContent;
  const canReview = a.canReview(r);
  return {
    id: r.id, kind: r.kind as Kind, title: r.title, status: r.status, periodStart: r.periodStart, periodEnd: r.periodEnd,
    content: { ...content, blockers: a.showBlockers(r) ? content.blockers : [] },
    blockersHidden: !a.showBlockers(r) && content.blockers.length > 0,
    provider: r.provider, model: r.model, sourceCount: r.sourceCount, generatedAt: r.generatedAt.toISOString(), editedAt: r.editedAt?.toISOString() ?? null,
    reviewedByName: r.reviewedBy?.user.name ?? null, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: canReview ? r.reviewNote : null,
    subjectId: r.subjectId, teamId: r.teamId, departmentId: r.departmentId, subjectName: r.subject?.user.name ?? null, teamName: r.team?.name ?? null, departmentName: r.department?.name ?? null,
    canReview, canEdit: canReview && r.status !== "PUBLISHED", isMine: r.subjectId === actor.membershipId,
  };
}

/** Weekly reports the actor may read, newest week first. `view`: "review" = drafts waiting for them; "published" = approved reports. */
export async function listReports(actor: Actor, opts: { weekStart?: string; view?: "review" | "published" | "all"; now?: Date } = {}) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } });
  const today = localDay(opts.now ?? new Date(), org.timezone);
  const current = weekOf(today).start;
  const rows = await prisma.aiSummary.findMany({
    where: { organizationId: actor.organizationId, kind: { not: "DAILY_UPDATE" }, ...(opts.weekStart ? { periodStart: opts.weekStart } : {}) },
    include, orderBy: [{ periodStart: "desc" }, { title: "asc" }], take: 600,
  });
  const a = await access(actor);
  const order = { COMPANY_WEEK: 0, DEPARTMENT_WEEK: 1, TEAM_WEEK: 2, PERSON_WEEK: 3, DAILY_UPDATE: 4 } as const;
  const items = rows.filter((r) => a.canRead(r))
    .filter((r) => (opts.view === "review" ? a.canReview(r) && r.status === "GENERATED" : opts.view === "published" ? r.status === "PUBLISHED" : true))
    .sort((x, y) => y.periodStart.localeCompare(x.periodStart) || order[x.kind as keyof typeof order] - order[y.kind as keyof typeof order] || x.title.localeCompare(y.title))
    .map((r) => toDto(r, a, actor));
  const lastWeek = weekOf(addDaysSafe(current, -1)).start;
  return { items, currentWeek: current, lastWeek, today };
}
const addDaysSafe = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function getReport(actor: Actor, id: string) {
  const r = await prisma.aiSummary.findFirst({ where: { id, organizationId: actor.organizationId }, include });
  const a = await access(actor);
  if (!r || !a.canRead(r)) throw notFound("Report");
  return toDto(r, a, actor);
}

/** The AI summary of one update, if the actor may see it (the author, their managers, and readers the visibility setting allows). */
export async function getUpdateSummary(actor: Actor, updateId: string) {
  const r = await prisma.aiSummary.findFirst({ where: { organizationId: actor.organizationId, kind: "DAILY_UPDATE", updateId }, include });
  if (!r) return null;
  const a = await access(actor);
  if (!(a.canRead(r) || r.subjectId === actor.membershipId)) return null;
  return toDto(r, a, actor);
}

/** Latest approved weekly summary about the person themselves (for their dashboard). */
export async function latestOwnWeekly(actor: Actor) {
  const r = await prisma.aiSummary.findFirst({ where: { organizationId: actor.organizationId, kind: "PERSON_WEEK", subjectId: actor.membershipId, status: "PUBLISHED" }, include, orderBy: { periodStart: "desc" } });
  return r ? toDto(r, await access(actor), actor) : null;
}

// ───────────────────────── review workflow ─────────────────────────

async function load(actor: Actor, id: string) {
  const a = await access(actor);
  const r = await prisma.aiSummary.findFirst({ where: { id, organizationId: actor.organizationId }, include });
  if (!r || !a.canRead(r)) throw notFound("Report");
  return { r, a };
}

export async function editReport(actor: A, id: string, input: unknown) {
  const content = summaryContentSchema.parse(input);
  const { r, a } = await load(actor, id);
  if (!a.canReview(r)) throw forbidden("Only a reviewer can edit this report.");
  if (r.kind === "DAILY_UPDATE") throw badRequest("Daily summaries can't be edited.");
  if (r.status === "PUBLISHED") throw conflict("Reopen the report before editing it.");
  await prisma.$transaction(async (tx) => {
    await tx.aiSummary.update({ where: { id }, data: { content: content as Prisma.InputJsonValue, editedAt: new Date() } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "report.edited", entityType: "AiSummary", entityId: id, metadata: { kind: r.kind } });
  });
  return { ok: true };
}

export async function reviewReport(actor: A, id: string, input: { action: "approve" | "reject" | "reopen"; note?: string | null }) {
  const { r, a } = await load(actor, id);
  if (!a.canReview(r)) throw forbidden("Only a reviewer can review this report.");
  if (r.kind === "DAILY_UPDATE") throw badRequest("Daily summaries aren't reviewed.");
  const note = input.note?.trim().slice(0, 1000) || null;
  const now = new Date();
  const next = input.action === "approve" ? "PUBLISHED" : input.action === "reject" ? "REJECTED" : "GENERATED";
  if (input.action === "approve" && r.status === "PUBLISHED") return { status: r.status };
  if (input.action === "reject" && r.status === "PUBLISHED") throw conflict("Reopen a published report before rejecting it.");
  if (input.action === "reopen" && r.status === "GENERATED") return { status: r.status };
  await prisma.$transaction(async (tx) => {
    await tx.aiSummary.update({
      where: { id },
      data: { status: next, reviewedById: input.action === "reopen" ? null : actor.membershipId, reviewedAt: input.action === "reopen" ? null : now, reviewNote: input.action === "reject" ? note : input.action === "approve" ? note : null },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: `report.${input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "reopened"}`, entityType: "AiSummary", entityId: id, metadata: { kind: r.kind, periodStart: r.periodStart } });
  });
  if (input.action === "approve") notifyReportPublished(actor.organizationId, r, a.v.me ? (await prisma.membership.findUniqueOrThrow({ where: { id: actor.membershipId }, select: { user: { select: { name: true } } } })).user.name : "A reviewer");
  return { status: next };
}

/** Tell viaSocket (link and title only) that a report was approved. Best effort, once per report. */
function notifyReportPublished(organizationId: string, r: Row, approverName: string) {
  try {
    if (!isViaSocketConfigured()) return;
    runInBackground(async () => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
      const e = await enqueueEvent({
        organizationId, type: "REPORT_PUBLISHED", eventKey: eventKeys.report(r.id),
        payload: (eventId): ReportPayload => ({
          schemaVersion: 1, eventId, eventType: EVENT_CATALOG.REPORT_PUBLISHED.name, occurredAt: new Date().toISOString(), test: false, organization: { name: org.name },
          report: { kind: r.kind === "PERSON_WEEK" ? "person" : r.kind === "TEAM_WEEK" ? "team" : r.kind === "DEPARTMENT_WEEK" ? "department" : "company", title: r.title, periodStart: r.periodStart, periodEnd: r.periodEnd, url: `${appUrl()}/reports/${r.id}` },
          approvedBy: { name: approverName },
        }),
      });
      if (e.created && e.integrationEventId) await deliverPendingForEvent(e.integrationEventId);
    });
  } catch { /* never affects the review */ }
}

// ───────────────────────── on-demand generation ─────────────────────────

/** A reviewer asks for a report now (their team's or person's week; admins also for departments and the company). */
export async function requestReport(actor: A, input: { kind: "PERSON_WEEK" | "TEAM_WEEK" | "DEPARTMENT_WEEK" | "COMPANY_WEEK"; subjectId?: string; weekStart: string }, opts: { provider?: AiProvider; now?: Date } = {}) {
  if (!(await aiAllowed(actor.organizationId))) throw conflict("AI summaries are not switched on for your organization.", "AI_DISABLED");
  if (actor.role === "EMPLOYEE") throw forbidden("Reports are requested by managers and admins.");
  await throttle(`ai-generate:${actor.organizationId}`, 40, 3600);
  const v = await viewerContext(prisma, actor);
  const week = weekOf(input.weekStart);
  if (week.start !== input.weekStart) throw badRequest("Choose the Monday of the week.");
  let subject: WeekSubject;
  if (input.kind === "COMPANY_WEEK") { if (!v.isAdmin) throw forbidden("Only admins can create company reports."); subject = { kind: "COMPANY_WEEK" }; }
  else {
    if (!input.subjectId) throw badRequest("Choose who the report is about.");
    if (input.kind === "DEPARTMENT_WEEK") {
      if (!v.isAdmin) throw forbidden("Only admins can create department reports.");
      if (!(await prisma.department.count({ where: { id: input.subjectId, organizationId: actor.organizationId } }))) throw notFound("Department");
      subject = { kind: "DEPARTMENT_WEEK", departmentId: input.subjectId };
    } else if (input.kind === "TEAM_WEEK") {
      const t = await prisma.team.findFirst({ where: { id: input.subjectId, organizationId: actor.organizationId }, select: { managerId: true } });
      if (!t) throw notFound("Team");
      if (!v.isAdmin && !(actor.role === "MANAGER" && ((t.managerId && v.managed!.has(t.managerId)) || v.me.teamId === input.subjectId))) throw forbidden("You can create reports for teams you manage.");
      subject = { kind: "TEAM_WEEK", teamId: input.subjectId };
    } else {
      if (!v.isAdmin && !v.managed!.has(input.subjectId)) throw forbidden("You can create reports for people you manage.");
      if (!(await prisma.membership.count({ where: { id: input.subjectId, organizationId: actor.organizationId } }))) throw notFound("Person");
      subject = { kind: "PERSON_WEEK", membershipId: input.subjectId };
    }
  }
  const r = await generateWeekly(actor.organizationId, subject, week, { force: true, provider: opts.provider, now: opts.now });
  if (r.status === "skipped") throw conflict("Nobody submitted an update that week, so there is nothing to summarize.", "NOTHING_TO_REPORT");
  if (r.status === "busy") throw conflict("This report is already being written. Try again in a moment.", "BUSY");
  await audit(prisma, { organizationId: actor.organizationId, userId: actor.userId, action: "report.generated", entityType: "AiSummary", entityId: r.id ?? null, metadata: { kind: input.kind, weekStart: week.start } });
  return { id: r.id!, status: r.status };
}

/** (Re)generate the AI summary of one update: its author or a reviewer. */
export async function requestUpdateSummary(actor: A, updateId: string, opts: { provider?: AiProvider } = {}) {
  if (!(await aiAllowed(actor.organizationId))) throw conflict("AI summaries are not switched on for your organization.", "AI_DISABLED");
  const u = await prisma.dailyUpdate.findFirst({ where: { id: updateId, organizationId: actor.organizationId, status: { in: ["SUBMITTED", "EDITED"] } }, select: { membershipId: true } });
  if (!u) throw notFound("Update");
  const v = await viewerContext(prisma, actor);
  if (!(u.membershipId === actor.membershipId || v.isAdmin || v.managed!.has(u.membershipId))) throw notFound("Update");
  await throttle(`ai-generate:${actor.organizationId}`, 40, 3600);
  const r = await generateDaily(actor.organizationId, updateId, { force: true, provider: opts.provider });
  if (r.status === "skipped") throw conflict("There is nothing to summarize in this update.", "NOTHING_TO_REPORT");
  return r;
}

/** Admin check that the provider key works: a tiny request, no employee data. Returns only ok/provider/model/latency. */
export async function testAiConnection(actor: A, opts: { provider?: AiProvider } = {}) {
  if (actor.role !== "ADMIN") throw forbidden();
  await throttle(`ai-test:${actor.organizationId}`, 6, 3600);
  if (!aiConfigured()) return { ok: false as const, reason: "NOT_CONFIGURED" as const };
  const provider = opts.provider ?? getAiProvider();
  const t0 = Date.now();
  try {
    await provider.complete({ system: "Reply with the single word OK.", user: "ping", maxTokens: 8 });
    return { ok: true as const, provider: provider.name, model: provider.model, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false as const, reason: e instanceof AiError ? e.code : ("PROVIDER_ERROR" as const), provider: provider.name, model: provider.model };
  }
}
