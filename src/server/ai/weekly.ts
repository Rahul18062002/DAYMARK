import { prisma } from "../db";
import { withJobLock } from "../job-lock";
import { AiError, aiConfigured, getAiProvider, type AiProvider } from "./provider";
import { weekOf, scopeKeyOf, type WeekSubject } from "./inputs";
import { generateWeekly } from "../services/summaries";
import { addDays, localDay, zonedTimeToUtc } from "@/lib/dates";

/**
 * Weekly reports, written for the week that just ended. Called by the scheduler every half hour; each pass is a
 * reconciliation ("which reports for last week don't exist yet?"), bounded by a call and time budget, so it can run
 * as often as it likes, be skipped, or overlap without writing anything twice or running up a bill.
 *
 *  - only organizations whose admin opted in to AI (recorded consent) and only when a provider key is configured
 *  - from Monday 07:00 organization time; people first, then teams, departments and finally the company
 *  - a subject with no submitted updates gets no report and costs nothing
 *  - a report that exists in ANY state (draft, published, rejected, edited) is never regenerated here
 *  - a rate-limit answer from the provider stops the whole pass (it resumes at the next one)
 */
export async function runWeeklyReports(opts: { now?: Date; maxCalls?: number; budgetMs?: number; provider?: AiProvider } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.provider && !aiConfigured()) return { skipped: "AI is not configured" as const };
  const provider = opts.provider ?? getAiProvider();
  const maxCalls = opts.maxCalls ?? 30, deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const r = await withJobLock("weekly-reports", 10 * 60_000, async () => {
    const orgs = await prisma.organization.findMany({ where: { settings: { is: { aiEnabled: true, aiConsentAt: { not: null } } } }, select: { id: true, timezone: true }, orderBy: { id: "asc" } });
    const tally = { organizations: orgs.length, created: 0, unchanged: 0, skipped: 0, failed: 0, stoppedEarly: false };
    let calls = 0, consecutiveFailures = 0;
    outer: for (const org of orgs) {
      const today = localDay(now, org.timezone);
      const thisMonday = weekOf(today).start;
      if (now < zonedTimeToUtc(thisMonday, "07:00", org.timezone)) continue;       // Monday before 07:00: not yet
      const week = weekOf(addDays(thisMonday, -1));                                    // the week that just ended

      const have = new Set((await prisma.aiSummary.findMany({ where: { organizationId: org.id, periodStart: week.start, kind: { not: "DAILY_UPDATE" } }, select: { scopeKey: true } })).map((s) => s.scopeKey));
      const active = await prisma.dailyUpdate.groupBy({ by: ["membershipId"], where: { organizationId: org.id, status: { in: ["SUBMITTED", "EDITED"] }, updateDate: { gte: week.start, lte: week.end } } });
      const people = active.map((a) => a.membershipId);
      if (people.length === 0) continue;
      const m = await prisma.membership.findMany({ where: { organizationId: org.id, id: { in: people } }, select: { teamId: true, departmentId: true } });
      const teamIds = [...new Set(m.flatMap((x) => (x.teamId ? [x.teamId] : [])))];
      const deptIds = [...new Set(m.flatMap((x) => (x.departmentId ? [x.departmentId] : [])))];
      const subjects: WeekSubject[] = [
        ...people.map((membershipId): WeekSubject => ({ kind: "PERSON_WEEK", membershipId })),
        ...teamIds.map((teamId): WeekSubject => ({ kind: "TEAM_WEEK", teamId })),
        ...deptIds.map((departmentId): WeekSubject => ({ kind: "DEPARTMENT_WEEK", departmentId })),
        { kind: "COMPANY_WEEK" } as WeekSubject,
      ].filter((s) => !have.has(scopeKeyOf(s)));

      for (const s of subjects) {
        if (calls >= maxCalls || Date.now() > deadline) { tally.stoppedEarly = true; break outer; }
        try {
          const res = await generateWeekly(org.id, s, week, { now, provider });
          if (res.status === "created") { tally.created++; calls++; } else if (res.status === "skipped") tally.skipped++; else tally.unchanged++;
          consecutiveFailures = 0;
        } catch (e) {
          tally.failed++; calls++; consecutiveFailures++;
          console.error("[daymark] weekly report failed:", e instanceof AiError ? e.code : "error");
          if ((e instanceof AiError && e.code === "RATE_LIMITED") || consecutiveFailures >= 5) { tally.stoppedEarly = true; break outer; }
        }
      }
    }
    return tally;
  }, () => now);
  return r.ran ? r.value : { skipped: "another run is in progress" as const };
}
