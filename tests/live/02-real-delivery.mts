// Real delivery of all three events to REAL viaSocket flows (no Slack needed). Each flow's only step returns what it received,
// so the run history is the proof of exactly what Daymark sent.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Daymark, automationToken, check, createFlow, identityOf, readFlow, runHistory, runsOf, saveSteps, setTrigger, sleep, state, summary, until, viasocket, CRON_SECRET, BASE } from "./lib.mts";

const PW = state("pw"), ORG = state("org_id"), ID = identityOf(ORG);
const people = JSON.parse(readFileSync(`${process.env.LIVE_STATE_DIR}/people.json`, "utf8"));
const psql = (sql: string) => execSync(`psql "${process.env.DATABASE_URL}" -Atc ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
const admin = await new Daymark().signIn(state("admin_email"), PW);
const eva = await new Daymark().signIn(people.eva.email, PW);
const gus = await new Daymark().signIn(people.gus.email, PW);
const tag = Date.now().toString(36);
const cronRes = async () => (await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: `Bearer ${CRON_SECRET()}` } })).json() as Promise<any>;
let retriesSeen = 0;
/** Real life: a slow viaSocket answer = TIMEOUT = retry in 5 minutes by the cron sweep. Fast-forward that wait and run the real sweep. */
async function pump() {
  const n = Number(psql(`select count(*) from "IntegrationDelivery" where "organizationId"='${ORG}' and status='PENDING' and "attemptCount">0`));
  if (n) { retriesSeen += n; psql(`update "IntegrationDelivery" set "nextAttemptAt"=now() where "organizationId"='${ORG}' and status='PENDING' and "attemptCount">0`); }
  await cronRes();
}

// ── 0. real SDK-backed endpoints ─────────────────────────────────────────────
const tok = await admin.req("GET", "/api/viasocket/token?apps=slack");
check("token endpoint: real token + the real service_id for slack", tok.status === 200 && tok.body.token?.split(".").length === 3 && /^[a-z0-9]+$/i.test(tok.body.serviceIds?.slack ?? ""), `serviceId=${tok.body.serviceIds?.slack}`);
const claims = JSON.parse(Buffer.from(tok.body.token.split(".")[1], "base64url").toString());
check("token is for THIS organization's identity", claims.unique_identifier === ID && String(claims.org_id) === process.env.VIASOCKET_ORG_ID, claims.unique_identifier);

// ── 1. build three real flows (webhook trigger → one recording step) ─────────
const T = await automationToken(ID);
check("automationToken returned a token for the organization's identity", !!T);
const EV = { UPDATE_SUBMITTED: "update.submitted", UPDATE_BLOCKER_REPORTED: "update.blocker_reported", UPDATE_MISSING: "update.missing" } as const;
const flows: Record<string, { scriptId: string; title: string }> = {};
for (const type of Object.keys(EV) as (keyof typeof EV)[]) {
  const title = `Live test (${tag}) — ${EV[type]}`;
  const scriptId = await createFlow(T, { title, description: "Daymark live delivery test: records what it receives." });
  await setTrigger(T, scriptId, { triggerType: "webhook" });
  await saveSteps(T, scriptId, [{ stepname: "record", code: "return { received: context?.req?.body }", service_action_functions: [] }]);
  const back = await readFlow(T, scriptId);
  flows[type] = { scriptId, title };
  check(`flow for ${EV[type]}: readFlow shows trigger and step by name`, back?.trigger?.triggerType === "webhook" || !!back?.trigger, JSON.stringify({ trigger: back?.trigger?.triggerType ?? back?.trigger, steps: (back?.steps ?? []).map((s: any) => s.stepname) }));
}

// ── 2. Daymark discovers them server-side (real listFlows) and the admin links each one ──
const sync = await admin.req("POST", "/api/automations/sync", {});
check("sync lists the real flows for this organization only", sync.status === 200 && Object.values(flows).every((f) => sync.body.flows.some((x: any) => x.title === f.title)), `${sync.body?.flows?.length} flows`);
const idOf = (type: string) => sync.body.flows.find((x: any) => x.title === flows[type].title).id as string;
for (const type of Object.keys(EV)) {
  const r = await admin.req("PATCH", `/api/automations/flows/${idOf(type)}`, { eventType: type });
  check(`linked ${EV[type as keyof typeof EV]}`, r.status === 200);
}
check("no flow URL or secret in the API response", !JSON.stringify(sync.body).includes("flow.sokt.io") && !JSON.stringify(sync.body).includes(process.env.VIASOCKET_EMBED_SECRET ?? "zzzz"));

const deliveriesOf = async (label: string) => ((await admin.req("GET", "/api/automations")).body.deliveries as any[]).filter((d) => d.eventLabel === label);
const settled = <T,>(label: string, find: () => Promise<T | undefined>, ms = 120_000) => until(label, async () => { const v = await find(); if (v) return v; await pump(); return undefined; }, ms, 2500);
const runsFor = async (type: string) => runsOf(await runHistory(T, flows[type].scriptId));
const received = (run: any) => { try { return JSON.parse(run.output)?.received; } catch { return undefined; } };

// ── 3. real triggers through the real app ───────────────────────────────────
const secret = "CONFIDENTIAL-TEXT-" + tag;
const evaSub = await eva.req("POST", "/api/updates", { sections: { workedOn: [secret], blockers: ["Waiting on the vendor's API keys"] }, submit: true });
check("Eva submitted an update with a blocker (core succeeded)", evaSub.status === 200 && evaSub.body.status === "SUBMITTED");
const sub = await settled("submitted delivery", async () => (await deliveriesOf("Daily Update Submitted")).find((d) => d.status === "DELIVERED"));
const blk = await settled("blocker delivery", async () => (await deliveriesOf("Employee Reports a Blocker")).find((d) => d.status === "DELIVERED"));
check("both deliveries reached DELIVERED", sub.status === "DELIVERED" && blk.status === "DELIVERED", `attempts: submitted=${sub.attemptCount}, blocker=${blk.attemptCount}`);
const subRun = await until("submitted run recorded", async () => (await runsFor("UPDATE_SUBMITTED")).find((r) => received(r)?.eventId === sub.eventId));
const blkRun = await until("blocker run recorded", async () => (await runsFor("UPDATE_BLOCKER_REPORTED")).find((r) => received(r)?.eventId === blk.eventId));
const sp = received(subRun), bp = received(blkRun);
check("submitted: what viaSocket received matches the contract", sp.eventType === "update.submitted" && sp.test === false && sp.employee?.name === "Eva Employee" && sp.employee?.team === "Live Team" && sp.manager?.email === people.max.email && sp.update?.hasBlockers === true && sp.attempt === 1 && /\/team-updates\//.test(sp.update?.url), `eventId=${sp.eventId}`);
check("blocker: received the contract fields, link-only by default (no text)", bp.eventType === "update.blocker_reported" && bp.blocker?.count === 1 && bp.blocker?.text === undefined);
check("data minimisation held on the wire (no update text, no employee email, no blocker text)", ![JSON.stringify(sp), JSON.stringify(bp)].some((j) => j.includes(secret) || j.includes(people.eva.email) || j.includes("vendor")));

await gus.req("POST", "/api/updates", { sections: { workedOn: ["Routine work"], blockers: ["None"] }, submit: true });
await settled("gus submitted delivered", async () => ((await deliveriesOf("Daily Update Submitted")).filter((d) => d.status === "DELIVERED").length >= 2 ? true : undefined));
await sleep(6000);
check("'None' is not a blocker: no second blocker event", (await deliveriesOf("Employee Reports a Blocker")).length === 1);

const gusUpd = (await gus.req("GET", "/api/updates")).body.updates[0].id as string;
await admin.req("PATCH", "/api/automations/settings", { includeBlockerText: true });
const edit = await gus.req("PATCH", `/api/updates/${gusUpd}`, { sections: { workedOn: ["Routine work"], blockers: ["Staging database is down since morning"] } });
check("Gus edited his update to ADD a blocker (core succeeded)", edit.status === 200 && edit.body.status === "EDITED");
const blk2 = await settled("second blocker delivered", async () => (await deliveriesOf("Employee Reports a Blocker")).find((d) => d.status === "DELIVERED" && d.eventId !== blk.eventId));
const blk2Run = await until("second blocker run", async () => (await runsFor("UPDATE_BLOCKER_REPORTED")).find((r) => received(r)?.eventId === blk2.eventId));
check("opt-in on: blocker text included (and only then)", received(blk2Run).blocker?.text === "Staging database is down since morning");
await admin.req("PATCH", "/api/automations/settings", { includeBlockerText: false });
await gus.req("PATCH", `/api/updates/${gusUpd}`, { sections: { workedOn: ["Routine work v2"], blockers: ["Staging database is down since morning", "second one"] } });
await sleep(5000);
check("a later edit does not fire the blocker event again", (await deliveriesOf("Employee Reports a Blocker")).length === 2);
check("edits never re-fire 'submitted'", (await deliveriesOf("Daily Update Submitted")).length === 2);

// ── 4. missing updates via the cron route ───────────────────────────────────
// The people were created minutes ago, i.e. AFTER today's 00:01 cut-off, and Daymark deliberately doesn't remind someone who
// joined after the cut-off. Simulate people who joined earlier (the integration tests do the same).
psql(`update "Membership" set "createdAt" = now() - interval '3 days' where "organizationId"='${ORG}'`);
const set = await admin.req("PATCH", "/api/organization/settings", { updateCutoffTime: "00:01" });
check("cut-off set to 00:01 so today's cut-off has passed", set.status === 200);
check("cron route rejects a missing/wrong secret", (await fetch(`${BASE}/api/cron/integrations`)).status === 401 && (await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: "Bearer nope" } })).status === 401);
const [c1, c2] = await Promise.all([cronRes(), cronRes()]); // overlapping invocations, as Vercel can deliver
check("overlapping cron runs: both safe", !!c1 && !!c2, JSON.stringify([c1.skipped ?? c1.missing, c2.skipped ?? c2.missing]));
const missingEvents = () => Number(psql(`select count(*) from "IntegrationEvent" where "organizationId"='${ORG}' and type='UPDATE_MISSING'`));
await until("missing events created", async () => missingEvents() >= 3, 20_000, 1000);
check("exactly the people with no submitted update are 'missing' (Lia, Max, Finn — not Eva or Gus)", missingEvents() === 3, `events=${missingEvents()}`);
await settled("missing deliveries delivered", async () => ((await deliveriesOf("Daily Update Missing")).filter((d) => d.status === "DELIVERED").length === 3 ? true : undefined));
await cronRes(); await cronRes();
check("repeat cron runs create no duplicate events", missingEvents() === 3);
const mruns = await until("3 missing runs recorded", async () => { const r = await runsFor("UPDATE_MISSING"); return r.length >= 3 ? r : null; });
const names = mruns.map((r) => received(r)?.employee?.name).sort();
check("viaSocket received a reminder payload per missing person", JSON.stringify(names) === JSON.stringify(["Finn Forgetful", "Lia Live", "Max Manager"]), names.join(", "));
const finn = mruns.map(received).find((p) => p.employee.name === "Finn Forgetful");
check("missing payload: email, date, submit link, cut-off, timezone; no manager", finn.employee.email === people.finn.email && /\/my-updates\/new\?date=\d{4}-\d\d-\d\d$/.test(finn.reminder.submitUrl) && finn.reminder.cutoffTime === "00:01" && finn.reminder.timezone === "UTC" && finn.manager === undefined);

// ── 5. test event, paused flow, resume ─────────────────────────────────────
const t = await admin.req("POST", `/api/automations/flows/${idOf("UPDATE_SUBMITTED")}/test`, {});
check("Send test event → DELIVERED", t.status === 200 && t.body.results?.[0]?.status === "DELIVERED");
const testRun = await until("test run", async () => (await runsFor("UPDATE_SUBMITTED")).find((r) => received(r)?.test === true));
check("test event is synthetic (no real person)", received(testRun).employee.name === "Test Employee" && !JSON.stringify(received(testRun)).includes("Eva"));

await viasocket.user(ID).setFlowStatus(flows.UPDATE_SUBMITTED.scriptId, 2);
const paused = await admin.req("POST", `/api/automations/flows/${idOf("UPDATE_SUBMITTED")}/test`, {});
check("flow paused in viaSocket → real 400 'paused' → delivery SKIPPED, not retried", paused.body.results?.[0]?.status === "SKIPPED" && paused.body.results?.[0]?.errorCode === "FLOW_PAUSED", JSON.stringify(paused.body.results?.[0]));
const afterPause = (await admin.req("GET", "/api/automations")).body.flows.find((f: any) => f.id === idOf("UPDATE_SUBMITTED"));
check("Daymark marked the flow paused immediately", afterPause.status === "paused");
await viasocket.user(ID).setFlowStatus(flows.UPDATE_SUBMITTED.scriptId, 1);
await admin.req("POST", "/api/automations/sync", {});
const again = await admin.req("POST", `/api/automations/flows/${idOf("UPDATE_SUBMITTED")}/test`, {});
check("resumed → sync → deliveries work again", again.body.results?.[0]?.status === "DELIVERED");

// ── 6. at-least-once is real: a resend carries the SAME eventId (a flow can dedupe) ──
const did = psql(`select id from "IntegrationDelivery" where "organizationId"='${ORG}' and status='DELIVERED' and "integrationEventId" in (select id from "IntegrationEvent" where "eventId"='${blk.eventId}') limit 1`);
psql(`update "IntegrationDelivery" set status='PENDING', "nextAttemptAt"=now(), "lockedUntil"=null where id='${did}'`);
await cronRes(); // simulates a worker that crashed after the HTTP call but before recording it
const dupRuns = await until("duplicate run", async () => { const r = (await runsFor("UPDATE_BLOCKER_REPORTED")).filter((x) => received(x)?.eventId === blk.eventId); return r.length >= 2 ? r : null; }, 60_000);
const att = dupRuns.map((r) => received(r).attempt as number);
check("a resent event arrives with the same eventId and a higher attempt number", dupRuns.every((r) => received(r).eventId === blk.eventId) && att.includes(1) && Math.max(...att) >= 2, `attempts seen: ${att.sort().join(",")}`);

// ── 7. attempt history is visible ───────────────────────────────────────────
const hist = await admin.req("GET", `/api/automations/deliveries/${did}`);
check("retry history records every attempt (numbered, with outcome and status)", hist.body.attempts?.length >= 2 && hist.body.attempts.every((a: any, i: number) => a.attemptNumber === i + 1) && hist.body.attempts.at(-1).outcome === "SUCCESS", JSON.stringify(hist.body.attempts?.map((a: any) => [a.attemptNumber, a.outcome, a.httpStatus ?? a.errorCode])));
console.log(`(retries exercised for real during this run: ${retriesSeen})`);
await admin.req("PATCH", "/api/organization/settings", { updateCutoffTime: "18:00" });
// leave the organization clean for the Slack step: delete this script's flows (and let Daymark notice)
for (const f of Object.values(flows)) await viasocket.user(ID).deleteFlow(f.scriptId);
await admin.req("POST", "/api/automations/sync", {});
check("test flows removed; Daymark shows none", ((await admin.req("GET", "/api/automations")).body.flows as any[]).length === 0);
summary();
