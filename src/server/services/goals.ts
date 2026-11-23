import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import type { Db, Tx } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { readScope, visibleMembershipWhere, scopedTeamIds, type Actor } from "../policy";
import { keyResultProgress, levelRank, quarterOf, rollUp, type Confidence, type GoalNode, type GoalResult, type KrType } from "@/lib/goals";
import { localDay } from "@/lib/dates";
import {
  checkInSchema, keyResultCreateSchema, keyResultUpdateSchema, objectiveCreateSchema, objectiveFilterSchema, objectiveUpdateSchema, taskCreateSchema, taskUpdateSchema,
} from "../validation-goals";

type A = Actor & { userId: string };
type Level = "COMPANY" | "DEPARTMENT" | "TEAM" | "INDIVIDUAL";

// ───────────────────────────── who may do what ─────────────────────────────

/**
 * Goals follow the same transparency rules as updates, with one deliberate difference: COMPANY objectives belong to
 * everyone (the whole company should see how leadership moves it forward). Everything else is visible to the people
 * the visibility setting opens up, to team/department members for team/department objectives, and to the owner's managers.
 */
async function viewer(db: Db, actor: Actor) {
  const me = await db.membership.findFirstOrThrow({ where: { id: actor.membershipId, organizationId: actor.organizationId }, select: { teamId: true, departmentId: true } });
  const isAdmin = actor.role === "ADMIN";
  let readIds: Set<string> | null = null;
  if (!isAdmin) {
    readIds = new Set([actor.membershipId]);
    try { for (const m of await db.membership.findMany({ where: (await readScope(db, actor)).where, select: { id: true } })) readIds.add(m.id); } catch { /* employee with visibility OWN: only themselves */ }
  }
  let managed: Set<string> | null = null; // people the viewer manages (null = everyone, for admins)
  if (!isAdmin) {
    managed = new Set([actor.membershipId]);
    if (actor.role === "MANAGER") for (const m of await db.membership.findMany({ where: await visibleMembershipWhere(db, actor), select: { id: true } })) managed.add(m.id);
  }
  return { actor, me, isAdmin, readIds, managed };
}
type Viewer = Awaited<ReturnType<typeof viewer>>;

type ObjScope = { level: Level; ownerId: string; teamId: string | null; departmentId: string | null };
const canRead = (v: Viewer, o: ObjScope) =>
  v.isAdmin || o.level === "COMPANY" || v.readIds!.has(o.ownerId) ||
  (o.level === "TEAM" && !!o.teamId && o.teamId === v.me.teamId) || (o.level === "DEPARTMENT" && !!o.departmentId && o.departmentId === v.me.departmentId);
/** Edit it, add key results, assign work: admins; the owner; the owner's managers. */
const canManage = (v: Viewer, o: { ownerId: string }) => v.isAdmin || o.ownerId === v.actor.membershipId || v.managed!.has(o.ownerId);

function whereReadable(v: Viewer): Prisma.ObjectiveWhereInput {
  const base = { organizationId: v.actor.organizationId };
  if (v.isAdmin) return base;
  const or: Prisma.ObjectiveWhereInput[] = [{ level: "COMPANY" }, { ownerId: { in: [...v.readIds!] } }];
  if (v.me.teamId) or.push({ level: "TEAM", teamId: v.me.teamId });
  if (v.me.departmentId) or.push({ level: "DEPARTMENT", departmentId: v.me.departmentId });
  return { ...base, OR: or };
}

async function today(db: Db, organizationId: string, now = new Date()) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
  return localDay(now, org.timezone);
}

async function activeMember(db: Db, organizationId: string, id: string, what = "person") {
  const m = await db.membership.findFirst({ where: { id, organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw badRequest(`Choose a ${what} from your organization.`);
}

// ───────────────────────────── read models ─────────────────────────────

const objSelect = {
  id: true, level: true, ownerId: true, departmentId: true, teamId: true, parentId: true, title: true, description: true,
  periodStart: true, periodEnd: true, status: true, createdAt: true, updatedAt: true,
  owner: { select: { user: { select: { name: true } } } }, team: { select: { name: true } }, department: { select: { name: true } },
  keyResults: { select: { id: true, type: true, startValue: true, targetValue: true, currentValue: true, weight: true, confidence: true } },
  tasks: { select: { status: true } },
} satisfies Prisma.ObjectiveSelect;
type ObjRow = Prisma.ObjectiveGetPayload<{ select: typeof objSelect }>;

const toNode = (o: ObjRow): GoalNode => ({
  id: o.id, parentId: o.parentId, status: o.status, periodStart: o.periodStart, periodEnd: o.periodEnd,
  keyResults: o.keyResults.map((k) => ({ progress: keyResultProgress({ ...k, type: k.type as KrType }), weight: k.weight, confidence: k.confidence as Confidence })),
  tasks: { done: o.tasks.filter((t) => t.status === "DONE").length, total: o.tasks.length },
});

export type ObjectiveSummary = ReturnType<typeof summarize>;
function summarize(o: ObjRow, r: GoalResult, v: Viewer) {
  return {
    id: o.id, title: o.title, level: o.level as Level, status: o.status, parentId: o.parentId,
    ownerId: o.ownerId, ownerName: o.owner.user.name, teamName: o.team?.name ?? null, departmentName: o.department?.name ?? null,
    periodStart: o.periodStart, periodEnd: o.periodEnd,
    progress: r.progress, health: r.health, childCount: r.childCount,
    keyResultCount: o.keyResults.length, taskDone: o.tasks.filter((t) => t.status === "DONE").length, taskTotal: o.tasks.length,
    canManage: canManage(v, o),
  };
}

/** Objectives overlapping a period (default: the current quarter), with roll-up computed over EVERYTHING in the company so numbers never depend on who is looking. */
export async function listObjectives(actor: Actor, rawFilters: unknown = {}, opts: { now?: Date } = {}) {
  const f = objectiveFilterSchema.parse(rawFilters);
  const v = await viewer(prisma, actor);
  const day = await today(prisma, actor.organizationId, opts.now);
  const q = quarterOf(day);
  const from = f.from ?? q.start, to = f.to ?? f.from ?? q.end;
  const rows = await prisma.objective.findMany({
    where: { organizationId: actor.organizationId, periodStart: { lte: to }, periodEnd: { gte: from } },
    select: objSelect, orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }],
  });
  const results = rollUp(rows.map(toNode), day);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const wantOwner = f.mine ? actor.membershipId : f.ownerId;
  const matches = (o: ObjRow) => (!f.level || o.level === f.level) && (!wantOwner || o.ownerId === wantOwner);
  const visible = new Set<string>();
  for (const o of rows) {
    if (!canRead(v, o) || !matches(o)) continue;
    visible.add(o.id);
    // keep the readable chain above a match, so the tree hangs together
    for (let p = o.parentId, n = 0; p && byId.has(p) && n < 20; p = byId.get(p)!.parentId, n++) { const po = byId.get(p)!; if (canRead(v, po)) visible.add(p); }
  }
  const items = rows.filter((o) => visible.has(o.id)).map((o) => summarize(o, results.get(o.id)!, v));
  return { period: { from, to, label: from === q.start && to === q.end ? q.label : `${from} – ${to}` }, today: day, items, canCreate: true };
}

async function descendantIds(db: Db, organizationId: string, id: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE d(id) AS (
      SELECT "id" FROM "Objective" WHERE "organizationId" = ${organizationId} AND "parentId" = ${id}
      UNION
      SELECT o."id" FROM "Objective" o JOIN d ON o."parentId" = d.id WHERE o."organizationId" = ${organizationId}
    ) SELECT "id" FROM d`;
  return rows.map((r) => r.id);
}

export async function getObjective(actor: Actor, id: string, opts: { now?: Date } = {}) {
  const v = await viewer(prisma, actor);
  const org = actor.organizationId;
  const row = await prisma.objective.findFirst({ where: { id, organizationId: org }, select: { ...objSelect, createdBy: { select: { user: { select: { name: true } } } } } });
  if (!row || !canRead(v, row)) throw notFound("Goal");
  const day = await today(prisma, org, opts.now);
  const subIds = await descendantIds(prisma, org, id);
  const subtree = await prisma.objective.findMany({ where: { organizationId: org, id: { in: [id, ...subIds] } }, select: objSelect });
  const results = rollUp(subtree.map(toNode), day);
  const kids = subtree.filter((o) => o.parentId === id && canRead(v, o)).map((o) => summarize(o, results.get(o.id)!, v));

  // the readable chain above, nearest last
  const ancestors: { id: string; title: string; level: Level }[] = [];
  for (let p = row.parentId, n = 0; p && n < 20; n++) {
    const a = await prisma.objective.findFirst({ where: { id: p, organizationId: org }, select: { id: true, title: true, level: true, ownerId: true, teamId: true, departmentId: true, parentId: true } });
    if (!a) break;
    if (canRead(v, a)) ancestors.unshift({ id: a.id, title: a.title, level: a.level as Level });
    p = a.parentId;
  }

  const [krs, tasks] = await Promise.all([
    prisma.keyResult.findMany({
      where: { organizationId: org, objectiveId: id }, orderBy: { createdAt: "asc" },
      include: { owner: { select: { user: { select: { name: true } } } }, checkIns: { orderBy: { createdAt: "desc" }, take: 12, include: { author: { select: { user: { select: { name: true } } } } } } },
    }),
    prisma.workTask.findMany({ where: { organizationId: org, objectiveId: id }, orderBy: [{ status: "asc" }, { createdAt: "asc" }], include: { assignee: { select: { user: { select: { name: true } } } } } }),
  ]);
  const manage = canManage(v, row);
  return {
    objective: { ...summarize(row, results.get(id)!, v), description: row.description, createdByName: row.createdBy.user.name, createdAt: row.createdAt.toISOString() },
    ancestors, children: kids, today: day,
    keyResults: krs.map((k) => ({
      id: k.id, title: k.title, type: k.type as KrType, unit: k.unit, isKpi: k.isKpi, weight: k.weight, confidence: k.confidence as Confidence,
      startValue: k.startValue, targetValue: k.targetValue, currentValue: k.currentValue,
      progress: Math.round(keyResultProgress({ ...k, type: k.type as KrType }) * 10) / 10, ownerId: k.ownerId, ownerName: k.owner.user.name,
      lastCheckInAt: k.lastCheckInAt?.toISOString() ?? null,
      canCheckIn: row.status === "ACTIVE" && (manage || k.ownerId === actor.membershipId),
      checkIns: k.checkIns.map((c) => ({ id: c.id, value: c.value, confidence: c.confidence as Confidence, comment: c.comment, authorName: c.author.user.name, createdAt: c.createdAt.toISOString() })),
    })),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, keyResultId: t.keyResultId, assigneeId: t.assigneeId, assigneeName: t.assignee.user.name, dueDate: t.dueDate, doneAt: t.doneAt?.toISOString() ?? null,
      canUpdate: manage || t.assigneeId === actor.membershipId, canDelete: manage || t.createdById === actor.membershipId,
    })),
    canManage: manage,
    canAddTask: manage || canRead(v, row),
    recentWork: await recentWorkOnGoal(actor, id),
  };
}

/** Everything a person owns or has been given: the "My goals" view. */
export async function myGoals(actor: Actor, opts: { now?: Date } = {}) {
  const day = await today(prisma, actor.organizationId, opts.now);
  const [objectives, krs, tasks] = await Promise.all([
    listObjectives(actor, { mine: "1" }, opts),
    prisma.keyResult.findMany({ where: { organizationId: actor.organizationId, ownerId: actor.membershipId, objective: { is: { status: "ACTIVE", periodStart: { lte: day }, periodEnd: { gte: day } } } }, include: { objective: { select: { id: true, title: true } } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.workTask.findMany({ where: { organizationId: actor.organizationId, assigneeId: actor.membershipId, status: { not: "DONE" } }, include: { objective: { select: { id: true, title: true } } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], take: 50 }),
  ]);
  return {
    objectives: objectives.items.filter((o) => o.ownerId === actor.membershipId),
    keyResults: krs.map((k) => ({ id: k.id, title: k.title, objectiveId: k.objective.id, objectiveTitle: k.objective.title, progress: Math.round(keyResultProgress({ ...k, type: k.type as KrType })), confidence: k.confidence as Confidence, isKpi: k.isKpi })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, objectiveId: t.objective.id, objectiveTitle: t.objective.title, overdue: !!t.dueDate && t.dueDate < day })),
    today: day,
  };
}

// ───────────────────────────── objectives ─────────────────────────────

async function assertParentOk(tx: Db, v: Viewer, level: Level, parentId: string, selfId?: string) {
  const p = await tx.objective.findFirst({ where: { id: parentId, organizationId: v.actor.organizationId }, select: { id: true, level: true, status: true, ownerId: true, teamId: true, departmentId: true, parentId: true } });
  if (!p || !canRead(v, p)) throw badRequest("Choose a parent goal from your organization.");
  if (p.status === "CANCELLED") throw badRequest("A cancelled goal can't have goals under it.");
  if (levelRank(p.level as Level) > levelRank(level)) throw badRequest("A goal can only sit under a goal at the same or a higher level (company → department → team → individual).");
  if (selfId) {
    // no loops: the new parent must not be this goal or anything below it
    if (p.id === selfId) throw badRequest("A goal can't be its own parent.");
    for (let c = p.parentId, n = 0; c && n < 50; n++) { if (c === selfId) throw badRequest("That would put a goal under itself."); c = (await tx.objective.findFirst({ where: { id: c, organizationId: v.actor.organizationId }, select: { parentId: true } }))?.parentId ?? null; }
  }
}

export async function createObjective(actor: A, input: unknown) {
  const d = objectiveCreateSchema.parse(input);
  const v = await viewer(prisma, actor);
  const ownerId = d.ownerId ?? actor.membershipId;

  // who may create what
  if (!v.isAdmin) {
    if (d.level === "COMPANY") throw forbidden("Only admins set company goals.");
    if (actor.role === "EMPLOYEE" && (d.level !== "INDIVIDUAL" || ownerId !== actor.membershipId)) throw forbidden("You can add your own individual goals.");
    if (!v.managed!.has(ownerId)) throw forbidden("You can set goals for yourself and the people you manage.");
  }
  return prisma.$transaction(async (tx) => {
    await activeMember(tx, actor.organizationId, ownerId, "owner");
    let teamId: string | null = null, departmentId: string | null = null;
    if (d.level === "TEAM") {
      if (!d.teamId) throw badRequest("Choose the team this goal is for.");
      const t = await tx.team.findFirst({ where: { id: d.teamId, organizationId: actor.organizationId }, select: { id: true, departmentId: true, managerId: true } });
      if (!t) throw badRequest("Choose a team from your organization.");
      // A manager sets goals for teams they manage, teams led by someone in their reporting line, or teams they were granted.
      if (actor.role === "MANAGER" && !(await scopedTeamIds(tx, actor)).includes(t.id) && !(t.managerId && v.managed!.has(t.managerId))) throw forbidden("You can set team goals for the teams you manage.");
      teamId = t.id; departmentId = t.departmentId;
    } else if (d.level === "DEPARTMENT") {
      if (!d.departmentId) throw badRequest("Choose the department this goal is for.");
      if (!(await tx.department.count({ where: { id: d.departmentId, organizationId: actor.organizationId } }))) throw badRequest("Choose a department from your organization.");
      departmentId = d.departmentId;
    }
    if (d.parentId) await assertParentOk(tx, v, d.level, d.parentId);
    const o = await tx.objective.create({
      data: { organizationId: actor.organizationId, level: d.level, ownerId, teamId, departmentId, parentId: d.parentId ?? null, title: d.title, description: d.description || null, periodStart: d.periodStart, periodEnd: d.periodEnd, createdById: actor.membershipId },
      select: { id: true },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.created", entityType: "Objective", entityId: o.id, metadata: { level: d.level, ownerId, parentId: d.parentId ?? null } });
    return { id: o.id };
  });
}

export async function updateObjective(actor: A, id: string, input: unknown) {
  const d = objectiveUpdateSchema.parse(input);
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const o = await tx.objective.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!o || !canRead(v, o)) throw notFound("Goal");
    if (!canManage(v, o)) throw forbidden("You can't change this goal.");
    const start = d.periodStart ?? o.periodStart, end = d.periodEnd ?? o.periodEnd;
    if (start > end) throw badRequest("The end date must be on or after the start date.", { periodEnd: "The end date must be on or after the start date" });
    if (d.ownerId && d.ownerId !== o.ownerId) {
      await activeMember(tx, actor.organizationId, d.ownerId, "owner");
      if (!v.isAdmin && !v.managed!.has(d.ownerId)) throw forbidden("You can hand a goal to yourself or someone you manage.");
    }
    if (d.parentId !== undefined && d.parentId !== o.parentId && d.parentId) await assertParentOk(tx, v, o.level as Level, d.parentId, o.id);
    await tx.objective.update({
      where: { id },
      data: { title: d.title, description: d.description === undefined ? undefined : d.description || null, ownerId: d.ownerId, parentId: d.parentId, periodStart: d.periodStart, periodEnd: d.periodEnd, status: d.status },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.updated", entityType: "Objective", entityId: id, metadata: { changed: Object.keys(d), ...(d.status && d.status !== o.status ? { status: { from: o.status, to: d.status } } : {}) } });
    return { ok: true };
  });
}

export async function deleteObjective(actor: A, id: string) {
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const o = await tx.objective.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!o || !canRead(v, o)) throw notFound("Goal");
    if (!canManage(v, o)) throw forbidden("You can't delete this goal.");
    if (await tx.objective.count({ where: { organizationId: actor.organizationId, parentId: id } })) throw conflict("Move or delete the goals under this one first.");
    await tx.workTask.deleteMany({ where: { organizationId: actor.organizationId, objectiveId: id } });
    await tx.keyResult.deleteMany({ where: { organizationId: actor.organizationId, objectiveId: id } });
    await tx.objective.delete({ where: { id } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.deleted", entityType: "Objective", entityId: id, metadata: { title: o.title, level: o.level } });
    return { ok: true };
  });
}

// ───────────────────────────── key results & check-ins ─────────────────────────────

async function loadObjectiveForEdit(tx: Tx, v: Viewer, objectiveId: string) {
  const o = await tx.objective.findFirst({ where: { id: objectiveId, organizationId: v.actor.organizationId } });
  if (!o || !canRead(v, o)) throw notFound("Goal");
  return o;
}

export async function createKeyResult(actor: A, objectiveId: string, input: unknown) {
  const d = keyResultCreateSchema.parse(input);
  const v = await viewer(prisma, actor);
  const type = d.type;
  const start = type === "BOOLEAN" ? 0 : d.startValue;
  const target = type === "BOOLEAN" ? 1 : d.targetValue;
  if (target === undefined) throw badRequest("Set a target.", { targetValue: "Set a target" });
  if (type !== "BOOLEAN" && target === start) throw badRequest("The target must differ from the starting value.", { targetValue: "Must differ from the start" });
  const current = type === "BOOLEAN" ? 0 : d.currentValue ?? start;
  return prisma.$transaction(async (tx) => {
    const o = await loadObjectiveForEdit(tx, v, objectiveId);
    if (!canManage(v, o)) throw forbidden("You can't add key results to this goal.");
    if (o.status !== "ACTIVE") throw conflict("Only active goals can get new key results.");
    const ownerId = d.ownerId ?? o.ownerId;
    await activeMember(tx, actor.organizationId, ownerId, "owner");
    const kr = await tx.keyResult.create({
      data: { organizationId: actor.organizationId, objectiveId, ownerId, title: d.title, type, startValue: start, targetValue: target, currentValue: current, unit: d.unit || null, isKpi: d.isKpi, weight: d.weight, lastCheckInAt: new Date() },
      select: { id: true },
    });
    await tx.keyResultCheckIn.create({ data: { organizationId: actor.organizationId, keyResultId: kr.id, authorId: actor.membershipId, value: current, confidence: "ON_TRACK", comment: "Created" } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.keyresult.created", entityType: "KeyResult", entityId: kr.id, metadata: { objectiveId, type, isKpi: d.isKpi } });
    return { id: kr.id };
  });
}

async function loadKr(tx: Tx, v: Viewer, id: string) {
  const kr = await tx.keyResult.findFirst({ where: { id, organizationId: v.actor.organizationId }, include: { objective: true } });
  if (!kr || !canRead(v, kr.objective)) throw notFound("Key result");
  return kr;
}

export async function updateKeyResult(actor: A, id: string, input: unknown) {
  const d = keyResultUpdateSchema.parse(input);
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const kr = await loadKr(tx, v, id);
    if (!canManage(v, kr.objective)) throw forbidden("You can't change this key result.");
    const start = d.startValue ?? kr.startValue, target = d.targetValue ?? kr.targetValue;
    if (kr.type !== "BOOLEAN" && start === target) throw badRequest("The target must differ from the starting value.", { targetValue: "Must differ from the start" });
    if (d.ownerId && d.ownerId !== kr.ownerId) await activeMember(tx, actor.organizationId, d.ownerId, "owner");
    await tx.keyResult.update({ where: { id }, data: { title: d.title, startValue: kr.type === "BOOLEAN" ? undefined : d.startValue, targetValue: kr.type === "BOOLEAN" ? undefined : d.targetValue, unit: d.unit === undefined ? undefined : d.unit || null, isKpi: d.isKpi, weight: d.weight, ownerId: d.ownerId } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.keyresult.updated", entityType: "KeyResult", entityId: id, metadata: { changed: Object.keys(d) } });
    return { ok: true };
  });
}

export async function deleteKeyResult(actor: A, id: string) {
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const kr = await loadKr(tx, v, id);
    if (!canManage(v, kr.objective)) throw forbidden("You can't delete this key result.");
    await tx.workTask.updateMany({ where: { organizationId: actor.organizationId, keyResultId: id }, data: { keyResultId: null } });
    await tx.keyResult.delete({ where: { id } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.keyresult.deleted", entityType: "KeyResult", entityId: id, metadata: { title: kr.title, objectiveId: kr.objectiveId } });
    return { ok: true };
  });
}

/** Record progress. Append-only history; the key result's current value and confidence move to the latest reading. */
export async function recordCheckIn(actor: A, keyResultId: string, input: unknown) {
  const d = checkInSchema.parse(input);
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const kr = await loadKr(tx, v, keyResultId);
    if (!(canManage(v, kr.objective) || kr.ownerId === actor.membershipId)) throw forbidden("Only the key result's owner and their managers can record progress.");
    if (kr.objective.status !== "ACTIVE") throw conflict("This goal is no longer active.");
    if (kr.type === "BOOLEAN" && d.value !== 0 && d.value !== 1) throw badRequest("Use 1 for done and 0 for not done.", { value: "Use 1 or 0" });
    const now = new Date();
    const c = await tx.keyResultCheckIn.create({ data: { organizationId: actor.organizationId, keyResultId, authorId: actor.membershipId, value: d.value, confidence: d.confidence, comment: d.comment || null }, select: { id: true } });
    await tx.keyResult.update({ where: { id: keyResultId }, data: { currentValue: d.value, confidence: d.confidence, lastCheckInAt: now } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.checkin", entityType: "KeyResult", entityId: keyResultId, metadata: { from: kr.currentValue, to: d.value, confidence: d.confidence } });
    return { id: c.id, progress: Math.round(keyResultProgress({ type: kr.type as KrType, startValue: kr.startValue, targetValue: kr.targetValue, currentValue: d.value }) * 10) / 10 };
  });
}

// ───────────────────────────── tasks ─────────────────────────────

export async function createTask(actor: A, objectiveId: string, input: unknown) {
  const d = taskCreateSchema.parse(input);
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const o = await loadObjectiveForEdit(tx, v, objectiveId);
    const assigneeId = d.assigneeId ?? actor.membershipId;
    // Owners and their managers can assign work to anyone; anyone who can see the goal can pick up a task for themselves.
    if (!canManage(v, o) && assigneeId !== actor.membershipId) throw forbidden("You can add tasks for yourself.");
    if (o.status !== "ACTIVE") throw conflict("Only active goals can get new tasks.");
    await activeMember(tx, actor.organizationId, assigneeId, "person");
    if (d.keyResultId && !(await tx.keyResult.count({ where: { id: d.keyResultId, objectiveId, organizationId: actor.organizationId } }))) throw badRequest("Choose a key result of this goal.");
    const t = await tx.workTask.create({ data: { organizationId: actor.organizationId, objectiveId, keyResultId: d.keyResultId ?? null, assigneeId, createdById: actor.membershipId, title: d.title, dueDate: d.dueDate ?? null }, select: { id: true } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.task.created", entityType: "WorkTask", entityId: t.id, metadata: { objectiveId, assigneeId } });
    return { id: t.id };
  });
}

export async function updateTask(actor: A, id: string, input: unknown) {
  const d = taskUpdateSchema.parse(input);
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const t = await tx.workTask.findFirst({ where: { id, organizationId: actor.organizationId }, include: { objective: true } });
    if (!t || !canRead(v, t.objective)) throw notFound("Task");
    const manage = canManage(v, t.objective);
    const mine = t.assigneeId === actor.membershipId;
    if (!manage && !mine) throw forbidden("You can't change this task.");
    // an assignee may move their own task along; only owners and managers may re-plan it
    if (!manage && (d.title !== undefined || d.keyResultId !== undefined || d.assigneeId !== undefined || d.dueDate !== undefined)) throw forbidden("You can update the status of your own tasks.");
    if (d.assigneeId && d.assigneeId !== t.assigneeId) await activeMember(tx, actor.organizationId, d.assigneeId, "person");
    if (d.keyResultId && !(await tx.keyResult.count({ where: { id: d.keyResultId, objectiveId: t.objectiveId, organizationId: actor.organizationId } }))) throw badRequest("Choose a key result of this goal.");
    await tx.workTask.update({
      where: { id },
      data: { title: d.title, keyResultId: d.keyResultId, assigneeId: d.assigneeId, dueDate: d.dueDate, status: d.status, doneAt: d.status === undefined ? undefined : d.status === "DONE" ? new Date() : null },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.task.updated", entityType: "WorkTask", entityId: id, metadata: { changed: Object.keys(d) } });
    return { ok: true };
  });
}

export async function deleteTask(actor: A, id: string) {
  const v = await viewer(prisma, actor);
  return prisma.$transaction(async (tx) => {
    const t = await tx.workTask.findFirst({ where: { id, organizationId: actor.organizationId }, include: { objective: true } });
    if (!t || !canRead(v, t.objective)) throw notFound("Task");
    if (!(canManage(v, t.objective) || t.createdById === actor.membershipId)) throw forbidden("You can't delete this task.");
    await tx.workTask.delete({ where: { id } });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "goal.task.deleted", entityType: "WorkTask", entityId: id, metadata: { title: t.title } });
    return { ok: true };
  });
}

/** What the "new goal" form may offer this person: who they can assign to, which levels they may create, teams and departments. */
export async function goalFormOptions(actor: Actor) {
  const v = await viewer(prisma, actor);
  const people = await prisma.membership.findMany({
    where: { organizationId: actor.organizationId, status: "ACTIVE", ...(v.isAdmin ? {} : { id: { in: [...v.managed!] } }) },
    select: { id: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } },
  });
  const [teams, departments] = await Promise.all([
    prisma.team.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true, departmentId: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const levels: Level[] = v.isAdmin ? ["COMPANY", "DEPARTMENT", "TEAM", "INDIVIDUAL"] : actor.role === "MANAGER" ? ["DEPARTMENT", "TEAM", "INDIVIDUAL"] : ["INDIVIDUAL"];
  return { people: people.map((p) => ({ id: p.id, name: p.user.name })), teams, departments, levels, selfId: actor.membershipId };
}

// ───────────────────────────── daily work ↔ goals ─────────────────────────────

/** Replace the goals an update contributes to. Each must be readable by the author and still active (or already linked). */
export async function setUpdateGoalLinks(tx: Tx, actor: Actor, updateId: string, goalIds: string[]) {
  const ids = [...new Set(goalIds)];
  if (ids.length) {
    const v = await viewer(tx, actor);
    const existing = new Set((await tx.updateGoalLink.findMany({ where: { organizationId: actor.organizationId, dailyUpdateId: updateId }, select: { objectiveId: true } })).map((l) => l.objectiveId));
    const found = await tx.objective.findMany({ where: { organizationId: actor.organizationId, id: { in: ids } }, select: { id: true, level: true, ownerId: true, teamId: true, departmentId: true, status: true } });
    const bad = ids.filter((id) => { const o = found.find((f) => f.id === id); return !o || !canRead(v, o) || (o.status !== "ACTIVE" && !existing.has(id)); });
    if (bad.length) throw badRequest("Choose goals you can see that are still active.", { goalIds: "Some goals can't be linked" });
  }
  await tx.updateGoalLink.deleteMany({ where: { organizationId: actor.organizationId, dailyUpdateId: updateId } });
  if (ids.length) await tx.updateGoalLink.createMany({ data: ids.map((objectiveId) => ({ organizationId: actor.organizationId, dailyUpdateId: updateId, objectiveId })) });
}

/** Of these goals, the ones the actor may read (used to show a colleague's update with only the goal tags they could see anyway). */
export async function readableGoals<T extends { id: string }>(actor: Actor, goals: T[]): Promise<T[]> {
  if (goals.length === 0) return goals;
  const v = await viewer(prisma, actor);
  const rows = await prisma.objective.findMany({ where: { organizationId: actor.organizationId, id: { in: goals.map((g) => g.id) } }, select: { id: true, level: true, ownerId: true, teamId: true, departmentId: true } });
  const ok = new Set(rows.filter((o) => canRead(v, o)).map((o) => o.id));
  return goals.filter((g) => ok.has(g.id));
}

/** Goals the actor can tag an update with: active, readable, in play today. Their own first. */
export async function linkableGoals(actor: Actor, opts: { now?: Date } = {}) {
  const day = await today(prisma, actor.organizationId, opts.now);
  const v = await viewer(prisma, actor);
  const rows = await prisma.objective.findMany({
    where: { AND: [whereReadable(v), { status: "ACTIVE", periodStart: { lte: day }, periodEnd: { gte: day } }] },
    select: { id: true, title: true, level: true, ownerId: true }, take: 200,
  });
  return rows.sort((a, b) => (a.ownerId === actor.membershipId ? 0 : 1) - (b.ownerId === actor.membershipId ? 0 : 1) || levelRank(a.level as Level) - levelRank(b.level as Level) || a.title.localeCompare(b.title))
    .map((o) => ({ id: o.id, title: o.title, level: o.level as Level, mine: o.ownerId === actor.membershipId }));
}

/** Recent work that was tagged to a goal, limited to people the viewer may read (plus themselves). */
export async function recentWorkOnGoal(actor: Actor, objectiveId: string, limit = 8) {
  const v = await viewer(prisma, actor);
  const links = await prisma.updateGoalLink.findMany({
    where: {
      organizationId: actor.organizationId, objectiveId,
      dailyUpdate: { is: { status: { in: ["SUBMITTED", "EDITED"] }, ...(v.isAdmin ? {} : { membershipId: { in: [...v.readIds!] } }) } },
    },
    orderBy: { dailyUpdate: { updateDate: "desc" } }, take: limit,
    select: { dailyUpdate: { select: { id: true, updateDate: true, membershipId: true, membership: { select: { user: { select: { name: true } } } }, items: { where: { section: "WORKED_ON" }, orderBy: { position: "asc" }, take: 1, select: { text: true } } } } },
  });
  return links.map((l) => ({ updateId: l.dailyUpdate.id, date: l.dailyUpdate.updateDate, employeeName: l.dailyUpdate.membership.user.name, isOwn: l.dailyUpdate.membershipId === actor.membershipId, preview: l.dailyUpdate.items[0]?.text ?? "" }));
}
