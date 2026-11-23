import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { IntegrationEventType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { createUpdate, updateUpdate } from "@/server/services/updates";
import { createTeam } from "@/server/services/structure";
import { updateMember } from "@/server/services/members";
import { decryptSecret, encryptSecret, flowKey } from "@/server/integrations/viasocket/crypto";
import { EVENT_CATALOG, enqueueEvent, eventIdFor, eventKeys, samplePayload } from "@/server/integrations/viasocket/events";
import {
  MAX_ATTEMPTS, RETRY_DELAYS_MS, processDelivery, purgeOldIntegrationData, setDispatchDepsForTests, sweepDeliveries,
} from "@/server/integrations/viasocket/dispatch";
import { runMissingUpdateCheck } from "@/server/integrations/viasocket/missing";
import { updateSettings } from "@/server/services/organization";
import { runReminderCheck } from "@/server/integrations/viasocket/reminders";
import { runIntegrationCron } from "@/server/integrations/viasocket/cron";
import { withJobLock } from "@/server/job-lock";
import { automationsAccess } from "@/server/integrations/viasocket/access";
import { linkFlow, sendTestEvent, syncFlows } from "@/server/integrations/viasocket/flows";
import { listAttempts, listRecentDeliveries } from "@/server/integrations/viasocket/deliveries";
import { getAutomationSettings, updateAutomationSettings } from "@/server/integrations/viasocket/settings";
import { setGatewayForTests, type FlowSummary } from "@/server/integrations/viasocket/gateway";
import { GET as cronGET } from "@/app/api/cron/integrations/route";
import { EVENT_FIELDS } from "@/server/integrations/viasocket/event-docs";
import { addMember, makeOrg, uid, type TestCtx } from "./helpers";

const NOW = new Date("2026-11-13T09:00:00Z"); // Friday 14:30 in Asia/Kolkata (the test orgs' timezone)
const AFTER_CUTOFF = new Date("2026-11-13T12:31:00Z"); // 18:01 IST
const BEFORE_CUTOFF = new Date("2026-11-13T11:00:00Z"); // 16:30 IST

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

const RUN_URL = (id = uid()) => `https://flow.sokt.io/func/scri${id}`;

async function makeFlow(organizationId: string, eventType: IntegrationEventType | null, o: { status?: string; url?: string } = {}) {
  const url = o.url ?? RUN_URL();
  return prisma.automationFlow.create({
    data: { organizationId, flowKey: flowKey(url), urlEnc: encryptSecret(url), title: `Flow ${uid()}`, status: o.status ?? "active", eventType },
  });
}

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string>; redirect?: string };
function fakeFetch(plan: Array<number | Error | { status: number; body: string }> | ((n: number) => number | Error | { status: number; body: string })) {
  const calls: Call[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    const n = calls.length;
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>, redirect: init?.redirect });
    const step = typeof plan === "function" ? plan(n) : (plan[Math.min(n, plan.length - 1)] ?? 200);
    if (step instanceof Error) throw step;
    const s = typeof step === "number" ? { status: step, body: "" } : step;
    return new Response(s.body, { status: s.status });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const samplePayloadFor = (type: IntegrationEventType) => (eventId: string) => samplePayload(type, eventId, "Acme", NOW);

/** One event with deliveries to every active flow linked to `type`. */
async function makeEvent(organizationId: string, type: IntegrationEventType, key = `k:${uid()}`) {
  const r = await enqueueEvent({ organizationId, type, eventKey: key, payload: samplePayloadFor(type), now: NOW });
  expect(r.created).toBe(true);
  const deliveries = await prisma.integrationDelivery.findMany({ where: { integrationEventId: r.integrationEventId! }, orderBy: { createdAt: "asc" } });
  return { ...r, deliveries };
}

const waitFor = async <T,>(fn: () => Promise<T | null | false | undefined>, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 40));
  }
};

async function backdate(organizationId: string) {
  await prisma.membership.updateMany({ where: { organizationId }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
}

const events = (organizationId: string) => prisma.integrationEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });

beforeEach(() => setDispatchDepsForTests({ fetch: fakeFetch([200]).fetch })); // hook-driven background delivery never touches the network
afterEach(() => { setDispatchDepsForTests(undefined); setGatewayForTests(undefined); });

// ── A. secrets at rest ─────────────────────────────────────────────────────────────────────────
describe("A. Flow URLs are credentials: encrypted at rest", () => {
  it("round-trips, never stores the URL in clear, and rejects tampering", () => {
    const url = RUN_URL("secretid1234");
    const enc = encryptSecret(url);
    expect(enc).not.toContain("secretid1234");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc)).toBe(url);
    expect(encryptSecret(url)).not.toBe(enc); // fresh IV each time
    const parts = enc.split(".");
    const bad = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".");
    expect(() => decryptSecret(bad)).toThrow();
    expect(() => decryptSecret("garbage")).toThrow();
  });
  it("derives a stable keyed hash for flow ids (not the id itself)", () => {
    expect(flowKey("abc")).toBe(flowKey("abc"));
    expect(flowKey("abc")).not.toBe(flowKey("abd"));
    expect(flowKey("abc")).not.toContain("abc");
  });
});

// ── B/C. stable event IDs and idempotent enqueue ───────────────────────────────────────────────
describe("B. Stable event IDs and idempotent, duplicate-safe enqueueing", () => {
  it("event IDs are deterministic per (organization, event key) and differ across both", () => {
    expect(eventIdFor("o1", "k")).toBe(eventIdFor("o1", "k"));
    expect(eventIdFor("o1", "k")).not.toBe(eventIdFor("o2", "k"));
    expect(eventIdFor("o1", "k")).not.toBe(eventIdFor("o1", "k2"));
    expect(eventIdFor("o1", "k")).toMatch(/^evt_[0-9a-f]{32}$/);
  });

  it("creates one event and one delivery per active linked flow; a repeat changes nothing", async () => {
    const { organizationId } = await makeOrg();
    const f1 = await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const f2 = await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await makeFlow(organizationId, "UPDATE_SUBMITTED", { status: "paused" }); // ignored
    await makeFlow(organizationId, "UPDATE_MISSING"); // other event type: ignored
    await makeFlow(organizationId, null); // unlinked: ignored
    const key = eventKeys.submitted("upd-1");
    const a = await enqueueEvent({ organizationId, type: "UPDATE_SUBMITTED", eventKey: key, payload: samplePayloadFor("UPDATE_SUBMITTED") });
    const b = await enqueueEvent({ organizationId, type: "UPDATE_SUBMITTED", eventKey: key, payload: samplePayloadFor("UPDATE_SUBMITTED") });
    expect(a).toMatchObject({ created: true, deliveries: 2 });
    expect(b).toMatchObject({ created: false, deliveries: 0 });
    const evs = await events(organizationId);
    expect(evs).toHaveLength(1);
    expect(evs[0].eventId).toBe(eventIdFor(organizationId, key));
    expect((evs[0].payload as { eventId: string }).eventId).toBe(evs[0].eventId); // the ID inside the payload is the same stable ID
    const d = await prisma.integrationDelivery.findMany({ where: { integrationEventId: evs[0].id } });
    expect(d.map((x) => x.automationFlowId).sort()).toEqual([f1.id, f2.id].sort());
  });

  it("stores nothing when nobody is listening", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_MISSING");
    const r = await enqueueEvent({ organizationId, type: "UPDATE_SUBMITTED", eventKey: "x:1", payload: samplePayloadFor("UPDATE_SUBMITTED") });
    expect(r).toEqual({ created: false, integrationEventId: null, deliveries: 0 });
    expect(await events(organizationId)).toHaveLength(0);
  });

  it("20 simultaneous identical emissions produce exactly one event and one delivery", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_BLOCKER_REPORTED");
    const rs = await Promise.all(Array.from({ length: 20 }, () => enqueueEvent({ organizationId, type: "UPDATE_BLOCKER_REPORTED", eventKey: "race:1", payload: samplePayloadFor("UPDATE_BLOCKER_REPORTED") })));
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(await events(organizationId)).toHaveLength(1);
    expect(await prisma.integrationDelivery.count({ where: { organizationId } })).toBe(1);
  });

  it("a flow linked AFTER an event was created is not retroactively delivered the old event", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await enqueueEvent({ organizationId, type: "UPDATE_SUBMITTED", eventKey: "old:1", payload: samplePayloadFor("UPDATE_SUBMITTED") });
    const late = await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await enqueueEvent({ organizationId, type: "UPDATE_SUBMITTED", eventKey: "old:1", payload: samplePayloadFor("UPDATE_SUBMITTED") });
    expect(await prisma.integrationDelivery.count({ where: { automationFlowId: late.id } })).toBe(0);
  });
});

// ── D. the real triggers: updates service → events ─────────────────────────────────────────────
describe("D. Update events: when they fire, what they contain, what they never contain", () => {
  async function scenario(opts: { blockerText?: boolean } = {}) {
    const { admin, organizationId } = await makeOrg("Pulse");
    const mgr = (await addMember(admin, "MANAGER", { name: "Mona Manager" })).ctx;
    const team = await createTeam(admin, { name: "Alpha", managerId: mgr.membershipId });
    const emp = (await addMember(admin, "EMPLOYEE", { teamId: team.id, name: "Eddie Employee" })).ctx;
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await makeFlow(organizationId, "UPDATE_BLOCKER_REPORTED");
    if (opts.blockerText) await updateAutomationSettings(admin, { includeBlockerText: true });
    return { admin, mgr, emp, organizationId };
  }
  const evOf = async (organizationId: string, name: string) =>
    waitFor(async () => (await events(organizationId)).find((e) => (e.payload as { eventType?: string })?.eventType === name));

  it("submit with a blocker → one submitted + one blocker event, minimal payloads, link-only blocker by default", async () => {
    const s = await scenario();
    const secret = "CONFIDENTIAL: renegotiating the Initech contract";
    const { id } = await createUpdate(s.emp, { sections: { workedOn: [secret], completed: ["Private win"], blockers: ["Waiting on legal sign-off for the secret deal"] }, submit: true, links: [{ url: "https://docs.example.com/private" }] }, { now: NOW });
    const sub = await evOf(s.organizationId, "update.submitted");
    const blk = await evOf(s.organizationId, "update.blocker_reported");
    expect(sub.eventId).toBe(eventIdFor(s.organizationId, eventKeys.submitted(id)));
    expect(blk.eventId).toBe(eventIdFor(s.organizationId, eventKeys.blocker(id)));

    const p = sub.payload as Record<string, any>;
    expect(p).toMatchObject({ schemaVersion: 1, test: false, organization: { name: expect.stringContaining("Pulse") }, employee: { name: "Eddie Employee", team: "Alpha" }, manager: { name: "Mona Manager", email: s.mgr.userEmail } });
    expect(p.update).toMatchObject({ date: "2026-11-13", isLate: false, hasBlockers: true });
    expect(p.update.url).toMatch(new RegExp(`/team-updates/${id}$`));
    const q = blk.payload as Record<string, any>;
    expect(q.blocker).toEqual({ count: 1 }); // text OFF by default
    // Data minimisation: nothing the employee wrote and no employee email leaves Daymark.
    for (const ev of [sub, blk]) {
      const json = JSON.stringify(ev.payload);
      expect(json).not.toContain("CONFIDENTIAL");
      expect(json).not.toContain("Private win");
      expect(json).not.toContain("legal sign-off");
      expect(json).not.toContain("docs.example.com");
      expect(json).not.toContain(s.emp.userEmail);
    }
  });

  it("when the company opts in, the first blocker's text is included, truncated to 280 chars", async () => {
    const s = await scenario({ blockerText: true });
    const long = "B".repeat(400);
    await createUpdate(s.emp, { sections: { workedOn: ["w"], blockers: [long, "second"] }, submit: true }, { now: NOW });
    const blk = await evOf(s.organizationId, "update.blocker_reported");
    const b = (blk.payload as any).blocker;
    expect(b.count).toBe(2);
    expect(b.text).toHaveLength(280);
    expect(b.text.endsWith("…")).toBe(true);
  });

  it("'None' / 'N/A' is not a blocker; no blocker event", async () => {
    const s = await scenario();
    await createUpdate(s.emp, { sections: { workedOn: ["w"], blockers: ["None"] }, submit: true }, { now: NOW });
    await evOf(s.organizationId, "update.submitted");
    await new Promise((r) => setTimeout(r, 300));
    expect((await events(s.organizationId)).map((e) => e.type)).toEqual(["UPDATE_SUBMITTED"]);
  });

  it("an edit that ADDS a blocker fires the blocker event once; later edits and edits in general never re-fire submitted", async () => {
    const s = await scenario();
    const { id } = await createUpdate(s.emp, { sections: { workedOn: ["w"] }, submit: true }, { now: NOW });
    await evOf(s.organizationId, "update.submitted");
    await updateUpdate(s.emp, id, { sections: { workedOn: ["w"], blockers: ["Server access is blocked"] } }, { now: new Date(NOW.getTime() + 3600_000) });
    await evOf(s.organizationId, "update.blocker_reported");
    await updateUpdate(s.emp, id, { sections: { workedOn: ["w"], blockers: ["Server access is blocked", "another"] } }, { now: new Date(NOW.getTime() + 7200_000) });
    await updateUpdate(s.emp, id, { sections: { workedOn: ["w2"], blockers: ["Server access is blocked", "another"] } }, { now: new Date(NOW.getTime() + 8000_000) });
    await new Promise((r) => setTimeout(r, 400));
    expect((await events(s.organizationId)).map((e) => e.type).sort()).toEqual(["UPDATE_BLOCKER_REPORTED", "UPDATE_SUBMITTED"]);
  });

  it("drafts emit nothing; draft → submit emits", async () => {
    const s = await scenario();
    const { id } = await createUpdate(s.emp, { sections: { workedOn: ["draft"], blockers: ["real blocker"] } }, { now: NOW });
    await updateUpdate(s.emp, id, { sections: { workedOn: ["still draft"], blockers: ["real blocker"] } }, { now: NOW });
    await new Promise((r) => setTimeout(r, 300));
    expect(await events(s.organizationId)).toHaveLength(0);
    await updateUpdate(s.emp, id, { submit: true }, { now: NOW });
    await evOf(s.organizationId, "update.submitted");
    await evOf(s.organizationId, "update.blocker_reported");
  });

  it("no manager → manager is null; deactivated manager is not used", async () => {
    const { admin, organizationId } = await makeOrg();
    const emp = (await addMember(admin, "EMPLOYEE", { name: "Solo" })).ctx;
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await createUpdate(emp, { sections: { workedOn: ["w"] }, submit: true }, { now: NOW });
    const ev = await evOf(organizationId, "update.submitted");
    expect((ev.payload as any).manager).toBeNull();
    const mgr = (await addMember(admin, "MANAGER")).ctx;
    await updateMember(admin, emp.membershipId, { managerId: mgr.membershipId });
    await updateMember(admin, mgr.membershipId, { status: "DEACTIVATED" });
    const emp2 = (await addMember(admin, "EMPLOYEE", { managerId: undefined })).ctx;
    await prisma.membership.update({ where: { id: emp2.membershipId }, data: { managerId: mgr.membershipId } });
    await createUpdate(emp2, { sections: { workedOn: ["w"] }, submit: true }, { now: NOW });
    await waitFor(async () => (await events(organizationId)).length === 2);
    const second = (await events(organizationId))[1];
    expect((second.payload as any).manager).toBeNull();
  });

  it("an event pipeline failure can NEVER fail or change the core update", async () => {
    const s = await scenario();
    // Break the event layer: corrupt the stored flow URL so any delivery would blow up, and make enqueue throw by dropping the org's flows table access via a bad gateway of dependencies.
    vi.spyOn(prisma.automationFlow, "findMany").mockRejectedValue(new Error("simulated outage"));
    const r = await createUpdate(s.emp, { sections: { workedOn: ["core must still work"], blockers: ["x real"] }, submit: true }, { now: NOW });
    vi.restoreAllMocks();
    expect(r.status).toBe("SUBMITTED");
    const row = await prisma.dailyUpdate.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("SUBMITTED");
    expect(row.hasBlockers).toBe(true);
    expect(await prisma.updateRevision.count({ where: { dailyUpdateId: r.id } })).toBe(1);
  });
});

// ── E. dispatcher ──────────────────────────────────────────────────────────────────────────────
describe("E. Delivery: success, retries with history, permanent failures, safety checks", () => {
  async function one(type: IntegrationEventType = "UPDATE_SUBMITTED", flowOpts: { status?: string; url?: string } = {}) {
    const { organizationId } = await makeOrg();
    const flow = await makeFlow(organizationId, type, flowOpts);
    const ev = await makeEvent(organizationId, type);
    return { organizationId, flow, ev, delivery: ev.deliveries[0] };
  }

  it("2xx → DELIVERED with one attempt on record; request carries the stable event ID, attempt number, and never follows redirects", async () => {
    const { delivery, ev, organizationId } = await one();
    const f = fakeFetch([200]);
    const r = await processDelivery(delivery.id, { fetch: f.fetch, now: () => NOW });
    expect(r).toMatchObject({ status: "DELIVERED", httpStatus: 200 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toMatch(/^https:\/\/flow\.sokt\.io\/func\/scri/);
    expect(f.calls[0].redirect).toBe("manual");
    expect(f.calls[0].body.attempt).toBe(1);
    expect(f.calls[0].body.eventId).toBe((await prisma.integrationEvent.findUniqueOrThrow({ where: { id: ev.integrationEventId! } })).eventId);
    expect(f.calls[0].headers["X-Daymark-Event-Id"]).toBe(f.calls[0].body.eventId);
    const d = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(d).toMatchObject({ status: "DELIVERED", attemptCount: 1, lastHttpStatus: 200, lastError: null });
    expect(d.deliveredAt).not.toBeNull();
    const att = await prisma.integrationAttempt.findMany({ where: { organizationId } });
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ outcome: "SUCCESS", httpStatus: 200, attemptNumber: 1 });
  });

  it("5xx → retry scheduled with backoff; not claimable early; resumes when due; full history kept; ends FAILED after the last attempt with an audit entry", async () => {
    const { delivery, organizationId } = await one();
    const f = fakeFetch([503]);
    let t = NOW;
    const deps = () => ({ fetch: f.fetch, now: () => t });

    let r = await processDelivery(delivery.id, deps());
    expect(r.status).toBe("RETRY_SCHEDULED");
    let d = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(d.status).toBe("PENDING");
    expect(d.nextAttemptAt.getTime()).toBe(NOW.getTime() + RETRY_DELAYS_MS[0]);

    expect((await processDelivery(delivery.id, deps())).status).toBe("NOT_CLAIMED"); // not due yet
    expect(f.calls).toHaveLength(1);

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      t = new Date(d.nextAttemptAt.getTime() + 1000);
      r = await processDelivery(delivery.id, deps());
      d = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    }
    expect(r.status).toBe("FAILED");
    expect(d).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS, lastHttpStatus: 503 });
    expect(f.calls.map((c) => c.body.attempt)).toEqual([1, 2, 3, 4, 5]);
    const att = await prisma.integrationAttempt.findMany({ where: { deliveryId: delivery.id }, orderBy: { attemptNumber: "asc" } });
    expect(att.map((a) => [a.attemptNumber, a.outcome, a.httpStatus])).toEqual([[1, "RETRYABLE_ERROR", 503], [2, "RETRYABLE_ERROR", 503], [3, "RETRYABLE_ERROR", 503], [4, "RETRYABLE_ERROR", 503], [5, "RETRYABLE_ERROR", 503]]);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "automation.delivery_failed", entityId: delivery.id } })).toBe(1);
    expect((await processDelivery(delivery.id, deps())).status).toBe("NOT_CLAIMED"); // finished rows are never re-sent
  });

  it("recovers: fail twice, then succeed → DELIVERED with 3 attempts of history", async () => {
    const { delivery } = await one();
    const f = fakeFetch((n) => (n < 2 ? 500 : 200));
    let t = NOW;
    for (let i = 0; i < 3; i++) {
      await processDelivery(delivery.id, { fetch: f.fetch, now: () => t });
      const d = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      t = new Date(d.nextAttemptAt.getTime() + 1000);
    }
    const d = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(d).toMatchObject({ status: "DELIVERED", attemptCount: 3 });
    expect((await prisma.integrationAttempt.findMany({ where: { deliveryId: delivery.id }, orderBy: { attemptNumber: "asc" } })).map((a) => a.outcome)).toEqual(["RETRYABLE_ERROR", "RETRYABLE_ERROR", "SUCCESS"]);
  });

  it.each([
    ["429 rate limit", 429, "HTTP_429"],
    ["408 timeout status", 408, "HTTP_408"],
  ])("%s is retried", async (_n, status, code) => {
    const { delivery } = await one();
    const r = await processDelivery(delivery.id, { fetch: fakeFetch([status]).fetch, now: () => NOW });
    expect(r).toMatchObject({ status: "RETRY_SCHEDULED", errorCode: code });
  });

  it("a hung request is cut off (timeout) and retried; a network error is retried", async () => {
    const a = await one();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(await processDelivery(a.delivery.id, { fetch: fakeFetch([timeout]).fetch, now: () => NOW })).toMatchObject({ status: "RETRY_SCHEDULED", errorCode: "TIMEOUT" });
    const b = await one();
    expect(await processDelivery(b.delivery.id, { fetch: fakeFetch([new TypeError("fetch failed")]).fetch, now: () => NOW })).toMatchObject({ status: "RETRY_SCHEDULED", errorCode: "NETWORK" });
    const att = await prisma.integrationAttempt.findFirstOrThrow({ where: { deliveryId: b.delivery.id } });
    expect(att.errorMessage).toBe("Could not reach viaSocket.");
  });

  it("really aborts a stalled request at the 8s limit (real AbortSignal, no mock timing)", async () => {
    const { delivery } = await one();
    const hang = (async (_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = processDelivery(delivery.id, { fetch: hang, now: () => NOW });
    await vi.advanceTimersByTimeAsync(8100);
    vi.useRealTimers();
    expect(await p).toMatchObject({ status: "RETRY_SCHEDULED", errorCode: "TIMEOUT" });
  });

  it("a paused or deleted flow answers 400: no retry, delivery SKIPPED, the flow is marked inactive so nothing new queues", async () => {
    const a = await one();
    expect(await processDelivery(a.delivery.id, { fetch: fakeFetch([{ status: 400, body: '{"message":"Flow is currently paused"}' }]).fetch, now: () => NOW })).toMatchObject({ status: "SKIPPED", errorCode: "FLOW_PAUSED" });
    expect((await prisma.automationFlow.findUniqueOrThrow({ where: { id: a.flow.id } })).status).toBe("paused");
    const again = await enqueueEvent({ organizationId: a.organizationId, type: "UPDATE_SUBMITTED", eventKey: "after-pause", payload: samplePayloadFor("UPDATE_SUBMITTED") });
    expect(again.created).toBe(false);
    const b = await one();
    expect(await processDelivery(b.delivery.id, { fetch: fakeFetch([{ status: 400, body: "Flow has been deleted" }]).fetch, now: () => NOW })).toMatchObject({ status: "SKIPPED", errorCode: "FLOW_DELETED" });
    expect((await prisma.automationFlow.findUniqueOrThrow({ where: { id: b.flow.id } })).status).toBe("deleted");
  });

  it("other 4xx and redirects are permanent failures (no retry)", async () => {
    const a = await one();
    expect(await processDelivery(a.delivery.id, { fetch: fakeFetch([404]).fetch, now: () => NOW })).toMatchObject({ status: "FAILED", errorCode: "HTTP_404" });
    const b = await one();
    expect(await processDelivery(b.delivery.id, { fetch: fakeFetch([302]).fetch, now: () => NOW })).toMatchObject({ status: "FAILED", errorCode: "REDIRECT_NOT_FOLLOWED" });
    const c = await one();
    expect(await processDelivery(c.delivery.id, { fetch: fakeFetch([{ status: 400, body: "bad input" }]).fetch, now: () => NOW })).toMatchObject({ status: "FAILED", errorCode: "HTTP_400" });
  });

  it("never sends to a host other than flow.sokt.io, or over plain http — and never calls fetch", async () => {
    for (const url of ["https://evil.example/func/scriX", "http://flow.sokt.io/func/scriX", "https://flow.sokt.io.evil.example/func/scriX"]) {
      const { delivery } = await one("UPDATE_SUBMITTED", { url });
      const f = fakeFetch([200]);
      expect(await processDelivery(delivery.id, { fetch: f.fetch, now: () => NOW }), url).toMatchObject({ status: "FAILED", errorCode: "BLOCKED_HOST" });
      expect(f.calls).toHaveLength(0);
    }
  });

  it("an unreadable stored URL fails permanently; a purged payload and an inactive flow are skipped", async () => {
    const a = await one();
    await prisma.automationFlow.update({ where: { id: a.flow.id }, data: { urlEnc: "v1.AAAA.BBBB.CCCC" } });
    expect(await processDelivery(a.delivery.id, { fetch: fakeFetch([200]).fetch, now: () => NOW })).toMatchObject({ status: "FAILED", errorCode: "UNREADABLE_URL" });
    const b = await one();
    await prisma.integrationEvent.update({ where: { id: b.ev.integrationEventId! }, data: { payload: Prisma.DbNull } });
    expect(await processDelivery(b.delivery.id, { fetch: fakeFetch([200]).fetch, now: () => NOW })).toMatchObject({ status: "SKIPPED", errorCode: "PAYLOAD_PURGED" });
    const c = await one();
    await prisma.automationFlow.update({ where: { id: c.flow.id }, data: { status: "paused" } });
    expect(await processDelivery(c.delivery.id, { fetch: fakeFetch([200]).fetch, now: () => NOW })).toMatchObject({ status: "SKIPPED", errorCode: "FLOW_INACTIVE" });
  });

  it("stores no URL, payload or response body anywhere in the attempt history", async () => {
    const { delivery, organizationId } = await one();
    await processDelivery(delivery.id, { fetch: fakeFetch([{ status: 500, body: "SECRET-RESPONSE-BODY https://flow.sokt.io/func/scriLEAK" }]).fetch, now: () => NOW });
    const dump = JSON.stringify([await prisma.integrationAttempt.findMany({ where: { organizationId } }), await prisma.integrationDelivery.findUnique({ where: { id: delivery.id } })]);
    expect(dump).not.toContain("SECRET-RESPONSE-BODY");
    expect(dump).not.toContain("flow.sokt.io");
    expect(dump).not.toContain("scriLEAK");
  });
});

// ── F. duplicate-safe processing ───────────────────────────────────────────────────────────────
describe("F. Duplicate-safe processing (concurrency, leases, repeats)", () => {
  it("two workers racing for one delivery send exactly one request", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const { deliveries } = await makeEvent(organizationId, "UPDATE_SUBMITTED");
    const f = fakeFetch([200]);
    const rs = await Promise.all(Array.from({ length: 6 }, () => processDelivery(deliveries[0].id, { fetch: f.fetch, now: () => NOW })));
    expect(f.calls).toHaveLength(1);
    expect(rs.filter((r) => r.status === "DELIVERED")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "NOT_CLAIMED")).toHaveLength(5);
  });

  it("concurrent cron sweeps over 30 due deliveries send each one exactly once", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await makeEvent(organizationId, "UPDATE_SUBMITTED")).deliveries[0].id);
    const f = fakeFetch([200]);
    const deps = { fetch: f.fetch, now: () => NOW };
    const runs = await Promise.all([sweepDeliveries({ limit: 100 }, deps), sweepDeliveries({ limit: 100 }, deps), sweepDeliveries({ limit: 100 }, deps)]);
    expect(runs.reduce((n, r) => n + r.processed, 0)).toBe(30);
    expect(f.calls).toHaveLength(30);
    expect(new Set(f.calls.map((c) => c.body.eventId)).size).toBe(30);
    expect(await prisma.integrationDelivery.count({ where: { organizationId, status: "DELIVERED" } })).toBe(30);
  });

  it("a sweep stops taking new work at its time budget and releases what it didn't start (cron has a hard duration limit)", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await makeEvent(organizationId, "UPDATE_SUBMITTED")).deliveries[0].id);
    const slow = (async () => { await new Promise((r) => setTimeout(r, 120)); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    const r = await sweepDeliveries({ limit: 100, budgetMs: 60 }, { fetch: slow, now: () => NOW });
    expect(r.processed).toBeGreaterThanOrEqual(1);
    expect(r.processed).toBeLessThan(12);
    expect(r.released).toBe(12 - r.processed);
    const rows = await prisma.integrationDelivery.findMany({ where: { organizationId } });
    expect(rows.filter((d) => d.status === "DELIVERED")).toHaveLength(r.processed);
    expect(rows.filter((d) => d.status === "PENDING" && d.lockedUntil === null)).toHaveLength(12 - r.processed); // released, not stuck behind a lease
    // …and the next pass finishes the rest.
    const next = await sweepDeliveries({ limit: 100, budgetMs: 10_000 }, { fetch: fakeFetch([200]).fetch, now: () => NOW });
    expect(next.processed).toBe(12 - r.processed);
    expect(await prisma.integrationDelivery.count({ where: { organizationId, status: "DELIVERED" } })).toBe(12);
  });

  it("an in-flight lease blocks other workers; an expired lease (crashed worker) lets it be retried — at-least-once", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const { deliveries } = await makeEvent(organizationId, "UPDATE_SUBMITTED");
    const id = deliveries[0].id;
    await prisma.integrationDelivery.update({ where: { id }, data: { lockedUntil: new Date(NOW.getTime() + 60_000) } });
    const f = fakeFetch([200]);
    expect((await processDelivery(id, { fetch: f.fetch, now: () => NOW })).status).toBe("NOT_CLAIMED");
    expect(f.calls).toHaveLength(0);
    await prisma.integrationDelivery.update({ where: { id }, data: { lockedUntil: new Date(NOW.getTime() - 1) } });
    expect((await processDelivery(id, { fetch: f.fetch, now: () => NOW })).status).toBe("DELIVERED");
    expect(f.calls).toHaveLength(1);
    // The resend case carries the same stable eventId, so a flow can dedupe.
  });

  it("a retried (resent) delivery carries the SAME event ID with a higher attempt number", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const { deliveries } = await makeEvent(organizationId, "UPDATE_SUBMITTED");
    const f = fakeFetch([500, 200]);
    await processDelivery(deliveries[0].id, { fetch: f.fetch, now: () => NOW });
    await processDelivery(deliveries[0].id, { fetch: f.fetch, now: () => new Date(NOW.getTime() + RETRY_DELAYS_MS[0] + 1) });
    expect(f.calls.map((c) => c.body.eventId)[0]).toBe(f.calls[1].body.eventId);
    expect(f.calls.map((c) => c.body.attempt)).toEqual([1, 2]);
  });
});

// ── G. missing-update detection ────────────────────────────────────────────────────────────────
describe("G. Missing-update detection (scheduler-safe reconciliation)", () => {
  async function team() {
    const { admin, organizationId } = await makeOrg("Miss");
    const a = (await addMember(admin, "EMPLOYEE", { name: "Asha" })).ctx;
    const b = (await addMember(admin, "EMPLOYEE", { name: "Ben" })).ctx;
    const c = (await addMember(admin, "EMPLOYEE", { name: "Chen" })).ctx;
    await backdate(organizationId);
    const flow = await makeFlow(organizationId, "UPDATE_MISSING");
    return { admin, organizationId, a, b, c, flow };
  }
  const names = async (organizationId: string) => (await events(organizationId)).map((e) => (e.payload as any).employee.name).sort();

  it("before the cut-off nothing is sent; after it, exactly the people without a submitted update (drafts count as missing)", async () => {
    const s = await team();
    await createUpdate(s.a, { sections: { workedOn: ["done"] }, submit: true }, { now: NOW });
    await createUpdate(s.b, { sections: { workedOn: ["only a draft"] } }, { now: NOW });
    expect((await runMissingUpdateCheck({ now: BEFORE_CUTOFF })).created).toBe(0);
    expect(await events(s.organizationId)).toHaveLength(0);
    const r = await runMissingUpdateCheck({ now: AFTER_CUTOFF });
    // Asha submitted; Ben (draft), Chen (nothing) and the admin are missing.
    expect(await names(s.organizationId)).toEqual([s.admin.userName, "Ben", "Chen"].sort());
    expect(r.created).toBe(3);
  });

  it("is idempotent: repeated and duplicate cron runs create no second event and keep the same event IDs", async () => {
    const s = await team();
    await runMissingUpdateCheck({ now: AFTER_CUTOFF });
    const before = (await events(s.organizationId)).map((e) => e.eventId).sort();
    const again = await runMissingUpdateCheck({ now: new Date(AFTER_CUTOFF.getTime() + 15 * 60_000) });
    const third = await Promise.all([runMissingUpdateCheck({ now: AFTER_CUTOFF }), runMissingUpdateCheck({ now: AFTER_CUTOFF })]);
    expect(again.created).toBe(0);
    expect(third.reduce((n, r) => n + r.created, 0)).toBe(0);
    expect((await events(s.organizationId)).map((e) => e.eventId).sort()).toEqual(before);
    expect(await prisma.integrationDelivery.count({ where: { organizationId: s.organizationId } })).toBe(before.length);
  });

  it("someone who submits after the cut-off but before the next run is not reminded", async () => {
    const s = await team();
    await createUpdate(s.a, { sections: { workedOn: ["late but in"] }, submit: true }, { now: AFTER_CUTOFF });
    await runMissingUpdateCheck({ now: new Date(AFTER_CUTOFF.getTime() + 60_000) });
    expect(await names(s.organizationId)).not.toContain("Asha");
  });

  it("skips non-working days, people who joined after today's cut-off, and deactivated people", async () => {
    const s = await team();
    const saturday = new Date("2026-11-14T13:00:00Z"); // after cut-off, but a weekend
    expect((await runMissingUpdateCheck({ now: saturday })).created).toBe(0);
    await prisma.membership.update({ where: { id: s.c.membershipId }, data: { createdAt: new Date("2026-11-13T12:00:00Z") } }); // joined 17:30 IST, before cutoff
    await prisma.membership.update({ where: { id: s.b.membershipId }, data: { createdAt: new Date("2026-11-13T12:30:30Z") } }); // joined after the 12:30Z cut-off
    await prisma.membership.update({ where: { id: s.a.membershipId }, data: { status: "DEACTIVATED" } });
    await runMissingUpdateCheck({ now: AFTER_CUTOFF });
    const n = await names(s.organizationId);
    expect(n).toContain("Chen");
    expect(n).not.toContain("Ben");
    expect(n).not.toContain("Asha");
  });

  it("only organizations with an active listening automation are examined; organizations are isolated", async () => {
    const s = await team();
    const other = await makeOrg("Quiet");
    await addMember(other.admin, "EMPLOYEE");
    await backdate(other.organizationId);
    const r = await runMissingUpdateCheck({ now: AFTER_CUTOFF });
    expect(await events(other.organizationId)).toHaveLength(0);
    expect(r.organizations).toBeGreaterThanOrEqual(1);
    expect((await events(s.organizationId)).every((e) => e.organizationId === s.organizationId)).toBe(true);
    await prisma.automationFlow.update({ where: { id: s.flow.id }, data: { status: "paused" } });
    const before = (await events(s.organizationId)).length;
    await runMissingUpdateCheck({ now: new Date(AFTER_CUTOFF.getTime() + 3600_000) });
    expect((await events(s.organizationId)).length).toBe(before);
  });

  it("the payload has what a reminder needs and nothing more", async () => {
    const s = await team();
    await runMissingUpdateCheck({ now: AFTER_CUTOFF });
    const ev = (await events(s.organizationId)).find((e) => (e.payload as any).employee.name === "Chen")!;
    const p = ev.payload as any;
    expect(p).toMatchObject({ schemaVersion: 1, test: false, eventType: "update.missing", employee: { name: "Chen", email: s.c.userEmail }, reminder: { date: "2026-11-13", cutoffTime: "18:00", timezone: "Asia/Kolkata" } });
    expect(p.reminder.submitUrl).toMatch(/\/my-updates\/new\?date=2026-11-13$/);
    expect(p).not.toHaveProperty("manager");
    expect(ev.eventId).toBe(eventIdFor(s.organizationId, eventKeys.missing(s.c.membershipId, "2026-11-13")));
  });
});

// ── H. access control, sync, linking, test events, isolation ───────────────────────────────────
describe("H. Access, sync, linking, test events and organization isolation", () => {
  const fakeGateway = (flowsByIdentity: Record<string, FlowSummary[]>, seen: string[] = []) => ({
    embedToken: async (i: string) => { seen.push(i); return "tok"; },
    serviceIds: async () => ({}),
    listFlows: async (i: string) => { seen.push(i); return flowsByIdentity[i] ?? []; },
  });
  const sf = (id: string, title: string, status = "active", host = "flow.sokt.io"): FlowSummary => ({ id, title, status, webhook: `https://${host}/func/${id}`, description: "" });

  it("Admin yes; Manager only when an admin authorizes; Employee never; only admins change settings", async () => {
    const { admin } = await makeOrg();
    const mgr = (await addMember(admin, "MANAGER")).ctx;
    const emp = (await addMember(admin, "EMPLOYEE")).ctx;
    expect((await automationsAccess(admin)).allowed).toBe(true);
    expect((await automationsAccess(mgr)).allowed).toBe(false);
    expect((await automationsAccess(emp)).allowed).toBe(false);
    await expect(updateAutomationSettings(mgr, { managerAccess: true })).rejects.toMatchObject({ status: 403 });
    await expect(updateAutomationSettings(emp, { includeBlockerText: true })).rejects.toMatchObject({ status: 403 });
    expect(await getAutomationSettings(admin.organizationId)).toEqual({ managerAccess: false, includeBlockerText: false });
    await updateAutomationSettings(admin, { managerAccess: true });
    expect((await automationsAccess(mgr)).allowed).toBe(true);
    expect((await automationsAccess(emp)).allowed).toBe(false);
    await expect(updateAutomationSettings(mgr, { includeBlockerText: true })).rejects.toMatchObject({ status: 403 }); // access ≠ settings
    await updateAutomationSettings(admin, { managerAccess: false });
    expect((await automationsAccess(mgr)).allowed).toBe(false);
    expect(await prisma.auditLog.count({ where: { organizationId: admin.organizationId, action: "automation.settings_updated" } })).toBe(2);
  });

  it("denied roles can't sync, link, test, or read history", async () => {
    const { admin, organizationId } = await makeOrg();
    const mgr = (await addMember(admin, "MANAGER")).ctx;
    const emp = (await addMember(admin, "EMPLOYEE")).ctx;
    const flow = await makeFlow(organizationId, "UPDATE_SUBMITTED");
    for (const who of [mgr, emp]) {
      await expect(syncFlows(who)).rejects.toMatchObject({ status: 403 });
      await expect(linkFlow(who, flow.id, { eventType: null })).rejects.toMatchObject({ status: 403 });
      await expect(sendTestEvent(who, flow.id)).rejects.toMatchObject({ status: 403 });
      await expect(listRecentDeliveries(who)).rejects.toMatchObject({ status: 403 });
      await expect(listAttempts(who, "x")).rejects.toMatchObject({ status: 403 });
    }
  });

  it("sync: reads ONLY the session organization's identity, stores URLs encrypted, ignores non-viaSocket URLs, marks vanished flows deleted", async () => {
    const A = await makeOrg("Alpha");
    const B = await makeOrg("Beta");
    const seen: string[] = [];
    setGatewayForTests(fakeGateway({
      [`daymark-org-${A.organizationId}`]: [sf("a1x", "Blocker alert"), sf("a2x", "Evil", "active", "evil.example")],
      [`daymark-org-${B.organizationId}`]: [sf("b1x", "Beta secret flow")],
    }, seen));
    const out = await syncFlows(A.admin);
    expect(seen).toEqual([`daymark-org-${A.organizationId}`]);
    expect(out.map((f) => f.title)).toEqual(["Blocker alert"]);
    const rows = await prisma.automationFlow.findMany({ where: { organizationId: A.organizationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].urlEnc).not.toContain("a1x");
    expect(decryptSecret(rows[0].urlEnc)).toBe("https://flow.sokt.io/func/a1x");
    expect(await prisma.automationFlow.count({ where: { organizationId: B.organizationId } })).toBe(0);

    // viaSocket renames, then removes the flow.
    setGatewayForTests(fakeGateway({ [`daymark-org-${A.organizationId}`]: [sf("a1x", "Renamed", "paused")] }));
    expect((await syncFlows(A.admin))[0]).toMatchObject({ title: "Renamed", status: "paused" });
    setGatewayForTests(fakeGateway({}));
    expect(await syncFlows(A.admin)).toEqual([]);
    expect((await prisma.automationFlow.findFirstOrThrow({ where: { organizationId: A.organizationId } })).status).toBe("deleted");
  });

  it("unpublished (drafted) flows are not listed and never receive events, until they are published", async () => {
    const A = await makeOrg();
    setGatewayForTests(fakeGateway({ [`daymark-org-${A.organizationId}`]: [sf("d1x", "Half-built", "drafted"), sf("a1x", "Live one", "active")] }));
    expect((await syncFlows(A.admin)).map((f) => f.title)).toEqual(["Live one"]);
    const draft = await prisma.automationFlow.findFirstOrThrow({ where: { organizationId: A.organizationId, title: "Half-built" } });
    expect(draft.status).toBe("draft");
    await prisma.automationFlow.update({ where: { id: draft.id }, data: { eventType: "UPDATE_SUBMITTED" } });
    expect((await enqueueEvent({ organizationId: A.organizationId, type: "UPDATE_SUBMITTED", eventKey: "draft-test", payload: samplePayloadFor("UPDATE_SUBMITTED") })).created).toBe(false);
    setGatewayForTests(fakeGateway({ [`daymark-org-${A.organizationId}`]: [sf("d1x", "Half-built", "active")] }));
    expect((await syncFlows(A.admin)).map((f) => f.title)).toEqual(["Half-built"]);
  });

  it("sync keeps the admin's event link across re-syncs", async () => {
    const A = await makeOrg();
    setGatewayForTests(fakeGateway({ [`daymark-org-${A.organizationId}`]: [sf("keep1", "Keeper")] }));
    const [f] = await syncFlows(A.admin);
    await linkFlow(A.admin, f.id, { eventType: "UPDATE_MISSING" });
    await syncFlows(A.admin);
    expect((await prisma.automationFlow.findUniqueOrThrow({ where: { id: f.id } })).eventType).toBe("UPDATE_MISSING");
  });

  it("linking: validates the event type, is audited, and a flow of another organization is simply 'not found'", async () => {
    const A = await makeOrg("Alpha");
    const B = await makeOrg("Beta");
    const aFlow = await makeFlow(A.organizationId, null);
    const bFlow = await makeFlow(B.organizationId, "UPDATE_SUBMITTED");
    await linkFlow(A.admin, aFlow.id, { eventType: "UPDATE_BLOCKER_REPORTED" });
    expect((await prisma.automationFlow.findUniqueOrThrow({ where: { id: aFlow.id } })).eventType).toBe("UPDATE_BLOCKER_REPORTED");
    await expect(linkFlow(A.admin, aFlow.id, { eventType: "NOPE" })).rejects.toBeTruthy();
    await expect(linkFlow(A.admin, bFlow.id, { eventType: null })).rejects.toMatchObject({ status: 404 });
    await expect(linkFlow(B.admin, aFlow.id, { eventType: null })).rejects.toMatchObject({ status: 404 });
    await expect(sendTestEvent(A.admin, bFlow.id)).rejects.toMatchObject({ status: 404 });
    expect((await prisma.automationFlow.findUniqueOrThrow({ where: { id: bFlow.id } })).eventType).toBe("UPDATE_SUBMITTED");
    expect(await prisma.auditLog.count({ where: { organizationId: A.organizationId, action: "automation.flow_linked" } })).toBe(1);
    await linkFlow(A.admin, aFlow.id, { eventType: null });
    expect(await prisma.auditLog.count({ where: { organizationId: A.organizationId, action: "automation.flow_unlinked" } })).toBe(1);
  });

  it("organization B can neither see A's deliveries or attempts nor produce events in A", async () => {
    const A = await makeOrg("Alpha");
    const B = await makeOrg("Beta");
    await makeFlow(A.organizationId, "UPDATE_SUBMITTED");
    const ev = await makeEvent(A.organizationId, "UPDATE_SUBMITTED");
    await processDelivery(ev.deliveries[0].id, { fetch: fakeFetch([500]).fetch, now: () => NOW });
    expect((await listRecentDeliveries(A.admin)).length).toBe(1);
    expect(await listRecentDeliveries(B.admin)).toEqual([]);
    await expect(listAttempts(B.admin, ev.deliveries[0].id)).rejects.toMatchObject({ status: 404 });
    expect((await listAttempts(A.admin, ev.deliveries[0].id))[0]).toMatchObject({ attemptNumber: 1, outcome: "RETRYABLE_ERROR", httpStatus: 500 });
    // The database itself refuses cross-organization references.
    // (a fresh, unused flow of A so that only the cross-organization reference can be the cause)
    const spare = await makeFlow(A.organizationId, null);
    await expect(prisma.integrationDelivery.create({ data: { organizationId: B.organizationId, integrationEventId: ev.integrationEventId!, automationFlowId: spare.id } })).rejects.toMatchObject({ code: "P2003" });
    const bFlow = await makeFlow(B.organizationId, null);
    await expect(prisma.integrationDelivery.create({ data: { organizationId: B.organizationId, integrationEventId: ev.integrationEventId!, automationFlowId: bFlow.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("'Send test event' delivers a clearly synthetic payload to that one flow only, never real people", async () => {
    const A = await makeOrg("Alpha");
    const emp = (await addMember(A.admin, "EMPLOYEE", { name: "Real Person" })).ctx;
    const target = await makeFlow(A.organizationId, "UPDATE_BLOCKER_REPORTED");
    const other = await makeFlow(A.organizationId, "UPDATE_BLOCKER_REPORTED");
    const f = fakeFetch([200]);
    const out = await sendTestEvent(A.admin, target.id, { fetch: f.fetch, now: () => new Date() });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].status).toBe("DELIVERED");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body).toMatchObject({ test: true, eventType: "update.blocker_reported", employee: { name: "Test Employee" } });
    expect(JSON.stringify(f.calls[0].body)).not.toContain("Real Person");
    expect(JSON.stringify(f.calls[0].body)).not.toContain(emp.userEmail);
    expect(await prisma.integrationDelivery.count({ where: { automationFlowId: other.id } })).toBe(0);
    await expect(sendTestEvent(A.admin, (await makeFlow(A.organizationId, null)).id)).rejects.toMatchObject({ status: 400 });
    await expect(sendTestEvent(A.admin, (await makeFlow(A.organizationId, "UPDATE_SUBMITTED", { status: "paused" })).id)).rejects.toMatchObject({ status: 400 });
  });

  it("every event type has a catalogue entry and a sample payload that matches its documented shape", () => {
    for (const t of Object.keys(EVENT_CATALOG) as IntegrationEventType[]) {
      const p = samplePayload(t, "evt_x", "Acme", NOW) as any;
      expect(p).toMatchObject({ schemaVersion: 1, eventId: "evt_x", eventType: EVENT_CATALOG[t].name, test: true, organization: { name: "Acme" } });
    }
  });
});

// ── I. cron, retention, configuration ──────────────────────────────────────────────────────────
describe("I. Cron route, locking, retention and 'not configured'", () => {
  const req = (auth?: string) => new Request("http://localhost/api/cron/integrations", { headers: auth ? { authorization: auth } : {} });

  it("the cron route requires the bearer secret (constant-time), and answers 401 otherwise", async () => {
    expect((await cronGET(req())).status).toBe(401);
    expect((await cronGET(req("Bearer wrong"))).status).toBe(401);
    expect((await cronGET(req(process.env.CRON_SECRET!))).status).toBe(401); // missing "Bearer "
    const ok = await cronGET(req(`Bearer ${process.env.CRON_SECRET}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toHaveProperty("missing");
    expect(body).toHaveProperty("sweep");
    expect(body).toHaveProperty("purge");
  });

  it("refuses to run at all if CRON_SECRET is not set", async () => {
    const saved = process.env.CRON_SECRET;
    vi.resetModules();
    delete process.env.CRON_SECRET;
    const mod = await import("@/app/api/cron/integrations/route");
    expect((await mod.GET(req("Bearer anything"))).status).toBe(503);
    process.env.CRON_SECRET = saved;
  });

  it("overlapping cron runs: the second is a no-op while the first holds the lease", async () => {
    const first = await withJobLock("integrations-cron", 60_000, async () => runIntegrationCron(new Date()), () => new Date());
    // `first` ran the cron while holding the lease named like the real job, so the nested run was skipped…
    expect(first).toMatchObject({ ran: true, value: { skipped: "another run is in progress" } });
    // …and the lease is released afterwards, so the next run works normally.
    expect(await runIntegrationCron(NOW)).toHaveProperty("sweep");
  });

  it("a crashed run's lease expires and can be taken over", async () => {
    const name = `test-lock-${Date.now()}`;
    const t0 = new Date("2026-11-14T00:00:00Z");
    await prisma.jobLock.create({ data: { name, owner: "dead-run", lockedUntil: new Date(t0.getTime() + 60_000) } });
    expect(await withJobLock(name, 60_000, async () => "x", () => new Date(t0.getTime() + 30_000))).toEqual({ ran: false }); // still leased
    expect(await withJobLock(name, 60_000, async () => "x", () => new Date(t0.getTime() + 61_000))).toEqual({ ran: true, value: "x" }); // expired
  });

  it("the lease is exclusive under concurrent acquisition", async () => {
    const name = `race-${Date.now()}`;
    let running = 0, peak = 0;
    const attempt = () => withJobLock(name, 60_000, async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 50)); running--; return 1; });
    const results = await Promise.all(Array.from({ length: 12 }, attempt));
    expect(peak).toBe(1);
    expect(results.filter((r) => r.ran).length).toBeGreaterThanOrEqual(1);
  });

  it("a cron pass retries what is due and leaves the rest", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const due = (await makeEvent(organizationId, "UPDATE_SUBMITTED")).deliveries[0];
    const later = (await makeEvent(organizationId, "UPDATE_SUBMITTED")).deliveries[0];
    await prisma.integrationDelivery.update({ where: { id: later.id }, data: { nextAttemptAt: new Date(Date.now() + 3600_000) } });
    const f = fakeFetch([200]);
    setDispatchDepsForTests({ fetch: f.fetch });
    await runIntegrationCron(new Date());
    expect((await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("DELIVERED");
    expect((await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("PENDING");
  });

  it("retention: payloads are cleared after 30 days, whole events (and history) after 180", async () => {
    const { organizationId } = await makeOrg();
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    const day = 86_400_000;
    const mk = async (ageDays: number) => {
      const e = await makeEvent(organizationId, "UPDATE_SUBMITTED");
      await prisma.integrationEvent.update({ where: { id: e.integrationEventId! }, data: { createdAt: new Date(Date.now() - ageDays * day) } });
      await processDelivery(e.deliveries[0].id, { fetch: fakeFetch([200]).fetch, now: () => NOW });
      return e.integrationEventId!;
    };
    const fresh = await mk(5), old = await mk(40), ancient = await mk(200);
    const r = await purgeOldIntegrationData();
    expect(r.eventsDeleted).toBeGreaterThanOrEqual(1);
    expect((await prisma.integrationEvent.findUniqueOrThrow({ where: { id: fresh } })).payload).not.toBeNull();
    expect((await prisma.integrationEvent.findUniqueOrThrow({ where: { id: old } })).payload).toBeNull();
    expect(await prisma.integrationEvent.findUnique({ where: { id: ancient } })).toBeNull();
    expect(await prisma.integrationAttempt.count({ where: { organizationId, delivery: { integrationEventId: ancient } } })).toBe(0);
  });

  it("when viaSocket isn't configured nothing is emitted and nothing is delivered (core is unaffected)", async () => {
    const saved = { ...process.env };
    vi.resetModules();
    delete process.env.VIASOCKET_EMBED_SECRET;
    const cfg = await import("@/server/integrations/viasocket/config");
    expect(cfg.isViaSocketConfigured()).toBe(false);
    const miss = await import("@/server/integrations/viasocket/missing");
    expect(await miss.runMissingUpdateCheck({ now: AFTER_CUTOFF })).toEqual({ organizations: 0, created: 0 });
    const ev = await import("@/server/integrations/viasocket/events");
    const before = await prisma.integrationEvent.count();
    ev.notifyUpdateChanged({ organizationId: "any", updateId: "any", submittedNow: true, blockerNow: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.integrationEvent.count()).toBe(before);
    const cronMod = await import("@/app/api/cron/integrations/route");
    const res = await cronMod.GET(req(`Bearer ${saved.CRON_SECRET}`));
    expect(await res.json()).toEqual({ skipped: "viaSocket is not configured" });
    Object.assign(process.env, saved);
  });

  it("the server never exposes URLs: listing flows returns no webhook or secret fields", async () => {
    const A = await makeOrg();
    await makeFlow(A.organizationId, "UPDATE_SUBMITTED", { url: RUN_URL("leaktest") });
    const { listFlowsForOrg } = await import("@/server/integrations/viasocket/flows");
    const json = JSON.stringify(await listFlowsForOrg(A.admin));
    expect(json).not.toContain("leaktest");
    expect(json).not.toContain("flow.sokt.io");
    expect(json).not.toContain("urlEnc");
    expect(json).not.toContain("flowKey");
  });
});

// ── J. documentation can't drift from reality ──────────────────────────────────────────────────
describe("J. The documented fields are exactly the fields that are sent", () => {
  const paths = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
      : [];

  it.each(Object.keys(EVENT_CATALOG) as IntegrationEventType[])("%s: sample payload ⊆ documented ⊆ sample payload (+ optional fields)", (type) => {
    const sample = paths(samplePayload(type, "evt_x", "Acme", NOW)).sort();
    const documented = EVENT_FIELDS[type];
    const required = documented.filter((f) => !f.optional).map((f) => f.path).sort();
    expect(sample).toEqual(required);
  });

  it("real payloads built from a real update only contain documented fields", async () => {
    const { admin, organizationId } = await makeOrg("Docs");
    const mgr = (await addMember(admin, "MANAGER")).ctx;
    const team = await createTeam(admin, { name: "T", managerId: mgr.membershipId });
    const emp = (await addMember(admin, "EMPLOYEE", { teamId: team.id })).ctx;
    await updateAutomationSettings(admin, { includeBlockerText: true });
    await makeFlow(organizationId, "UPDATE_SUBMITTED");
    await makeFlow(organizationId, "UPDATE_BLOCKER_REPORTED");
    await createUpdate(emp, { sections: { workedOn: ["w"], blockers: ["a real blocker"] }, submit: true }, { now: NOW });
    await waitFor(async () => (await events(organizationId)).length === 2);
    for (const ev of await events(organizationId)) {
      const documented = new Set(EVENT_FIELDS[ev.type].map((f) => f.path));
      for (const path of paths(ev.payload)) expect(documented.has(path), `${ev.type}: undocumented field ${path}`).toBe(true);
    }
  });
});

describe("K. docs/automation-events.md documents every field", () => {
  it("lists each event's fields, its event key shape and the at-least-once warning", async () => {
    const { readFileSync } = await import("node:fs");
    const md = readFileSync("docs/automation-events.md", "utf8");
    for (const [type, fields] of Object.entries(EVENT_FIELDS)) {
      const section = md.split(/^## /m).find((x) => x.startsWith(`\`${EVENT_CATALOG[type as IntegrationEventType].name}\``));
      expect(section, `section for ${type}`).toBeTruthy();
      for (const f of fields.filter((x) => !["schemaVersion", "eventId", "eventType", "occurredAt", "test", "organization.name"].includes(x.path))) {
        const leaf = f.path.split(".")[0] === "manager" ? f.path.replace("manager.name", "manager.name") : f.path;
        expect(section!.includes(`\`${leaf}`) || section!.includes(`\`${f.path.split(".").slice(0, -1).join(".")}.${f.path.split(".").at(-1)}`) || section!.includes(f.path.split(".").at(-1)!), `${type}: ${f.path}`).toBe(true);
      }
    }
    for (const f of EVENT_FIELDS.UPDATE_SUBMITTED.slice(0, 6)) expect(md).toContain(f.path.split(".").at(-1)!);
    expect(md).toMatch(/At-least-once/);
    expect(md).toMatch(/eventId/);
  });
});


// ── L. daily reminders ──────────────────────────────────────────────────────────────────────────
describe("L. Daily reminders (one organization-wide time, timezone and working-day aware)", () => {
  // Org timezone in these tests: Asia/Kolkata (UTC+5:30). Default cut-off 18:00. Reminder time 16:00 IST = 10:30Z.
  const AT_1559 = new Date("2026-11-13T10:29:00Z"), AT_1601 = new Date("2026-11-13T10:31:00Z"), AT_1759 = new Date("2026-11-13T12:29:00Z"), AT_1801 = AFTER_CUTOFF;
  async function company(o: { enabled?: boolean; time?: string; flow?: boolean } = {}) {
    const { admin, organizationId } = await makeOrg("Rem");
    const a = (await addMember(admin, "EMPLOYEE", { name: "Asha" })).ctx;
    const b = (await addMember(admin, "EMPLOYEE", { name: "Ben" })).ctx;
    await backdate(organizationId);
    await updateSettings({ ...admin, userId: admin.userId }, { reminderEnabled: o.enabled ?? true, reminderTime: o.time ?? "16:00" });
    if (o.flow !== false) await makeFlow(organizationId, "UPDATE_REMINDER");
    return { admin, organizationId, a, b };
  }
  const who = async (organizationId: string) => (await events(organizationId)).filter((e) => e.type === "UPDATE_REMINDER").map((e) => (e.payload as any).employee.name).sort();

  it("sends nothing before the reminder time, reminds exactly the people without a submitted update after it, and stops at the cut-off", async () => {
    const c = await company();
    await createUpdate(c.a, { sections: { workedOn: ["done"] }, submit: true }, { now: NOW });
    await createUpdate(c.b, { sections: { workedOn: ["only a draft"] } }, { now: NOW });
    expect((await runReminderCheck({ now: AT_1559 })).created).toBe(0);
    expect(await who(c.organizationId)).toEqual([]);
    const r = await runReminderCheck({ now: AT_1601 });
    expect(await who(c.organizationId)).toEqual([c.admin.userName, "Ben"].sort());       // Asha submitted; Ben only has a draft; the admin has nothing
    expect(r.created).toBe(2);
    // after the cut-off the reminder job does nothing more (the "missing" event is the next stage)
    const c2 = await company();
    expect((await runReminderCheck({ now: AT_1801 })).created).toBe(0);
    expect(await who(c2.organizationId)).toEqual([]);
  });

  it("a late cron run still reminds (until the cut-off), and a duplicate or overlapping run never reminds twice", async () => {
    const c = await company();
    await runReminderCheck({ now: AT_1759 });                                              // the scheduler was late
    const ids = (await events(c.organizationId)).map((e) => e.eventId).sort();
    expect(ids).toHaveLength(3);
    const again = await Promise.all([runReminderCheck({ now: AT_1601 }), runReminderCheck({ now: AT_1759 }), runReminderCheck({ now: AT_1759 })]);
    expect(again.reduce((n, r) => n + r.created, 0)).toBe(0);
    expect((await events(c.organizationId)).map((e) => e.eventId).sort()).toEqual(ids);    // same stable IDs
    expect(await prisma.integrationDelivery.count({ where: { organizationId: c.organizationId } })).toBe(3);
  });

  it("someone who submits after the reminder went out is not reminded again, and one who submits before the next run is skipped", async () => {
    const c = await company();
    await createUpdate(c.a, { sections: { workedOn: ["just in"] }, submit: true }, { now: AT_1601 });
    await runReminderCheck({ now: new Date(AT_1601.getTime() + 60_000) });
    expect(await who(c.organizationId)).not.toContain("Asha");
  });

  it("respects working days, switched-off reminders, people who joined later, deactivated people and missing automations", async () => {
    const sat = new Date("2026-11-14T10:31:00Z");                                          // Saturday, 16:01 IST
    const c = await company();
    await runReminderCheck({ now: sat });                                                   // not a working day
    expect(await who(c.organizationId)).toEqual([]);
    const off = await company({ enabled: false });
    await runReminderCheck({ now: AT_1601 });
    expect(await who(off.organizationId)).toEqual([]);
    const noFlow = await company({ flow: false });
    await runReminderCheck({ now: AT_1601 });
    expect(await who(noFlow.organizationId)).toEqual([]);                                  // nothing listens: nothing is created
    const j = await company();
    const late = (await addMember(j.admin, "EMPLOYEE", { name: "Newbie" })).ctx;
    const gone = (await addMember(j.admin, "EMPLOYEE", { name: "Gone" })).ctx;
    await prisma.membership.update({ where: { id: late.membershipId }, data: { createdAt: new Date("2026-11-13T10:45:00Z") } });   // joined 16:15 IST: after the 16:00 reminder time
    await prisma.membership.update({ where: { id: gone.membershipId }, data: { status: "DEACTIVATED" } });
    await runReminderCheck({ now: new Date("2026-11-13T11:00:00Z") });
    const names = await who(j.organizationId);
    expect(names).not.toContain("Newbie");
    expect(names).not.toContain("Gone");
    expect(names).toContain("Asha");
    expect(c.organizationId).toBeTruthy();
  });

  it("each organization uses its own timezone: at the same instant one is due and another is not", async () => {
    const kolkata = await company();                                                      // 16:00 IST → due at 10:30Z
    const { admin, organizationId } = await makeOrg("Ldn");
    await prisma.organization.update({ where: { id: organizationId }, data: { timezone: "Europe/London" } });
    await backdate(organizationId);
    await updateSettings({ ...admin, userId: admin.userId }, { reminderEnabled: true, reminderTime: "16:00" });
    await makeFlow(organizationId, "UPDATE_REMINDER");
    await runReminderCheck({ now: AT_1601 });                                              // 10:31Z = 10:31 in London: not yet
    expect(await who(organizationId)).toEqual([]);
    expect((await who(kolkata.organizationId)).length).toBeGreaterThan(0);
    await runReminderCheck({ now: new Date("2026-11-13T16:05:00Z") });                     // 16:05 London (GMT in November)
    expect((await who(organizationId)).length).toBe(1);
  });

  it("handles daylight-saving changes: the reminder time stays 16:00 local on both sides of the clock change", async () => {
    const { admin, organizationId } = await makeOrg("Dst");
    await prisma.organization.update({ where: { id: organizationId }, data: { timezone: "Europe/London" } });
    await backdate(organizationId);
    await updateSettings({ ...admin, userId: admin.userId }, { reminderEnabled: true, reminderTime: "16:00" });
    await makeFlow(organizationId, "UPDATE_REMINDER");
    // BST ends Sun 25 Oct 2026. Fri 23 Oct is BST (UTC+1): 16:00 local = 15:00Z. Mon 26 Oct is GMT: 16:00 local = 16:00Z.
    await runReminderCheck({ now: new Date("2026-10-23T14:59:00Z") }); expect(await who(organizationId)).toEqual([]);
    await runReminderCheck({ now: new Date("2026-10-23T15:01:00Z") }); expect((await who(organizationId)).length).toBe(1);
    await runReminderCheck({ now: new Date("2026-10-26T15:01:00Z") }); expect((await events(organizationId)).length).toBe(1);   // 15:01Z is only 15:01 GMT: not yet
    await runReminderCheck({ now: new Date("2026-10-26T16:01:00Z") }); expect((await events(organizationId)).length).toBe(2);
  });

  it("the payload is exactly the documented one, carries a stable event ID and reaches the automation", async () => {
    const c = await company();
    await runReminderCheck({ now: AT_1601 });
    const ev = (await events(c.organizationId)).find((e) => (e.payload as any).employee.name === "Asha")!;
    expect(ev.payload).toMatchObject({ eventType: "update.reminder", test: false, employee: { name: "Asha", email: expect.stringContaining("@") }, reminder: { date: "2026-11-13", cutoffTime: "18:00", timezone: "Asia/Kolkata", submitUrl: expect.stringContaining("/my-updates/new?date=2026-11-13") } });
    expect(ev.eventId).toBe(eventIdFor(c.organizationId, eventKeys.reminder(c.a.membershipId, "2026-11-13")));
    const f = fakeFetch([200]);
    const d = (await prisma.integrationDelivery.findMany({ where: { integrationEventId: ev.id } }))[0];
    expect(await processDelivery(d.id, { fetch: f.fetch, now: () => AT_1601 })).toMatchObject({ status: "DELIVERED" });
    expect(f.calls[0].body.eventType).toBe("update.reminder");
  });

  it("the cron pass runs reminders too, and the settings refuse a reminder at or after the cut-off", async () => {
    const c = await company();
    const r = await runIntegrationCron(AT_1601);
    expect(r).toHaveProperty("reminders");
    expect((r as { reminders: { created: number } }).reminders.created).toBe(3);
    await expect(updateSettings({ ...c.admin, userId: c.admin.userId }, { reminderTime: "18:00" })).rejects.toMatchObject({ status: 400 });
    await expect(updateSettings({ ...c.admin, userId: c.admin.userId }, { reminderTime: "19:30" })).rejects.toMatchObject({ status: 400 });
    await expect(updateSettings({ ...c.admin, userId: c.admin.userId }, { updateCutoffTime: "15:00" })).rejects.toMatchObject({ status: 400 });  // cut-off moved before the reminder
    await updateSettings({ ...c.admin, userId: c.admin.userId }, { reminderEnabled: false, updateCutoffTime: "15:00" });                          // fine once reminders are off
    await expect(updateSettings({ ...c.admin, userId: c.admin.userId }, { reminderTime: "nope" })).rejects.toBeTruthy();
  });
});
