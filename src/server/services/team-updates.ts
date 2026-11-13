import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { assertCan, visibleMembershipWhere, type Actor } from "../policy";
import { badRequest, notFound } from "../errors";
import { teamUpdateFilterSchema } from "../validation";
import { addDays, daysBetween, isoWeekday, localDay, parseDay, toDayString, weekStart } from "@/lib/dates";
import { detailInclude, toDetailDto } from "./updates";

type Opts = { now?: Date };
export const MAX_RANGE_DAYS = 31;
const MAX_ROWS = 500;

async function cfgOf(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
  return { tz: org.timezone, workingDays: org.settings?.workingDays ?? [1, 2, 3, 4, 5], editWindowHours: org.settings?.editWindowHours ?? 24 };
}

/** Members whose updates the actor may see (active only), optionally narrowed by filters. */
async function scopedMembers(actor: Actor, f: { departmentId?: string; teamId?: string; membershipId?: string } = {}) {
  assertCan(actor, "update:team");
  const scope = await visibleMembershipWhere(prisma, actor);
  return prisma.membership.findMany({
    where: { AND: [scope, { status: "ACTIVE", departmentId: f.departmentId, teamId: f.teamId, id: f.membershipId }] },
    select: { id: true, createdAt: true, teamId: true, departmentId: true, user: { select: { name: true } }, team: { select: { name: true } }, department: { select: { name: true } } },
  });
}

/** One submitted/edited update, only if its author is inside the actor's scope. Drafts are never visible here. */
export async function getTeamUpdate(actor: Actor, id: string, opts: Opts = {}) {
  assertCan(actor, "update:team");
  const scope = await visibleMembershipWhere(prisma, actor);
  const row = await prisma.dailyUpdate.findFirst({
    where: { id, organizationId: actor.organizationId, status: { in: ["SUBMITTED", "EDITED"] }, membership: { is: scope } },
    include: detailInclude,
  });
  if (!row) throw notFound("Update");
  return toDetailDto(row, undefined, opts.now);
}

export type TeamRow = {
  key: string;
  updateId: string | null;
  membershipId: string;
  employeeName: string;
  teamName: string | null;
  departmentName: string | null;
  date: string;
  status: "SUBMITTED" | "EDITED" | "MISSING";
  hasBlockers: boolean;
  submittedLate: boolean;
  lastUpdatedAt: string | null;
  preview: string;
};

export async function listTeamUpdates(actor: Actor, rawFilters: unknown = {}, opts: Opts = {}) {
  assertCan(actor, "update:team");
  const f = teamUpdateFilterSchema.parse(rawFilters);
  const cfg = await cfgOf(actor.organizationId);
  const today = localDay(opts.now ?? new Date(), cfg.tz);
  let from = f.from ?? f.to ?? today;
  let to = f.to ?? f.from ?? today;
  if (from > to) [from, to] = [to, from];
  const days = daysBetween(from, to);
  if (days.length > MAX_RANGE_DAYS) throw badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);

  const scope = await visibleMembershipWhere(prisma, actor);
  const memberFilter: Prisma.MembershipWhereInput = { departmentId: f.departmentId, teamId: f.teamId, id: f.membershipId };

  const wantUpdates = f.status !== "missing";
  const wantMissing = !f.status || f.status === "missing";

  const updates = await prisma.dailyUpdate.findMany({
    where: {
      organizationId: actor.organizationId,
      updateDate: { gte: parseDay(from), lte: parseDay(to) },
      status: f.status === "submitted" ? "SUBMITTED" : f.status === "edited" ? "EDITED" : { in: ["SUBMITTED", "EDITED"] },
      hasBlockers: f.blockers ? true : undefined,
      membership: { is: { AND: [scope, memberFilter] } },
    },
    orderBy: [{ updateDate: "desc" }, { updatedAt: "desc" }],
    take: MAX_ROWS + 1,
    include: {
      items: { where: { section: "WORKED_ON" }, orderBy: { position: "asc" }, take: 1 },
      membership: { select: { user: { select: { name: true } }, team: { select: { name: true } }, department: { select: { name: true } } } },
    },
  });

  const rows: TeamRow[] = wantUpdates
    ? updates.map((u) => ({
        key: u.id, updateId: u.id, membershipId: u.membershipId, employeeName: u.membership.user.name,
        teamName: u.membership.team?.name ?? null, departmentName: u.membership.department?.name ?? null,
        date: toDayString(u.updateDate), status: u.status as "SUBMITTED" | "EDITED", hasBlockers: u.hasBlockers,
        submittedLate: u.submittedLate, lastUpdatedAt: (u.lastEditedAt ?? u.firstSubmittedAt ?? u.updatedAt).toISOString(),
        preview: u.items[0]?.text ?? "",
      }))
    : [];

  if (wantMissing && !f.blockers) {
    // "Not submitted" = an active person, on a working day, who has no submitted update for it.
    // Nobody is "missing" for days before they joined or days that haven't ended being due yet.
    const members = await scopedMembers(actor, f);
    const submittedKeys = new Set(
      (await prisma.dailyUpdate.findMany({
        where: {
          organizationId: actor.organizationId, status: { in: ["SUBMITTED", "EDITED"] },
          updateDate: { gte: parseDay(from), lte: parseDay(to) }, membershipId: { in: members.map((m) => m.id) },
        },
        select: { membershipId: true, updateDate: true },
      })).map((u) => `${u.membershipId}|${toDayString(u.updateDate)}`),
    );
    for (const day of days) {
      if (day > today || !cfg.workingDays.includes(isoWeekday(day))) continue;
      for (const m of members) {
        if (localDay(m.createdAt, cfg.tz) > day) continue;
        if (submittedKeys.has(`${m.id}|${day}`)) continue;
        rows.push({
          key: `missing|${m.id}|${day}`, updateId: null, membershipId: m.id, employeeName: m.user.name,
          teamName: m.team?.name ?? null, departmentName: m.department?.name ?? null, date: day, status: "MISSING",
          hasBlockers: false, submittedLate: false, lastUpdatedAt: null, preview: "",
        });
      }
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || (a.status === "MISSING" ? -1 : 0) - (b.status === "MISSING" ? -1 : 0) || a.employeeName.localeCompare(b.employeeName));
  const truncated = rows.length > MAX_ROWS;
  return { from, to, today, rows: rows.slice(0, MAX_ROWS), truncated };
}

/** Cards for one day: team size, submitted, pending, blockers, plus weekly activity. */
export async function teamOverview(actor: Actor, opts: Opts & { day?: string } = {}) {
  assertCan(actor, "update:team");
  const cfg = await cfgOf(actor.organizationId);
  const today = localDay(opts.now ?? new Date(), cfg.tz);
  const day = opts.day ?? today;
  const scope = await visibleMembershipWhere(prisma, actor);
  const members = await scopedMembers(actor);
  const expectedIds = members.filter((m) => localDay(m.createdAt, cfg.tz) <= day).map((m) => m.id);
  const isWorkingDay = cfg.workingDays.includes(isoWeekday(day));

  const [todays, weekRows] = await Promise.all([
    prisma.dailyUpdate.findMany({
      where: { organizationId: actor.organizationId, updateDate: parseDay(day), status: { in: ["SUBMITTED", "EDITED"] }, membership: { is: { AND: [scope, { status: "ACTIVE" }] } } },
      select: { membershipId: true, hasBlockers: true },
    }),
    prisma.dailyUpdate.findMany({
      where: { organizationId: actor.organizationId, updateDate: { gte: parseDay(weekStart(day)), lte: parseDay(day) }, status: { in: ["SUBMITTED", "EDITED"] }, membership: { is: scope } },
      select: { membershipId: true },
    }),
  ]);
  const submittedIds = new Set(todays.map((t) => t.membershipId));
  const pendingIds = isWorkingDay ? expectedIds.filter((id) => !submittedIds.has(id)) : [];
  return {
    day, today, isWorkingDay,
    totalMembers: members.length,
    submitted: submittedIds.size,
    pending: pendingIds.length,
    withBlockers: new Set(todays.filter((t) => t.hasBlockers).map((t) => t.membershipId)).size,
    weekly: { updates: weekRows.length, contributors: new Set(weekRows.map((r) => r.membershipId)).size, weekStart: weekStart(day) },
  };
}

/** Submitted vs expected per day for the last `days` days (default two weeks). */
export async function teamTrend(actor: Actor, opts: Opts & { days?: number } = {}) {
  assertCan(actor, "update:team");
  const cfg = await cfgOf(actor.organizationId);
  const end = localDay(opts.now ?? new Date(), cfg.tz);
  const n = Math.min(Math.max(opts.days ?? 14, 1), 60);
  const start = addDays(end, -(n - 1));
  const scope = await visibleMembershipWhere(prisma, actor);
  const [members, rows] = await Promise.all([
    scopedMembers(actor),
    prisma.dailyUpdate.groupBy({
      by: ["updateDate"],
      where: { organizationId: actor.organizationId, updateDate: { gte: parseDay(start), lte: parseDay(end) }, status: { in: ["SUBMITTED", "EDITED"] }, membership: { is: scope } },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(rows.map((r) => [toDayString(r.updateDate), r._count._all]));
  return daysBetween(start, end).map((d) => ({
    date: d,
    submitted: counts.get(d) ?? 0,
    expected: cfg.workingDays.includes(isoWeekday(d)) ? members.filter((m) => localDay(m.createdAt, cfg.tz) <= d).length : 0,
  }));
}

/**
 * Raw, recent entries from submitted updates — blockers, pending work and completed work.
 * These are the employees' own words (no grouping or interpretation yet).
 */
export async function teamHighlights(actor: Actor, opts: Opts & { days?: number; limit?: number } = {}) {
  assertCan(actor, "update:team");
  const cfg = await cfgOf(actor.organizationId);
  const end = localDay(opts.now ?? new Date(), cfg.tz);
  const start = addDays(end, -((opts.days ?? 7) - 1));
  const scope = await visibleMembershipWhere(prisma, actor);
  const take = opts.limit ?? 8;
  const q = async (section: "BLOCKER" | "PENDING" | "COMPLETED") => {
    const rows = await prisma.updateItem.findMany({
      where: {
        organizationId: actor.organizationId, section,
        dailyUpdate: { status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: parseDay(start), lte: parseDay(end) }, membership: { is: scope } },
      },
      orderBy: [{ dailyUpdate: { updateDate: "desc" } }, { position: "asc" }],
      take: take * 3,
      select: { text: true, dailyUpdate: { select: { id: true, updateDate: true, membership: { select: { user: { select: { name: true } } } } } } },
    });
    return rows
      .filter((r) => section !== "BLOCKER" || !/^(none|no|nil|n\/a|na|nothing)[.!\s]*$/i.test(r.text.trim()))
      .slice(0, take)
      .map((r) => ({ updateId: r.dailyUpdate.id, date: toDayString(r.dailyUpdate.updateDate), employeeName: r.dailyUpdate.membership.user.name, text: r.text }));
  };
  const [blockers, pending, completed] = await Promise.all([q("BLOCKER"), q("PENDING"), q("COMPLETED")]);
  return { from: start, to: end, blockers, pending, completed };
}

/** Departments and teams the actor may filter by (their scope only). */
export async function filterOptions(actor: Actor) {
  assertCan(actor, "update:team");
  const members = await scopedMembers(actor);
  const teamIds = [...new Set(members.flatMap((m) => (m.teamId ? [m.teamId] : [])))];
  const deptIds = [...new Set(members.flatMap((m) => (m.departmentId ? [m.departmentId] : [])))];
  const [teams, departments] = await Promise.all([
    prisma.team.findMany({ where: { organizationId: actor.organizationId, id: { in: teamIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { organizationId: actor.organizationId, id: { in: deptIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { people: members.map((m) => ({ id: m.id, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name)), teams, departments };
}
