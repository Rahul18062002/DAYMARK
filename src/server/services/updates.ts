import type { Prisma } from "@/generated/prisma/client";
import type { UpdateSection, UpdateSource, UpdateStatus } from "@/generated/prisma/enums";
import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { createUpdateSchema, patchUpdateSchema } from "../validation";
import { addDays, isoWeekday, localDay, toDayString, parseDay, weekStart, zonedTimeToUtc } from "@/lib/dates";

type A = Actor & { userId: string };
type Opts = { now?: Date };

export const MAX_BACKDATE_DAYS = 7;

export type Sections = Record<UpdateSection, string[]>;
export type LinkInput = { url: string; label?: string };
export type Content = { sections: Sections; links: LinkInput[] };

const emptySections = (): Sections => ({ WORKED_ON: [], COMPLETED: [], PENDING: [], BLOCKER: [], NEXT_PRIORITY: [] });

function fromInput(s: { workedOn: string[]; completed: string[]; pending: string[]; blockers: string[]; nextPriorities: string[] }): Sections {
  return { WORKED_ON: s.workedOn, COMPLETED: s.completed, PENDING: s.pending, BLOCKER: s.blockers, NEXT_PRIORITY: s.nextPriorities };
}

// "None", "N/A", "no blockers", … are answers, not blockers.
const NO_BLOCKER = /^(none|no|nil|n\/a|na|nothing|not any|no blockers?|no issues?|no challenges?|-+|\.+)[.!\s]*$/i;
export function computeHasBlockers(blockerItems: string[]): boolean {
  return blockerItems.some((t) => !NO_BLOCKER.test(t.trim()));
}

function assertSubmittable(c: Content) {
  if (c.sections.WORKED_ON.length === 0) {
    throw badRequest("Tell us what you worked on today before submitting.", { "sections.workedOn": "Add at least one entry" });
  }
}

async function orgContext(db: Tx | typeof prisma, organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
  return {
    timezone: org.timezone,
    cutoff: org.settings?.updateCutoffTime ?? "18:00",
    editWindowHours: org.settings?.editWindowHours ?? 24,
    workingDays: org.settings?.workingDays ?? [1, 2, 3, 4, 5],
  };
}

const snapshotOf = (day: string, c: Content) => ({
  updateDate: day,
  sections: c.sections,
  links: c.links.map((l) => ({ url: l.url, label: l.label ?? null })),
});

async function replaceContent(tx: Tx, organizationId: string, dailyUpdateId: string, c: Content) {
  await tx.updateItem.deleteMany({ where: { dailyUpdateId, organizationId } });
  await tx.updateAttachment.deleteMany({ where: { dailyUpdateId, organizationId } });
  const items = (Object.keys(c.sections) as UpdateSection[]).flatMap((section) =>
    c.sections[section].map((text, position) => ({ organizationId, dailyUpdateId, section, position, text })),
  );
  if (items.length) await tx.updateItem.createMany({ data: items });
  if (c.links.length) {
    await tx.updateAttachment.createMany({
      data: c.links.map((l, position) => ({ organizationId, dailyUpdateId, position, url: l.url, label: l.label ?? null })),
    });
  }
}

async function loadContent(tx: Tx | typeof prisma, organizationId: string, dailyUpdateId: string): Promise<Content> {
  const [items, links] = await Promise.all([
    tx.updateItem.findMany({ where: { dailyUpdateId, organizationId }, orderBy: [{ section: "asc" }, { position: "asc" }] }),
    tx.updateAttachment.findMany({ where: { dailyUpdateId, organizationId }, orderBy: { position: "asc" } }),
  ]);
  const sections = emptySections();
  for (const i of items) sections[i.section].push(i.text);
  return { sections, links: links.map((l) => ({ url: l.url, label: l.label ?? undefined })) };
}

// ───────────────────────── create / update / delete ─────────────────────────

export async function createUpdate(actor: A, raw: unknown, opts: Opts & { source?: UpdateSource } = {}) {
  assertCan(actor, "update:write");
  const input = createUpdateSchema.parse(raw);
  const now = opts.now ?? new Date();
  const content: Content = { sections: fromInput(input.sections), links: input.links };

  return prisma.$transaction(async (tx) => {
    const cfg = await orgContext(tx, actor.organizationId);
    const today = localDay(now, cfg.timezone);
    const day = input.updateDate ?? today;
    if (day > today) throw badRequest("You can't submit an update for a future date.", { updateDate: "Choose today or an earlier date" });
    if (day < addDays(today, -MAX_BACKDATE_DAYS)) {
      throw badRequest(`Updates can be added for the last ${MAX_BACKDATE_DAYS} days only.`, { updateDate: `Choose a date within the last ${MAX_BACKDATE_DAYS} days` });
    }
    if (input.submit) assertSubmittable(content);

    const existing = await tx.dailyUpdate.findUnique({
      where: { membershipId_updateDate: { membershipId: actor.membershipId, updateDate: parseDay(day) } },
      select: { id: true },
    });
    if (existing) throw new AppError(409, "UPDATE_EXISTS", "You already have an update for that day.", { id: existing.id });

    const created = await tx.dailyUpdate.create({
      data: {
        organizationId: actor.organizationId,
        membershipId: actor.membershipId,
        updateDate: parseDay(day),
        source: opts.source ?? "DASHBOARD",
        hasBlockers: computeHasBlockers(content.sections.BLOCKER),
      },
    });
    await replaceContent(tx, actor.organizationId, created.id, content);
    if (input.submit) await submit(tx, actor, created.id, day, content, now, cfg);
    return { id: created.id, status: (input.submit ? "SUBMITTED" : "DRAFT") as UpdateStatus };
  }).catch((e) => {
    if ((e as { code?: string })?.code === "P2002") throw conflict("You already have an update for that day.", "UPDATE_EXISTS");
    throw e;
  });
}

async function submit(tx: Tx, actor: A, id: string, day: string, content: Content, now: Date, cfg: Awaited<ReturnType<typeof orgContext>>) {
  const cutoffAt = zonedTimeToUtc(day, cfg.cutoff, cfg.timezone);
  await tx.dailyUpdate.update({
    where: { id },
    data: { status: "SUBMITTED", firstSubmittedAt: now, submittedLate: now > cutoffAt, revisionCount: 1 },
  });
  await tx.updateRevision.create({
    data: {
      organizationId: actor.organizationId, dailyUpdateId: id, revisionNumber: 1, kind: "SUBMITTED",
      statusAtTime: "SUBMITTED", changedByUserId: actor.userId, snapshot: snapshotOf(day, content),
    },
  });
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "update.submitted", entityType: "DailyUpdate", entityId: id, metadata: { date: day } });
}

export async function updateUpdate(actor: A, id: string, raw: unknown, opts: Opts = {}) {
  assertCan(actor, "update:write");
  const patch = patchUpdateSchema.parse(raw);
  const now = opts.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Only the owner can change an update — everyone else gets "not found".
    const row = await tx.dailyUpdate.findFirst({ where: { id, organizationId: actor.organizationId, membershipId: actor.membershipId } });
    if (!row) throw notFound("Update");
    const cfg = await orgContext(tx, actor.organizationId);
    const day = toDayString(row.updateDate);

    const current = await loadContent(tx, actor.organizationId, id);
    const next: Content = {
      sections: patch.sections ? fromInput(patch.sections) : current.sections,
      links: patch.links ?? current.links,
    };

    if (row.status === "DRAFT") {
      if (patch.submit) assertSubmittable(next);
      await replaceContent(tx, actor.organizationId, id, next);
      await tx.dailyUpdate.update({ where: { id }, data: { hasBlockers: computeHasBlockers(next.sections.BLOCKER) } });
      if (patch.submit) await submit(tx, actor, id, day, next, now, cfg);
      return { id, status: (patch.submit ? "SUBMITTED" : "DRAFT") as UpdateStatus, changed: true };
    }

    // Submitted / edited: only within the edit window, measured from the ORIGINAL submission.
    const until = editDeadline(row.firstSubmittedAt, cfg.editWindowHours);
    if (!until || now > until) {
      throw new AppError(403, "EDIT_WINDOW_CLOSED", cfg.editWindowHours === 0 ? "Editing submitted updates is turned off for this organization." : "The editing period for this update has ended.");
    }
    if (!patch.sections && !patch.links) throw badRequest("Nothing to change.");
    assertSubmittable(next);

    if (JSON.stringify(snapshotOf(day, current)) === JSON.stringify(snapshotOf(day, next))) {
      return { id, status: row.status, changed: false };
    }
    await replaceContent(tx, actor.organizationId, id, next);
    const revisionNumber = row.revisionCount + 1;
    await tx.dailyUpdate.update({
      where: { id },
      // `firstSubmittedAt` and `submittedLate` are deliberately left untouched.
      data: { status: "EDITED", lastEditedAt: now, revisionCount: revisionNumber, hasBlockers: computeHasBlockers(next.sections.BLOCKER) },
    });
    await tx.updateRevision.create({
      data: {
        organizationId: actor.organizationId, dailyUpdateId: id, revisionNumber, kind: "EDITED",
        statusAtTime: "EDITED", changedByUserId: actor.userId, snapshot: snapshotOf(day, next),
      },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "update.edited", entityType: "DailyUpdate", entityId: id, metadata: { date: day, revision: revisionNumber } });
    return { id, status: "EDITED" as UpdateStatus, changed: true };
  });
}

export async function deleteDraft(actor: A, id: string) {
  assertCan(actor, "update:write");
  await prisma.$transaction(async (tx) => {
    const row = await tx.dailyUpdate.findFirst({ where: { id, organizationId: actor.organizationId, membershipId: actor.membershipId } });
    if (!row) throw notFound("Update");
    if (row.status !== "DRAFT") throw forbidden("Submitted updates can't be deleted.");
    await tx.dailyUpdate.delete({ where: { id } });
  });
}

function editDeadline(firstSubmittedAt: Date | null, hours: number): Date | null {
  if (!firstSubmittedAt || hours <= 0) return null;
  return new Date(firstSubmittedAt.getTime() + hours * 3_600_000);
}

// ───────────────────────── reading ─────────────────────────

const detailInclude = {
  items: { orderBy: { position: "asc" } },
  attachments: { orderBy: { position: "asc" } },
  revisions: { orderBy: { revisionNumber: "asc" } },
  membership: {
    select: {
      id: true,
      user: { select: { name: true, email: true } },
      team: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.DailyUpdateInclude;

type DetailRow = Prisma.DailyUpdateGetPayload<{ include: typeof detailInclude }>;

export function toDetailDto(row: DetailRow, editWindowHours?: number, now: Date = new Date()) {
  const sections = emptySections();
  for (const i of [...row.items].sort((a, b) => a.position - b.position)) sections[i.section].push(i.text);
  const until = editWindowHours === undefined ? null : editDeadline(row.firstSubmittedAt, editWindowHours);
  const canEdit = row.status === "DRAFT" || (until !== null && now <= until);
  return {
    id: row.id,
    membershipId: row.membershipId,
    employee: {
      name: row.membership.user.name,
      email: row.membership.user.email,
      teamName: row.membership.team?.name ?? null,
      departmentName: row.membership.department?.name ?? null,
    },
    updateDate: toDayString(row.updateDate),
    status: row.status,
    source: row.source,
    hasBlockers: row.hasBlockers,
    submittedLate: row.submittedLate,
    firstSubmittedAt: row.firstSubmittedAt?.toISOString() ?? null,
    lastEditedAt: row.lastEditedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sections,
    links: row.attachments.map((a) => ({ url: a.url, label: a.label })),
    revisions: row.revisions.map((r) => ({
      revisionNumber: r.revisionNumber,
      kind: r.kind,
      statusAtTime: r.statusAtTime,
      createdAt: r.createdAt.toISOString(),
      snapshot: r.snapshot as { updateDate: string; sections: Sections; links: { url: string; label: string | null }[] },
    })),
    editableUntil: canEdit && until && row.status !== "DRAFT" ? until.toISOString() : null,
    canEdit,
  };
}
export type UpdateDetail = ReturnType<typeof toDetailDto>;

export const emptyContent = emptySections;
export { detailInclude };

export async function getOwnUpdate(actor: A | Actor, id: string, opts: Opts = {}) {
  const row = await prisma.dailyUpdate.findFirst({
    where: { id, organizationId: actor.organizationId, membershipId: actor.membershipId },
    include: detailInclude,
  });
  if (!row) throw notFound("Update");
  const cfg = await orgContext(prisma, actor.organizationId);
  return toDetailDto(row, cfg.editWindowHours, opts.now);
}

export async function listOwnUpdates(actor: Actor, limit = 60) {
  const rows = await prisma.dailyUpdate.findMany({
    where: { organizationId: actor.organizationId, membershipId: actor.membershipId },
    orderBy: { updateDate: "desc" },
    take: Math.min(limit, 200),
    include: { items: { where: { section: "WORKED_ON" }, orderBy: { position: "asc" }, take: 1 } },
  });
  return rows.map((r) => ({
    id: r.id,
    updateDate: toDayString(r.updateDate),
    status: r.status,
    hasBlockers: r.hasBlockers,
    submittedLate: r.submittedLate,
    preview: r.items[0]?.text ?? "",
    firstSubmittedAt: r.firstSubmittedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Today's state for the employee dashboard / My Updates banner. */
export async function getTodayStatus(actor: Actor, opts: Opts = {}) {
  const cfg = await orgContext(prisma, actor.organizationId);
  const today = localDay(opts.now ?? new Date(), cfg.timezone);
  const row = await prisma.dailyUpdate.findUnique({
    where: { membershipId_updateDate: { membershipId: actor.membershipId, updateDate: parseDay(today) } },
    select: { id: true, status: true, firstSubmittedAt: true },
  });
  return { today, timezone: cfg.timezone, cutoff: cfg.cutoff, isWorkingDay: cfg.workingDays.includes(isoWeekday(today)), update: row ? { id: row.id, status: row.status } : null };
}

export type WeekDayStatus = "SUBMITTED" | "EDITED" | "DRAFT" | "MISSING" | "UPCOMING" | "OFF";

/** Monday–Sunday of the current week with the person's status for each day. */
export async function getWeekOverview(actor: Actor, opts: Opts = {}) {
  const cfg = await orgContext(prisma, actor.organizationId);
  const today = localDay(opts.now ?? new Date(), cfg.timezone);
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = await prisma.dailyUpdate.findMany({
    where: { organizationId: actor.organizationId, membershipId: actor.membershipId, updateDate: { gte: parseDay(days[0]), lte: parseDay(days[6]) } },
    select: { id: true, updateDate: true, status: true },
  });
  const byDay = new Map(rows.map((r) => [toDayString(r.updateDate), r]));
  const member = await prisma.membership.findFirst({ where: { id: actor.membershipId, organizationId: actor.organizationId }, select: { createdAt: true } });
  const joined = member ? localDay(member.createdAt, cfg.timezone) : days[0];
  const list = days.map((day) => {
    const r = byDay.get(day);
    const working = cfg.workingDays.includes(isoWeekday(day));
    let status: WeekDayStatus;
    if (r) status = r.status;
    else if (!working) status = "OFF";
    else if (day > today) status = "UPCOMING";
    else if (day < joined) status = "OFF";
    else status = day === today ? "UPCOMING" : "MISSING";
    return { day, isToday: day === today, status, id: r?.id ?? null };
  });
  const submitted = list.filter((d) => d.status === "SUBMITTED" || d.status === "EDITED").length;
  const expected = list.filter((d) => cfg.workingDays.includes(isoWeekday(d.day)) && d.day <= today && d.day >= joined).length;
  return { days: list, submitted, expected };
}
