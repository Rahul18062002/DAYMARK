import { createHash } from "node:crypto";
import { prisma } from "../db";
import { goalSnapshot } from "../services/goals";
import { addDays, daysBetween, isoWeekday, weekStart } from "@/lib/dates";
import { parseWorkingDays } from "@/lib/working-days";
import { sanitizeForPrompt, SYSTEM_PROMPT, type SummaryContent } from "./prompts";

export type WeekSubject =
  | { kind: "PERSON_WEEK"; membershipId: string }
  | { kind: "TEAM_WEEK"; teamId: string }
  | { kind: "DEPARTMENT_WEEK"; departmentId: string }
  | { kind: "COMPANY_WEEK" };

export const scopeKeyOf = (s: WeekSubject) =>
  s.kind === "PERSON_WEEK" ? `person:${s.membershipId}` : s.kind === "TEAM_WEEK" ? `team:${s.teamId}` : s.kind === "DEPARTMENT_WEEK" ? `dept:${s.departmentId}` : "company";

/** Monday–Sunday containing `day`. */
export const weekOf = (day: string) => { const start = weekStart(day); return { start, end: addDays(start, 6) }; };

const SECTION_LABEL = { WORKED_ON: "worked on", COMPLETED: "completed", PENDING: "pending", BLOCKER: "blockers", NEXT_PRIORITY: "next" } as const;
const PER_PERSON_CHARS = 1800, TOTAL_CHARS = 22_000;

export type BuiltInput = {
  title: string; user: string; inputHash: string; sourceCount: number;
  stats: { people: number; expected: number; submitted: number; late: number; withBlockers: number };
};

const hash = (model: string, user: string) => createHash("sha256").update(`${model}\n${SYSTEM_PROMPT}\n${user}`).digest("hex");

async function memberDigest(organizationId: string, ids: string[], from: string, to: string) {
  const members = await prisma.membership.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, jobTitle: true, user: { select: { name: true } } } });
  const updates = await prisma.dailyUpdate.findMany({
    where: { organizationId, membershipId: { in: ids }, status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: from, lte: to } },
    orderBy: { updateDate: "asc" },
    select: { membershipId: true, updateDate: true, submittedLate: true, hasBlockers: true, items: { orderBy: [{ section: "asc" }, { position: "asc" }], select: { section: true, text: true } } },
  });
  const byPerson = new Map<string, typeof updates>();
  for (const u of updates) (byPerson.get(u.membershipId) ?? byPerson.set(u.membershipId, []).get(u.membershipId)!).push(u);
  let total = 0;
  const blocks: string[] = [];
  for (const m of [...members].sort((a, b) => a.user.name.localeCompare(b.user.name))) {
    const ups = byPerson.get(m.id) ?? [];
    if (ups.length === 0) continue;
    let block = `${sanitizeForPrompt(m.user.name, 80)}${m.jobTitle ? `, ${sanitizeForPrompt(m.jobTitle, 60)}` : ""} (${ups.length} update${ups.length === 1 ? "" : "s"}):\n`;
    for (const u of ups) {
      const by: Record<string, string[]> = {};
      for (const it of u.items) (by[it.section] ??= []).length < 4 && by[it.section].push(sanitizeForPrompt(it.text, 240));
      block += `  ${u.updateDate}: ${Object.entries(by).map(([k, v]) => `${SECTION_LABEL[k as keyof typeof SECTION_LABEL]}: ${v.join(" | ")}`).join("; ")}\n`;
    }
    block = block.slice(0, PER_PERSON_CHARS);
    if (total + block.length > TOTAL_CHARS) { blocks.push("(more people omitted to keep this short)"); break; }
    total += block.length; blocks.push(block);
  }
  return { blocks, updates, memberCount: members.length };
}

async function weekStats(organizationId: string, ids: string[], from: string, to: string, workDays: number[], updates: { submittedLate: boolean; hasBlockers: boolean }[]) {
  const days = daysBetween(from, to).filter((d) => workDays.includes(isoWeekday(d))).length;
  return { people: ids.length, expected: ids.length * days, submitted: updates.length, late: updates.filter((u) => u.submittedLate).length, withBlockers: updates.filter((u) => u.hasBlockers).length };
}

const goalLines = (g: Awaited<ReturnType<typeof goalSnapshot>>) =>
  g.length === 0 ? "No goals recorded." : g.map((x) => `- [${x.level.toLowerCase()}] ${sanitizeForPrompt(x.title, 160)} (owner ${sanitizeForPrompt(x.ownerName, 60)}): ${x.progress === null ? "not measured yet" : `${Math.round(x.progress)}% done, ${x.health.replace("_", " ").toLowerCase()}`}`).join("\n");

const childLines = (rows: { title: string; content: unknown }[]) =>
  rows.map((r) => { const c = r.content as SummaryContent; return `${sanitizeForPrompt(r.title, 120)}: ${sanitizeForPrompt(c.headline, 200)}. ${sanitizeForPrompt(c.summary, 700)}${c.blockers.length ? ` Blockers reported: ${c.blockers.map((b) => sanitizeForPrompt(b, 160)).join(" | ")}` : ""}`; }).join("\n");

/**
 * The exact prompt for one weekly report, or null when there is nothing to report (nobody submitted anything).
 *  person / team: the people's own updates for the week
 *  department / company: the reports of the teams (departments) below, so a leader's report is built from the same facts
 *  Daymark-computed facts and goal progress go in alongside; the model never has to count anything.
 */
export async function buildWeeklyInput(organizationId: string, subject: WeekSubject, week: { start: string; end: string }, model: string, now: Date): Promise<BuiltInput | null> {
  const end = week.end;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { settings: true } });
  const workDays = parseWorkingDays(org.settings?.workingDays);
  const headerOf = (title: string) => `Weekly report: ${sanitizeForPrompt(title, 160)}\nOrganization: ${sanitizeForPrompt(org.name, 100)}\nWeek: ${week.start} to ${end} (${org.timezone})`;
  const goalDay = end < now.toISOString().slice(0, 10) ? end : now.toISOString().slice(0, 10) < week.start ? week.start : now.toISOString().slice(0, 10);
  const wrap = (title: string, stats: BuiltInput["stats"], goals: string, body: string): BuiltInput | null => {
    if (stats.submitted === 0 && !body.trim()) return null;
    const user = `${headerOf(title)}\n\nFacts computed by Daymark (reliable):\n- ${stats.people} people, ${stats.submitted} updates submitted of about ${stats.expected} expected, ${stats.late} late, ${stats.withBlockers} mentioning blockers.\n\nGoals (Daymark data, as of now):\n${goals}\n\n<data>\n${body}\n</data>`;
    return { title, user, inputHash: hash(model, user), sourceCount: stats.submitted, stats };
  };

  if (subject.kind === "PERSON_WEEK" || subject.kind === "TEAM_WEEK") {
    let ids: string[], title: string, goals: Awaited<ReturnType<typeof goalSnapshot>>;
    if (subject.kind === "PERSON_WEEK") {
      const m = await prisma.membership.findFirst({ where: { id: subject.membershipId, organizationId }, select: { id: true, user: { select: { name: true } } } });
      if (!m) return null;
      ids = [m.id]; title = `${m.user.name}: week of ${week.start}`;
      goals = await goalSnapshot(organizationId, { ownerIds: ids, day: goalDay });
    } else {
      const t = await prisma.team.findFirst({ where: { id: subject.teamId, organizationId }, select: { id: true, name: true } });
      if (!t) return null;
      ids = (await prisma.membership.findMany({ where: { organizationId, teamId: t.id, status: "ACTIVE" }, select: { id: true } })).map((m) => m.id);
      title = `${t.name} team: week of ${week.start}`;
      goals = await goalSnapshot(organizationId, { teamId: t.id, ownerIds: ids, day: goalDay });
    }
    const d = await memberDigest(organizationId, ids, week.start, end);
    return wrap(title, await weekStats(organizationId, ids, week.start, end, workDays, d.updates), goalLines(goals), d.blocks.join("\n"));
  }

  // department / company: built from the reports of the groups below
  if (subject.kind === "DEPARTMENT_WEEK") {
    const dept = await prisma.department.findFirst({ where: { id: subject.departmentId, organizationId }, select: { id: true, name: true, teams: { select: { id: true } } } });
    if (!dept) return null;
    const ids = (await prisma.membership.findMany({ where: { organizationId, departmentId: dept.id, status: "ACTIVE" }, select: { id: true } })).map((m) => m.id);
    const children = await prisma.aiSummary.findMany({ where: { organizationId, kind: "TEAM_WEEK", periodStart: week.start, status: { not: "REJECTED" }, teamId: { in: dept.teams.map((t) => t.id) } }, select: { title: true, content: true }, orderBy: { title: "asc" } });
    const d = await memberDigest(organizationId, ids, week.start, end);
    const body = children.length ? childLines(children) : d.blocks.join("\n");
    return wrap(`${dept.name} department: week of ${week.start}`, await weekStats(organizationId, ids, week.start, end, workDays, d.updates), goalLines(await goalSnapshot(organizationId, { departmentId: dept.id, ownerIds: ids, day: goalDay })), body);
  }
  const ids = (await prisma.membership.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true } })).map((m) => m.id);
  const children = await prisma.aiSummary.findMany({ where: { organizationId, kind: { in: ["DEPARTMENT_WEEK", "TEAM_WEEK"] }, periodStart: week.start, status: { not: "REJECTED" } }, select: { title: true, content: true, kind: true, team: { select: { departmentId: true } } }, orderBy: [{ kind: "asc" }, { title: "asc" }] });
  // departments, plus teams that belong to no department (their reports would otherwise be lost)
  const useful = children.filter((c) => c.kind === "DEPARTMENT_WEEK" || !c.team?.departmentId);
  const d = await memberDigest(organizationId, ids.slice(0, 400), week.start, end);
  return wrap(`${sanitizeForPrompt(org.name, 100)}: week of ${week.start}`, await weekStats(organizationId, ids, week.start, end, workDays, d.updates), goalLines(await goalSnapshot(organizationId, { company: true, day: goalDay })), useful.length ? childLines(useful) : d.blocks.join("\n"));
}

/** Prompt for a single daily update. */
export async function buildDailyInput(organizationId: string, updateId: string, model: string): Promise<(BuiltInput & { membershipId: string; updateDate: string }) | null> {
  const u = await prisma.dailyUpdate.findFirst({
    where: { id: updateId, organizationId, status: { in: ["SUBMITTED", "EDITED"] } },
    select: { membershipId: true, updateDate: true, items: { orderBy: [{ section: "asc" }, { position: "asc" }], select: { section: true, text: true } }, membership: { select: { user: { select: { name: true } } } } },
  });
  if (!u || u.items.length === 0) return null;
  const by: Record<string, string[]> = {};
  for (const it of u.items) (by[it.section] ??= []).length < 6 && by[it.section].push(sanitizeForPrompt(it.text, 400));
  const body = Object.entries(by).map(([k, v]) => `${SECTION_LABEL[k as keyof typeof SECTION_LABEL]}: ${v.join(" | ")}`).join("\n");
  const title = `${u.membership.user.name}: ${u.updateDate}`;
  const user = `Summarize this one daily update by ${sanitizeForPrompt(u.membership.user.name, 80)} for ${u.updateDate}. Keep the summary to 1-2 sentences.\n\n<data>\n${body}\n</data>`;
  return { title, user, inputHash: hash(model, user), sourceCount: 1, stats: { people: 1, expected: 1, submitted: 1, late: 0, withBlockers: 0 }, membershipId: u.membershipId, updateDate: u.updateDate };
}
