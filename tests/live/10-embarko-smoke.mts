// End-to-end smoke + load test against the DEPLOYED app (LIVE_BASE=https://<app>.embarko.app, DIAG_TOKEN=…).
// Creates two throw-away organizations through the real API, exercises auth, invitations, daily updates,
// the manager view, tenant isolation, the scheduler route, then drives load while sampling real platform memory.
import { BASE, Daymark, check, summary, sleep } from "./lib.mts";

const DIAG = process.env.DIAG_TOKEN ?? "";
const tag = Date.now().toString(36);
const PW = `Smoke-${tag}-${Math.random().toString(36).slice(2, 10)}`;
const json = { "content-type": "application/json", origin: BASE };
const post = (p: string, b: unknown) => fetch(`${BASE}${p}`, { method: "POST", headers: json, body: JSON.stringify(b) });

async function mem() {
  const r = await fetch(`${BASE}/api/diag/memory`, { headers: { authorization: `Bearer ${DIAG}` } });
  if (!r.ok) return null;
  const d: any = await r.json();
  return { cur: d.cgroup.currentMB as number, peak: d.cgroup.peakMB as number, limit: d.cgroup.limitMB as number, anon: d.cgroup.anonMB as number, rss: d.process.rssMB as number, heap: d.process.heapUsedMB as number, up: d.uptimeS as number };
}
const show = (l: string, m: any) => console.log(`MEM ${l.padEnd(24)} cgroup ${m?.cur}/${m?.limit} MB (peak ${m?.peak}) anon ${m?.anon} | node rss ${m?.rss} heap ${m?.heap} | up ${m?.up}s`);

async function org(label: string) {
  const email = `${label}.${tag}@smoke.test`;
  const ob = await post("/api/onboarding", { organizationName: `Smoke ${label} ${tag}`, timezone: "Asia/Kolkata", name: `${label} Admin`, email, password: PW });
  check(`onboarding creates organization ${label}`, ob.ok, String(ob.status));
  const organizationId = ((await ob.json()) as any).organizationId as string;
  const admin = await new Daymark().signIn(email, PW);
  return { admin, email, organizationId };
}
async function member(admin: Daymark, key: string, role: "MANAGER" | "EMPLOYEE", teamId?: string) {
  const email = `${key}.${tag}@smoke.test`;
  const inv = await admin.req("POST", "/api/invitations", { email, role, teamId });
  const token = inv.body.inviteUrl.split("/invite/")[1];
  const acc = await post("/api/invitations/accept", { token, name: `${key} person`, password: PW });
  check(`invitation accepted: ${key} (${role})`, acc.ok, String(acc.status));
  return { c: await new Daymark().signIn(email, PW), email };
}

const m0 = await mem(); if (m0) show("idle (before tests)", m0);

// ── organization A: auth, invitations, updates, manager view ──
const A = await org("alpha");
const team = (await A.admin.req("POST", "/api/teams", { name: "Smoke Team" })).body.team.id;
const mgr = await member(A.admin, "mgr", "MANAGER");
const list0 = (await A.admin.req("GET", "/api/employees?status=ACTIVE")).body.employees as any[];
await A.admin.req("PATCH", `/api/teams/${team}`, { managerId: list0.find((e) => e.email === mgr.email).id });
const emps = [] as Awaited<ReturnType<typeof member>>[];
for (let i = 0; i < 5; i++) emps.push(await member(A.admin, `emp${i}`, "EMPLOYEE", team));
const me = await emps[0].c.req("GET", "/api/me");
check("employee session works (/api/me)", me.status === 200);
const noAuth = await fetch(`${BASE}/api/updates`, { headers: { origin: BASE } });
check("unauthenticated API call is rejected", noAuth.status === 401, String(noAuth.status));
const bad = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: json, body: JSON.stringify({ email: emps[0].email, password: "wrong-password-123" }) });
check("wrong password is rejected", bad.status === 401 || bad.status === 400, String(bad.status));

const subs = await Promise.all(emps.map((e, i) => e.c.req("POST", "/api/updates", { sections: { workedOn: [`work ${i}`], blockers: i === 0 ? ["blocked on infra"] : [] }, submit: true })));
check("5 employees submit updates in parallel", subs.every((s) => s.status === 200 || s.status === 201), subs.map((s) => s.status).join(","));
const dup = await emps[0].c.req("POST", "/api/updates", { sections: { workedOn: ["again"] }, submit: true });
check("a second update for the same day is refused (409)", dup.status === 409, String(dup.status));
const today = new Date().toISOString().slice(0, 10);
const view = await mgr.c.req("GET", `/api/team-updates?from=${today}&to=${today}`);
check("manager sees the team's submissions", view.status === 200 && JSON.stringify(view.body).includes("work 3"), String(view.status));
const empView = await emps[1].c.req("GET", `/api/team-updates?from=${today}&to=${today}`);
check("an employee cannot use the team view", empView.status === 403 || empView.status === 404, String(empView.status));

// ── organization B: isolation ──
const B = await org("bravo");
const ids = ((view.body as any)?.rows ?? []).find((r: any) => r.updateId)?.updateId as string | undefined;
check("found one of A's update ids to probe with", !!ids);
const cross = ids ? await B.admin.req("GET", `/api/team-updates/${ids}`) : { status: 0 };
check("another organization's admin cannot read A's update", cross.status === 404, String(cross.status));
const bView = await B.admin.req("GET", `/api/team-updates?from=${today}&to=${today}`);
check("organization B sees none of A's updates", !JSON.stringify(bView.body).includes("work 3"));

// ── scheduler route ──
const cronNo = await fetch(`${BASE}/api/cron/integrations`);
check("scheduler route refuses a missing secret (401)", cronNo.status === 401, String(cronNo.status));
const cronBad = await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: "Bearer wrong" } });
check("scheduler route refuses a wrong secret (401)", cronBad.status === 401, String(cronBad.status));

// ── load: pages (server-rendered) and API with real sessions, sampling platform memory ──
const m1 = await mem(); if (m1) show("after functional tests", m1);
const sessions = [mgr.c, A.admin, ...emps.map((e) => e.c)];
const paths = ["/dashboard", "/team-updates", "/my-updates", "/automations", "/settings", "/people"];
const errs = new Map<string, number>(); let ok = 0, bad2 = 0; const lat: number[] = [];
const DURATION = Number(process.env.LOAD_SECONDS ?? 90), CONC = Number(process.env.LOAD_CONC ?? 12);
const end = Date.now() + DURATION * 1000; let peakSeen = m1?.cur ?? 0; const samples: any[] = [];
async function worker(w: number) {
  while (Date.now() < end) {
    const s = sessions[(w + ok) % sessions.length], p = paths[(w + ok + bad2) % paths.length];
    const t = Date.now();
    let why = ""; const r = await fetch(`${BASE}${p}`, { headers: { cookie: s.cookie }, redirect: "manual" }).catch((e) => { why = String(e?.cause?.code ?? e?.cause?.message ?? e?.message); return null; });
    if (r && r.status < 500) { ok++; await r.arrayBuffer(); } else { bad2++; const k = `${p} ${r ? r.status : "network-error:" + why}`; errs.set(k, (errs.get(k) ?? 0) + 1); }
    lat.push(Date.now() - t);
  }
}
const sampler = (async () => { while (Date.now() < end) { await sleep(5000); const m = await mem(); if (m) { samples.push(m); peakSeen = Math.max(peakSeen, m.cur, m.peak); } } })();
await Promise.all([...Array.from({ length: CONC }, (_, w) => worker(w)), sampler]);
lat.sort((a, b) => a - b);
if (errs.size) console.log("LOAD errors by path/status:", JSON.stringify([...errs]));
console.log(`LOAD ${DURATION}s, ${CONC} concurrent: ${ok} ok, ${bad2} errors, p50 ${lat[Math.floor(lat.length * 0.5)]}ms p95 ${lat[Math.floor(lat.length * 0.95)]}ms`);
const m2 = await mem(); if (m2) show("end of load", m2);
if (samples.length) console.log("MEM samples (cgroup MB):", samples.map((s) => s.cur).join(" "));
check("load run had no server errors", bad2 === 0, `${bad2} errors of ${ok + bad2}`);
check("memory stayed under the 256 MB limit (cgroup peak)", !!m2 && m2.peak < m2.limit, `peak ${m2?.peak} MB`);
check("memory peak leaves ≥ 20% headroom", !!m2 && m2.peak < m2.limit * 0.8, `peak ${m2?.peak} / ${m2?.limit} MB`);
console.log(`STATE alpha=${A.organizationId} email=${A.email} password=${PW}`);
summary();
