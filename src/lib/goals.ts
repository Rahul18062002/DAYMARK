// Pure goal maths: progress, schedule health and roll-up through the objective tree. No I/O, fully unit-tested.
export type Confidence = "ON_TRACK" | "AT_RISK" | "OFF_TRACK";
export type KrType = "NUMBER" | "PERCENT" | "BOOLEAN";

export const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const RANK: Record<Confidence, number> = { ON_TRACK: 0, AT_RISK: 1, OFF_TRACK: 2 };
export const worstOf = (...c: (Confidence | null | undefined)[]): Confidence => c.reduce<Confidence>((w, x) => (x && RANK[x] > RANK[w] ? x : w), "ON_TRACK");

/** 0–100. Works for targets above or below the start (e.g. "cut churn from 8% to 4%"). */
export function keyResultProgress(kr: { type: KrType; startValue: number; targetValue: number; currentValue: number }): number {
  if (kr.type === "BOOLEAN") return kr.currentValue >= 1 ? 100 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return kr.currentValue === kr.targetValue ? 100 : 0;
  return clamp(((kr.currentValue - kr.startValue) / span) * 100);
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** How far through its period an objective should be today, 0–100. */
export function expectedProgress(periodStart: string, periodEnd: string, today: string): number {
  const s = t(periodStart), e = t(periodEnd), n = t(today);
  if (n <= s) return 0;
  if (n > e) return 100;
  return clamp(((n - s + DAY) / (e - s + DAY)) * 100);
}

/** Behind the clock? More than 15 points → at risk, more than 30 → off track. Past the end and unfinished → off track. */
export function scheduleHealth(progress: number | null, periodStart: string, periodEnd: string, today: string): Confidence {
  if (progress === null) return "ON_TRACK";
  if (today > periodEnd && progress < 100) return "OFF_TRACK";
  const gap = expectedProgress(periodStart, periodEnd, today) - progress;
  return gap > 30 ? "OFF_TRACK" : gap > 15 ? "AT_RISK" : "ON_TRACK";
}

export type GoalNode = {
  id: string; parentId: string | null; status: "ACTIVE" | "DONE" | "CANCELLED"; periodStart: string; periodEnd: string;
  keyResults: { progress: number; weight: number; confidence: Confidence }[];
  tasks: { done: number; total: number };
};
export type GoalResult = { progress: number | null; health: Confidence; childCount: number };

/**
 * Progress and health for every node.
 *  progress = weighted mean of its key results (by weight) and its child objectives (weight 1 each, using their
 *             own rolled-up progress); with neither, the share of finished tasks; with nothing at all, null (unmeasured).
 *  DONE counts as 100%; CANCELLED objectives are left out of their parent's roll-up.
 *  health   = the worst of: key-result confidence, how far behind the calendar it is, and its children's health —
 *             where a child that is off track only makes the parent "at risk", so one struggling individual goal
 *             doesn't paint the whole company red; the parent's own numbers decide if it is truly off track.
 * Cycle-safe: a node is computed once, and a loop in the data cannot recurse forever.
 */
export function rollUp(nodes: GoalNode[], today: string): Map<string, GoalResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, GoalNode[]>();
  for (const n of nodes) if (n.parentId && byId.has(n.parentId)) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n);
  const out = new Map<string, GoalResult>();
  const visiting = new Set<string>();

  const calc = (n: GoalNode): GoalResult => {
    const hit = out.get(n.id); if (hit) return hit;
    if (visiting.has(n.id)) return { progress: null, health: "ON_TRACK", childCount: 0 };
    visiting.add(n.id);
    const children = (kids.get(n.id) ?? []).filter((c) => c.status !== "CANCELLED");
    const childRes = children.map(calc);
    const items: { p: number; w: number }[] = [
      ...n.keyResults.map((k) => ({ p: k.progress, w: Math.max(1, k.weight) })),
      ...childRes.filter((r) => r.progress !== null).map((r) => ({ p: r.progress as number, w: 1 })),
    ];
    let progress: number | null = null;
    if (n.status === "DONE") progress = 100;
    else if (items.length) progress = clamp(items.reduce((s, i) => s + i.p * i.w, 0) / items.reduce((s, i) => s + i.w, 0));
    else if (n.tasks.total > 0) progress = clamp((n.tasks.done / n.tasks.total) * 100);
    const health = n.status === "DONE" || n.status === "CANCELLED"
      ? "ON_TRACK"
      : worstOf(...n.keyResults.map((k) => k.confidence), ...childRes.map((r) => (r.health === "OFF_TRACK" ? "AT_RISK" : r.health)), scheduleHealth(progress, n.periodStart, n.periodEnd, today));
    visiting.delete(n.id);
    const r = { progress: progress === null ? null : Math.round(progress * 10) / 10, health, childCount: children.length };
    out.set(n.id, r);
    return r;
  };
  for (const n of nodes) calc(n);
  return out;
}

/** The first day (YYYY-MM-DD) and last day of the calendar quarter containing `day`. */
export function quarterOf(day: string): { start: string; end: string; label: string } {
  const y = Number(day.slice(0, 4)), q = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  const m0 = q * 3 + 1, last = new Date(Date.UTC(y, m0 + 2, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${p(m0)}-01`, end: `${y}-${p(m0 + 2)}-${p(last)}`, label: `Q${q + 1} ${y}` };
}

export function levelRank(l: "COMPANY" | "DEPARTMENT" | "TEAM" | "INDIVIDUAL"): number {
  return { COMPANY: 0, DEPARTMENT: 1, TEAM: 2, INDIVIDUAL: 3 }[l];
}
