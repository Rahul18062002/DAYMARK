import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { notFound } from "../errors";
import { readScope, type Actor, type ReadScope } from "../policy";
import { addDays, daysBetween, isoWeekday, localDay, weekStart } from "@/lib/dates";
import { parseWorkingDays } from "@/lib/working-days";
import { listObjectives } from "./goals";

/**
 * Consistency and goal metrics for people, from what they reported and what they own. These describe habits and
 * progress; they are NOT a measure of how valuable someone is, and the screens say so. Nothing here ranks people.
 *
 *  - consistency: share of expected working days with a submitted update (the current day only counts once submitted;
 *    nobody is "missing" for days before they joined)
 *  - on time: share of submitted days that were not late
 *  - blockers: only for people whose blockers the viewer may read, otherwise null
 */
export type PersonMetrics = {
  membershipId: string; name: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE"; jobTitle: string | null; level: number | null;
  teamName: string | null; departmentName: string | null; managerId: string | null; managerName: string | null; mentorName: string | null; joinedAt: string;
  expectedDays: number; submittedDays: number; onTimeDays: number;
  consistency: number | null; onTimeRate: number | null; blockerDays: number | null; streak: number;
  weekly: { weekStart: string; rate: number | null }[];
  goals: { owned: number; avgProgress: number | null; atRisk: number; offTrack: number };
  tasks: { doneInWindow: number; open: number; overdue: number };
  taggedUpdates: number;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };

/** Who the actor may compare: the people they can read (plus themselves), active only. */
async function readablePeople(actor: Actor, vs: ReadScope): Promise<Prisma.MembershipWhereInput> {
  return { AND: [vs.where, { status: "ACTIVE" }] };
}

async function metricsFor(actor: Actor, vs: ReadScope, where: Prisma.MembershipWhereInput, weeks: number, now: Date): Promise<{ people: PersonMetrics[]; from: string; to: string; today: string }> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, include: { settings: true } });
  const tz = org.timezone, workDays = parseWorkingDays(org.settings?.workingDays);
  const today = localDay(now, tz);
  const from = addDays(weekStart(today), -(weeks - 1) * 7);
  const allDays = daysBetween(from, today);

  const members = await prisma.membership.findMany({
    where: where,
    select: {
      id: true, role: true, jobTitle: true, level: true, managerId: true, createdAt: true,
      user: { select: { name: true } }, team: { select: { name: true } }, department: { select: { name: true } },
      manager: { select: { user: { select: { name: true } } } }, mentor: { select: { user: { select: { name: true } } } },
    },
  });
  const [updates, tagged, doneTasks, openTasks, goalItems] = await Promise.all([
    prisma.dailyUpdate.findMany({
      where: { organizationId: actor.organizationId, status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: from, lte: today }, membership: { is: where } },
      select: { membershipId: true, updateDate: true, submittedLate: true, hasBlockers: true },
    }),
    prisma.dailyUpdate.groupBy({ by: ["membershipId"], where: { organizationId: actor.organizationId, status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: from, lte: today }, goalLinks: { some: {} }, membership: { is: where } }, _count: { _all: true } }),
    prisma.workTask.groupBy({ by: ["assigneeId"], where: { organizationId: actor.organizationId, status: "DONE", doneAt: { gte: new Date(`${from}T00:00:00Z`) }, assignee: { is: where } }, _count: { _all: true } }),
    prisma.workTask.findMany({ where: { organizationId: actor.organizationId, status: { not: "DONE" }, assignee: { is: where } }, select: { assigneeId: true, dueDate: true } }),
    listObjectives(actor, { from: today, to: today }, { now }),
  ]);

  const byPerson = new Map<string, Map<string, { late: boolean; blockers: boolean }>>();
  for (const u of updates) (byPerson.get(u.membershipId) ?? byPerson.set(u.membershipId, new Map()).get(u.membershipId)!).set(u.updateDate, { late: u.submittedLate, blockers: u.hasBlockers });
  const taggedBy = new Map(tagged.map((t) => [t.membershipId, t._count._all]));
  const doneBy = new Map(doneTasks.map((t) => [t.assigneeId, t._count._all]));
  const openBy = new Map<string, { open: number; overdue: number }>();
  for (const t of openTasks) { const o = openBy.get(t.assigneeId) ?? { open: 0, overdue: 0 }; o.open++; if (t.dueDate && t.dueDate < today) o.overdue++; openBy.set(t.assigneeId, o); }
  const goalsBy = new Map<string, typeof goalItems.items>();
  for (const g of goalItems.items) if (g.status === "ACTIVE") (goalsBy.get(g.ownerId) ?? goalsBy.set(g.ownerId, []).get(g.ownerId)!).push(g);

  const people = members.map((m): PersonMetrics => {
    const mine = byPerson.get(m.id) ?? new Map();
    const joined = localDay(m.createdAt, tz);
    // expected: working days since they joined, before today (today counts once submitted)
    const expected = allDays.filter((d) => workDays.includes(isoWeekday(d)) && d >= joined && (d < today || mine.has(d)));
    const submitted = expected.filter((d) => mine.has(d));
    const onTime = submitted.filter((d) => !mine.get(d)!.late);
    let streak = 0;
    for (const d of [...expected].reverse()) { if (mine.has(d)) streak++; else break; }
    const weekly = Array.from({ length: weeks }, (_, i) => {
      const ws = addDays(from, i * 7), days = expected.filter((d) => d >= ws && d < addDays(ws, 7));
      return { weekStart: ws, rate: pct(days.filter((d) => mine.has(d)).length, days.length) };
    });
    const canBlockers = vs.blockersFor(m.id);
    const goals = goalsBy.get(m.id) ?? [];
    const ot = openBy.get(m.id) ?? { open: 0, overdue: 0 };
    return {
      membershipId: m.id, name: m.user.name, role: m.role, jobTitle: m.jobTitle, level: m.level,
      teamName: m.team?.name ?? null, departmentName: m.department?.name ?? null, managerId: m.managerId, managerName: m.manager?.user.name ?? null, mentorName: m.mentor?.user.name ?? null,
      joinedAt: joined, expectedDays: expected.length, submittedDays: submitted.length, onTimeDays: onTime.length,
      consistency: pct(submitted.length, expected.length), onTimeRate: pct(onTime.length, submitted.length),
      blockerDays: canBlockers ? submitted.filter((d) => mine.get(d)!.blockers).length : null, streak, weekly,
      goals: { owned: goals.length, avgProgress: mean(goals.flatMap((g) => (g.progress === null ? [] : [g.progress]))), atRisk: goals.filter((g) => g.health === "AT_RISK").length, offTrack: goals.filter((g) => g.health === "OFF_TRACK").length },
      tasks: { doneInWindow: doneBy.get(m.id) ?? 0, open: ot.open, overdue: ot.overdue },
      taggedUpdates: taggedBy.get(m.id) ?? 0,
    };
  });
  return { people, from, to: today, today };
}

export type GroupBy = "team" | "department" | "manager" | "level" | "all";

/** Peers side by side, grouped. Alphabetical inside a group: there is no league table. */
export async function compare(actor: Actor, opts: { groupBy?: GroupBy; weeks?: number; now?: Date } = {}) {
  const vs = await readScope(prisma, actor);
  const weeks = [4, 12].includes(opts.weeks ?? 4) ? opts.weeks ?? 4 : 4;
  const { people, from, to, today } = await metricsFor(actor, vs, await readablePeople(actor, vs), weeks, opts.now ?? new Date());
  const groupBy = opts.groupBy ?? "team";
  const keyOf = (p: PersonMetrics) => ({
    team: p.teamName ?? "No team", department: p.departmentName ?? "No department", manager: p.managerName ?? "No manager", level: p.level ? `Level ${p.level}` : "No level", all: "Everyone",
  })[groupBy];
  const groups = new Map<string, PersonMetrics[]>();
  for (const p of people) (groups.get(keyOf(p)) ?? groups.set(keyOf(p), []).get(keyOf(p))!).push(p);
  const out = [...groups.entries()].map(([name, ps]) => ({
    name, size: ps.length,
    medianConsistency: median(ps.flatMap((p) => (p.consistency === null ? [] : [p.consistency]))),
    medianGoalProgress: median(ps.flatMap((p) => (p.goals.avgProgress === null ? [] : [p.goals.avgProgress]))),
    people: ps.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => (a.name.startsWith("No ") ? 1 : 0) - (b.name.startsWith("No ") ? 1 : 0) || (groupBy === "level" ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.name.localeCompare(b.name)));
  return { groupBy, weeks, from, to, today, groups: out, total: people.length, canSeeMissing: vs.isManagement };
}

/** One person's habits and goals over time. Only for someone the actor may read (or themselves). */
export async function personInsights(actor: Actor, membershipId: string, opts: { weeks?: number; now?: Date } = {}) {
  const vs = await readScope(prisma, actor).catch((e) => { if (membershipId === actor.membershipId) return null; throw e; });
  const base: Prisma.MembershipWhereInput = { organizationId: actor.organizationId, id: membershipId };
  let where: Prisma.MembershipWhereInput;
  let scope: ReadScope;
  if (vs) { where = { AND: [vs.where, base] }; scope = vs; }
  else { where = base; scope = { where: base, isManagement: false, visibility: { scope: "OWN", peersSeeBlockers: false }, blockersFor: () => true, blockerMembershipIds: null }; }
  if (membershipId === actor.membershipId && vs) where = base; // everyone can see themselves
  const weeks = Math.min(Math.max(opts.weeks ?? 12, 4), 26);
  const { people, from, to, today } = await metricsFor(actor, scope, where, weeks, opts.now ?? new Date());
  const p = people[0];
  if (!p) throw notFound("Person");
  // trend: the last 4 weeks against the 4 before
  const rates = p.weekly.map((w) => w.rate);
  const avg = (xs: (number | null)[]) => mean(xs.flatMap((x) => (x === null ? [] : [x])));
  const recent = avg(rates.slice(-4)), before = avg(rates.slice(-8, -4));
  const goals = await listObjectives(actor, { ownerId: membershipId, from: today, to: today }, { now: opts.now });
  const recentUpdates = await prisma.dailyUpdate.findMany({
    where: { organizationId: actor.organizationId, membershipId, status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: from, lte: to } },
    orderBy: { updateDate: "desc" }, take: 8,
    select: { id: true, updateDate: true, hasBlockers: true, submittedLate: true, items: { where: { section: "WORKED_ON" }, orderBy: { position: "asc" }, take: 1, select: { text: true } } },
  });
  const isSelf = membershipId === actor.membershipId;
  return {
    person: p, from, to, weeks, isSelf, trend: { recent, before, delta: recent !== null && before !== null ? Math.round((recent - before) * 10) / 10 : null },
    goals: goals.items.filter((g) => g.ownerId === membershipId),
    recentUpdates: recentUpdates.map((u) => ({ id: u.id, date: u.updateDate, late: u.submittedLate, hasBlockers: scope.blockersFor(membershipId) && u.hasBlockers, preview: u.items[0]?.text ?? "" })),
    canSeeMissing: scope.isManagement || isSelf,
  };
}

