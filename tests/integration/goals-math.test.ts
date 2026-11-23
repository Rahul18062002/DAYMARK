import { describe, expect, it } from "vitest";
import { expectedProgress, keyResultProgress, levelRank, quarterOf, rollUp, scheduleHealth, worstOf, type GoalNode } from "@/lib/goals";

const node = (o: Partial<GoalNode> & { id: string }): GoalNode => ({ parentId: null, status: "ACTIVE", periodStart: "2026-10-01", periodEnd: "2026-12-31", keyResults: [], tasks: { done: 0, total: 0 }, ...o });
const kr = (progress: number, weight = 1, confidence: "ON_TRACK" | "AT_RISK" | "OFF_TRACK" = "ON_TRACK") => ({ progress, weight, confidence });

describe("key result progress", () => {
  it("measures upward, downward and zero-span targets", () => {
    expect(keyResultProgress({ type: "NUMBER", startValue: 0, targetValue: 200, currentValue: 50 })).toBe(25);
    expect(keyResultProgress({ type: "PERCENT", startValue: 8, targetValue: 4, currentValue: 6 })).toBe(50);     // reduce churn 8% → 4%
    expect(keyResultProgress({ type: "NUMBER", startValue: 10, targetValue: 10, currentValue: 10 })).toBe(100);
    expect(keyResultProgress({ type: "NUMBER", startValue: 10, targetValue: 10, currentValue: 9 })).toBe(0);
  });
  it("clamps, and treats yes/no as 0 or 100", () => {
    expect(keyResultProgress({ type: "NUMBER", startValue: 0, targetValue: 10, currentValue: 25 })).toBe(100);
    expect(keyResultProgress({ type: "NUMBER", startValue: 0, targetValue: 10, currentValue: -5 })).toBe(0);
    expect(keyResultProgress({ type: "BOOLEAN", startValue: 0, targetValue: 1, currentValue: 0 })).toBe(0);
    expect(keyResultProgress({ type: "BOOLEAN", startValue: 0, targetValue: 1, currentValue: 1 })).toBe(100);
  });
});

describe("schedule", () => {
  it("expected progress follows the calendar", () => {
    expect(expectedProgress("2026-10-01", "2026-12-31", "2026-09-30")).toBe(0);
    expect(expectedProgress("2026-10-01", "2026-12-31", "2027-01-01")).toBe(100);
    expect(Math.round(expectedProgress("2026-10-01", "2026-12-31", "2026-11-15"))).toBe(50);
  });
  it("behind by >15 is at risk, >30 off track, ahead is fine, overdue is off track", () => {
    const h = (p: number, today: string) => scheduleHealth(p, "2026-10-01", "2026-12-31", today);
    expect(h(50, "2026-11-15")).toBe("ON_TRACK");
    expect(h(30, "2026-11-15")).toBe("AT_RISK");
    expect(h(10, "2026-11-15")).toBe("OFF_TRACK");
    expect(h(90, "2026-10-20")).toBe("ON_TRACK");
    expect(h(80, "2027-01-02")).toBe("OFF_TRACK");
    expect(h(100, "2027-01-02")).toBe("ON_TRACK");
    expect(scheduleHealth(null, "2026-10-01", "2026-12-31", "2026-12-30")).toBe("ON_TRACK");              // unmeasured is not "off track"
  });
  it("worst-of and levels", () => {
    expect(worstOf("ON_TRACK", "AT_RISK", null, undefined)).toBe("AT_RISK");
    expect(worstOf("AT_RISK", "OFF_TRACK")).toBe("OFF_TRACK");
    expect(levelRank("COMPANY")).toBeLessThan(levelRank("INDIVIDUAL"));
    expect(quarterOf("2026-11-23")).toEqual({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(quarterOf("2026-02-10")).toEqual({ start: "2026-01-01", end: "2026-03-31", label: "Q1 2026" });
  });
});

describe("roll-up through the tree", () => {
  const today = "2026-11-15";
  it("weights key results, rolls children up to the CEO, and keeps unmeasured nodes out of the average", () => {
    const r = rollUp([
      node({ id: "co", keyResults: [] }),
      node({ id: "dept", parentId: "co", keyResults: [kr(100, 1), kr(0, 3)] }),             // weighted: 25
      node({ id: "team", parentId: "co", keyResults: [kr(75)] }),                            // 75
      node({ id: "me", parentId: "team", tasks: { done: 1, total: 4 } }),                    // 25 from tasks
      node({ id: "empty", parentId: "co" }),                                                  // unmeasured: ignored
    ], today);
    expect(r.get("dept")!.progress).toBe(25);
    expect(r.get("me")!.progress).toBe(25);
    expect(r.get("team")!.progress).toBe(50);                                                // (75 + 25) / 2
    expect(r.get("co")!.progress).toBe(37.5);                                                // (25 + 50) / 2
    expect(r.get("empty")!.progress).toBeNull();
    expect(r.get("co")!.childCount).toBe(3);
  });
  it("DONE counts as 100, CANCELLED is ignored by the parent", () => {
    const r = rollUp([
      node({ id: "p" }),
      node({ id: "a", parentId: "p", status: "DONE", keyResults: [kr(10)] }),
      node({ id: "b", parentId: "p", status: "CANCELLED", keyResults: [kr(0)] }),
      node({ id: "c", parentId: "p", keyResults: [kr(50)] }),
    ], today);
    expect(r.get("a")!.progress).toBe(100);
    expect(r.get("p")!.progress).toBe(75);
    expect(r.get("p")!.childCount).toBe(2);
  });
  it("health is the worst of key results, children and the calendar", () => {
    const r = rollUp([
      node({ id: "p", keyResults: [kr(60)] }),
      node({ id: "x", parentId: "p", keyResults: [kr(60, 1, "OFF_TRACK")] }),
      node({ id: "y", keyResults: [kr(5)] }),                                                // 5% at the half-way point
      node({ id: "z", keyResults: [kr(55)] }),
    ], today);
    expect(r.get("x")!.health).toBe("OFF_TRACK");
    expect(r.get("p")!.health).toBe("AT_RISK");                                              // a child off track makes the parent at risk, not off track
    expect(r.get("y")!.health).toBe("OFF_TRACK");
    expect(r.get("z")!.health).toBe("ON_TRACK");
  });
  it("survives a cycle in the data and a dangling parent", () => {
    const r = rollUp([node({ id: "a", parentId: "b", keyResults: [kr(40)] }), node({ id: "b", parentId: "a", keyResults: [kr(60)] }), node({ id: "c", parentId: "ghost", keyResults: [kr(10)] })], today);
    expect(r.size).toBe(3);
    expect(r.get("c")!.progress).toBe(10);
  });
  it("rolls up a large tree quickly", () => {
    const nodes = [node({ id: "root" })];
    for (let i = 0; i < 3000; i++) nodes.push(node({ id: `n${i}`, parentId: i < 50 ? "root" : `n${i % 50}`, keyResults: [kr(i % 100)] }));
    const t0 = Date.now(); rollUp(nodes, today);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
