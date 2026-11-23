import { prisma } from "../db";
import { forbidden } from "../errors";
import { readScope, type Actor } from "../policy";
import { localDay } from "@/lib/dates";

export type OrgNode = {
  id: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  jobTitle: string | null;
  level: number | null;
  teamName: string | null;
  departmentName: string | null;
  mentorName: string | null;
  isSelf: boolean;
  /** Everyone below this person that the viewer may see (all depths). */
  reportCount: number;
  /** Did they submit today? Only managers and admins get this; everyone else gets null. */
  submittedToday: boolean | null;
  children: OrgNode[];
};

/**
 * The reporting tree, as far as the viewer may see it:
 *  - Admin: the whole company.
 *  - Others: their own chain up to the top, plus everyone their organization's visibility setting (and their own
 *    reporting line) lets them read. A person whose manager is outside the viewer's view appears as a top-level node.
 * Several top-level people are normal (a founder and a CEO, or a company with separate leadership groups).
 */
export async function orgTree(actor: Actor, opts: { now?: Date } = {}) {
  const base = { organizationId: actor.organizationId, status: "ACTIVE" as const };
  const [org, people] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } }),
    prisma.membership.findMany({
      where: base,
      select: {
        id: true, role: true, jobTitle: true, level: true, managerId: true,
        user: { select: { name: true } }, team: { select: { name: true } }, department: { select: { name: true } }, mentor: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(actor.membershipId)) throw forbidden();

  // Who may the viewer see? Admin: all. Otherwise the read scope (if their company opened any), plus their own chain upward.
  let allowed: Set<string>;
  let showSubmitted = false;
  if (actor.role === "ADMIN") { allowed = new Set(byId.keys()); showSubmitted = true; }
  else {
    allowed = new Set([actor.membershipId]);
    try {
      const vs = await readScope(prisma, actor);
      for (const m of await prisma.membership.findMany({ where: { AND: [vs.where, { status: "ACTIVE" }] }, select: { id: true } })) allowed.add(m.id);
      showSubmitted = vs.isManagement;
    } catch { /* an employee in a company with visibility OWN sees only their own chain */ }
    // their own chain up to the top (cycle-safe: stop at the first repeat)
    for (let cur = byId.get(actor.membershipId)?.managerId, hops = 0; cur && byId.has(cur) && hops < 100; cur = byId.get(cur)!.managerId, hops++) allowed.add(cur);
  }

  let submitted = new Set<string>();
  if (showSubmitted) {
    const today = localDay(opts.now ?? new Date(), org.timezone);
    const rows = await prisma.dailyUpdate.findMany({ where: { organizationId: actor.organizationId, updateDate: today, status: { in: ["SUBMITTED", "EDITED"] } }, select: { membershipId: true } });
    submitted = new Set(rows.map((r) => r.membershipId));
  }

  const kids = new Map<string | null, string[]>();
  for (const id of allowed) {
    const p = byId.get(id)!;
    const parent = p.managerId && allowed.has(p.managerId) ? p.managerId : null;
    (kids.get(parent) ?? kids.set(parent, []).get(parent)!).push(id);
  }
  const seen = new Set<string>();
  const build = (id: string): OrgNode => {
    seen.add(id);
    const p = byId.get(id)!;
    const children = (kids.get(id) ?? []).filter((c) => !seen.has(c)).map(build).sort((a, b) => a.name.localeCompare(b.name));
    return {
      id, name: p.user.name, role: p.role, jobTitle: p.jobTitle, level: p.level, teamName: p.team?.name ?? null, departmentName: p.department?.name ?? null,
      mentorName: p.mentor?.user.name ?? null, isSelf: id === actor.membershipId,
      reportCount: children.reduce((n, c) => n + 1 + c.reportCount, 0),
      submittedToday: showSubmitted ? submitted.has(id) : null, children,
    };
  };
  // Roots: people whose manager is not visible. Highest level of the tree first (more reports, then name).
  const roots = (kids.get(null) ?? []).map(build).sort((a, b) => b.reportCount - a.reportCount || a.name.localeCompare(b.name));
  return { roots, total: allowed.size, restricted: actor.role !== "ADMIN" };
}
