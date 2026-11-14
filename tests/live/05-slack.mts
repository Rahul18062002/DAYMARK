// The three events, end to end, into REAL Slack — as a direct message to the person who authorized the test connection.
// Needs the test organization's identity to have a Slack connection (see README). Every message is made for this test.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BASE, CRON_SECRET, Daymark, automationToken, check, createFlow, identityOf, runHistory, runsOf, saveSteps, setTrigger, state, summary, until, viasocket } from "./lib.mts";

const ORG = state("org_id"), ID = identityOf(ORG), PW = state("pw");
const people = JSON.parse(readFileSync(`${process.env.LIVE_STATE_DIR}/people.json`, "utf8"));
const psql = (sql: string) => execSync(`psql "${process.env.DATABASE_URL}" -Atc ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
const user = viasocket.user(ID);

// 1. The connection (made by a person; the product never holds a token)
const conns = (await user.listConnections()).filter((c: any) => /slack/i.test(c.service_name ?? ""));
if (!conns.length) { console.log(`NOT CONNECTED: no Slack connection for ${ID} yet.`); process.exit(2); }
const conn: any = conns[0];
check("a Slack connection exists for this organization's identity and is not expired", !conn.isExpired);
const authId = conn.id as string;

// 2. Who authorized it? (so the DM goes to that person) — read with the person's own connection
const scriptId = (await user.findEnabled("slack")) ?? (await user.enable("slack", authId)).scriptId;
const who: any = await viasocket.runCode(scriptId, 'const r = await axios.get("https://slack.com/api/auth.test"); return { ok: r.data.ok, user_id: r.data.user_id, bot_id: r.data.bot_id ?? null, team: r.data.team }');
check("auth.test answered through the person's connection", who?.ok === true, `team=${who?.team}, bot=${who?.bot_id ? "yes" : "no"}`);
const target = process.env.SLACK_TEST_USER_ID ?? (who.bot_id ? "" : who.user_id);
if (!target) { console.log("The connection is a bot token, so the authorizing person's Slack ID is unknown. Re-run with SLACK_TEST_USER_ID=<their member id>."); process.exit(3); }
// ids are fetched, never guessed: confirm it is one of the workspace's selectable users
const opts: any = await user.listOptions("slack", "Send_Message", { fieldKey: "destination.userId", authId, existingFields: { destination: { messageto: "user" } } });
check("the target is a real selectable Slack user (from listOptions)", (opts.options ?? []).some((o: any) => o.value === target), `${(opts.options ?? []).length} users listed`);

// 3. Real flows: webhook trigger → Slack Send_Message (v107) as a DM to that person
const T = await automationToken(ID);
const tag = Date.now().toString(36);
const msg: Record<string, string> = {
  update: "`${b.employee.name}` (${b.employee.team ?? \"no team\"}) submitted the update for ${b.update.date}${b.update.isLate ? \" — late\" : \"\"}. ${b.update.url}",
  blocker: "`${b.employee.name}` reported a blocker on ${b.update.date}${b.blocker.text ? \": \" + b.blocker.text : \" (open the update for details)\"}. ${b.update.url}",
  missing: "Reminder for `${b.employee.name}`: no update yet for ${b.reminder.date}. Cut-off ${b.reminder.cutoffTime} ${b.reminder.timezone}. ${b.reminder.submitUrl}",
};
const defs = { UPDATE_SUBMITTED: "update", UPDATE_BLOCKER_REPORTED: "blocker", UPDATE_MISSING: "missing" } as const;
const flows: Record<string, { scriptId: string; title: string }> = {};
for (const [type, key] of Object.entries(defs)) {
  const title = `Slack test (${tag}) — ${type}`;
  const sid = await createFlow(T, { title, description: "Daymark → Slack DM test" });
  await setTrigger(T, sid, { triggerType: "webhook" });
  const code = `const b = context?.req?.body
const sent = await sendMessage({ inputData: {
  destination: { messageto: "user", userId: ["${target}"] },
  markdown_content: "*[Daymark test" + (b.test ? " event" : "") + "]* " + \`${msg[key]}\` + "\\n_eventId " + b.eventId + ", attempt " + b.attempt + "_"
}})
return { ok: sent?.ok, ts: sent?.ts, channel: sent?.channel, eventId: b.eventId, attempt: b.attempt }`;
  await saveSteps(T, sid, [{ stepname: "slack_dm", code, service_action_functions: [{ name: "sendMessage", auth_id: authId, action_id: "row1jrbor" }] }]);
  flows[type] = { scriptId: sid, title };
}
check("three Slack flows created", Object.keys(flows).length === 3);

const admin = await new Daymark().signIn(state("admin_email"), PW);
const sync = await admin.req("POST", "/api/automations/sync", {});
const idOf = (type: string) => sync.body.flows.find((f: any) => f.title === flows[type].title).id as string;
for (const type of Object.keys(defs)) check(`linked ${type}`, (await admin.req("PATCH", `/api/automations/flows/${idOf(type)}`, { eventType: type })).status === 200);

const pump = async () => { psql(`update "IntegrationDelivery" set "nextAttemptAt"=now() where "organizationId"='${ORG}' and status='PENDING' and "attemptCount">0`); await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: `Bearer ${CRON_SECRET()}` } }); };
const delivered = (label: string, find: () => Promise<any>) => until(label, async () => (await find()) ?? (await pump(), undefined), 120_000, 2500);
const deliveries = async (label: string) => ((await admin.req("GET", "/api/automations")).body.deliveries as any[]).filter((d) => d.eventLabel === label);
const slackRun = async (type: string, eventId: string) => (runsOf(await runHistory(T, flows[type].scriptId)) as any[]).filter((r) => { try { return JSON.parse(r.output)?.eventId === eventId; } catch { return false; } });
const okRun = (r: any) => { const o = JSON.parse(r.output); return o.ok === true && !!o.ts; };

// 4. Real events through the real app
const eva = await new Daymark().signIn(people.eva.email, PW);
const lia = await new Daymark().signIn(state("admin_email"), PW), max = await new Daymark().signIn(people.max.email, PW), gus = await new Daymark().signIn(people.gus.email, PW);
await eva.req("POST", "/api/updates", { sections: { workedOn: ["Slack end-to-end"], blockers: ["Waiting for credentials"] }, submit: true });
const sub = await delivered("submitted delivered", async () => (await deliveries("Daily Update Submitted")).find((d) => d.status === "DELIVERED"));
const blk = await delivered("blocker delivered", async () => (await deliveries("Employee Reports a Blocker")).find((d) => d.status === "DELIVERED"));
const sr = await until("slack run: submitted", async () => { const r = await slackRun("UPDATE_SUBMITTED", sub.eventId); return r.length ? r : null; }, 60_000);
const br = await until("slack run: blocker", async () => { const r = await slackRun("UPDATE_BLOCKER_REPORTED", blk.eventId); return r.length ? r : null; }, 60_000);
check("update.submitted → Slack accepted the DM (ok + message ts)", okRun(sr[0]), `step output: ${sr[0].output.replace(/"ts":"[^"]+"/, '"ts":"…"').slice(0, 120)}`);
check("update.blocker_reported → Slack accepted the DM (link-only: no blocker text)", okRun(br[0]));

// missing: everyone but Finn submits, so exactly one reminder is sent
for (const c of [lia, max, gus]) await c.req("POST", "/api/updates", { sections: { workedOn: ["Routine"] }, submit: true });
psql(`update "Membership" set "createdAt" = now() - interval '3 days' where "organizationId"='${ORG}'`);
await admin.req("PATCH", "/api/organization/settings", { updateCutoffTime: "00:01" });
await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: `Bearer ${CRON_SECRET()}` } });
const miss = await delivered("missing delivered", async () => (await deliveries("Daily Update Missing")).find((d) => d.status === "DELIVERED"));
const mr = await until("slack run: missing", async () => { const r = await slackRun("UPDATE_MISSING", miss.eventId); return r.length ? r : null; }, 60_000);
check("update.missing → Slack accepted the reminder DM", okRun(mr[0]));
check("exactly one reminder (only Finn was missing)", Number(psql(`select count(*) from "IntegrationEvent" where "organizationId"='${ORG}' and type='UPDATE_MISSING'`)) === 1);
await admin.req("PATCH", "/api/organization/settings", { updateCutoffTime: "18:00" });

// 5. at-least-once, deliberately: a resend reaches Slack twice (same eventId) unless the flow dedupes
const did = psql(`select d.id from "IntegrationDelivery" d join "IntegrationEvent" e on e.id=d."integrationEventId" where e."eventId"='${blk.eventId}' limit 1`);
psql(`update "IntegrationDelivery" set status='PENDING', "nextAttemptAt"=now(), "lockedUntil"=null where id='${did}'`);
await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: `Bearer ${CRON_SECRET()}` } });
const twice = await until("duplicate reached slack", async () => { const r = await slackRun("UPDATE_BLOCKER_REPORTED", blk.eventId); return r.length >= 2 ? r : null; }, 90_000);
check("a resend produced a second Slack DM with the SAME eventId (the documented at-least-once duplicate)", twice.every(okRun), `${twice.length} runs for one event`);

// 6. test event button, then clean up
const t = await admin.req("POST", `/api/automations/flows/${idOf("UPDATE_SUBMITTED")}/test`, {});
check("Send test event → delivered", t.body.results?.[0]?.status === "DELIVERED");
for (const f of Object.values(flows)) await user.deleteFlow(f.scriptId);
await admin.req("POST", "/api/automations/sync", {});
summary();
