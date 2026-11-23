// Fills a running Daymark with a realistic demo company: people, hierarchy, goals that cascade, KPIs and a fortnight of updates.
// For screenshots and demos only. LIVE_BASE=http://localhost:3500 npx tsx tests/live/20-demo-data.mts
import { BASE, Daymark } from "./lib.mts";

const tag = Date.now().toString(36);
const PW = `Demo-${tag}-Xk29qz`;
const post = (p: string, b: unknown) => fetch(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(b) });
const ob = await post("/api/onboarding", { organizationName: "Northwind Labs", timezone: "Asia/Kolkata", name: "Priya Nair", email: `priya.${tag}@northwind.test`, password: PW });
if (!ob.ok) throw new Error("onboarding failed " + ob.status);
// Sign-in is rate limited (10 a minute per address); pace ourselves instead of weakening the limit.
let signIns = 0;
const signIn = async (email: string, pw: string) => { if (++signIns % 9 === 0) { console.log("pausing 62 s for the sign-in rate limit…"); await new Promise((r) => setTimeout(r, 62_000)); } return new Daymark().signIn(email, pw); };
const ceo = await signIn(`priya.${tag}@northwind.test`, PW);
const R = async (m: string, p: string, b?: unknown) => { const r = await ceo.req(m, p, b); if (r.status >= 400) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body as any; };

const ceoId = ((await R("GET", "/api/employees?status=ACTIVE")).employees as any[]).find((e) => e.email.startsWith("priya.")).id as string;
const dept: Record<string, string> = {};
for (const n of ["Engineering", "Sales", "Customer Success"]) dept[n] = (await R("POST", "/api/departments", { name: n })).department.id;
const people: Record<string, { c: Daymark; id: string }> = {};
async function add(key: string, name: string, role: "MANAGER" | "EMPLOYEE", extra: Record<string, unknown> = {}) {
  const email = `${key}.${tag}@northwind.test`;
  const inv = await R("POST", "/api/invitations", { email, role, ...extra });
  const token = inv.inviteUrl.split("/invite/")[1];
  const acc = await post("/api/invitations/accept", { token, name, password: PW }); if (!acc.ok) throw new Error("accept " + name);
  const list = (await R("GET", "/api/employees?status=ACTIVE")).employees as any[];
  people[key] = { c: await signIn(email, PW), id: list.find((e) => e.email === email).id };
}
await add("arjun", "Arjun Mehta", "MANAGER");                    // VP Engineering
await add("sara", "Sara Khan", "MANAGER");                       // VP Sales
await add("dev", "Dev Patel", "MANAGER");                        // Eng lead
await add("lena", "Lena Fischer", "MANAGER");                    // CS lead
const P = (k: string) => people[k].id;
await R("PATCH", `/api/employees/${ceoId}`, { jobTitle: "Chief Executive Officer", level: 1 });
for (const [k, mgr, job, lvl] of [["arjun", "ceo", "VP Engineering", 2], ["sara", "ceo", "VP Sales", 2], ["dev", "arjun", "Engineering Lead", 3], ["lena", "sara", "Customer Success Lead", 3]] as const) await R("PATCH", `/api/employees/${P(k)}`, { jobTitle: job, level: lvl, ...(mgr ? { managerId: mgr === "ceo" ? ceoId : P(mgr) } : {}) });
const team: Record<string, string> = {};
team.platform = (await R("POST", "/api/teams", { name: "Platform", departmentId: dept.Engineering, managerId: P("dev") })).team.id;
team.growth = (await R("POST", "/api/teams", { name: "Growth", departmentId: dept.Sales, managerId: P("sara") })).team.id;
team.success = (await R("POST", "/api/teams", { name: "Success", departmentId: dept["Customer Success"], managerId: P("lena") })).team.id;
await R("PATCH", `/api/employees/${P("dev")}`, { teamId: team.platform });
await R("PATCH", `/api/employees/${P("lena")}`, { teamId: team.success });
await R("PATCH", `/api/employees/${P("sara")}`, { teamId: team.growth });
const staff: [string, string, string, string, string][] = [
  ["maya", "Maya Rao", "platform", "dev", "Backend Engineer"], ["omar", "Omar Haddad", "platform", "dev", "Site Reliability Engineer"], ["chen", "Chen Wei", "platform", "dev", "Frontend Engineer"],
  ["ivy", "Ivy Brooks", "growth", "sara", "Account Executive"], ["noah", "Noah Silva", "growth", "sara", "Sales Development Rep"], ["tara", "Tara Singh", "growth", "sara", "Account Executive"],
  ["liam", "Liam O'Brien", "success", "lena", "Customer Success Manager"], ["zara", "Zara Ali", "success", "lena", "Support Specialist"],
];
for (const [k, n, t, m, job] of staff) { await add(k, n, "EMPLOYEE", { teamId: team[t], managerId: P(m) }); await R("PATCH", `/api/employees/${P(k)}`, { jobTitle: job, level: 4 }); }
await R("PATCH", "/api/organization/settings", { workingDays: [1, 2, 3, 4, 5, 6, 7], visibilityScope: "COMPANY", peersSeeBlockers: false });

// goals that cascade from the CEO
const q = { periodStart: "2026-10-01", periodEnd: "2026-12-31" };
const goal = async (c: Daymark, b: object) => (await c.req("POST", "/api/objectives", { ...q, ...b })).body.id as string;
const kr = async (c: Daymark, id: string, b: object) => (await c.req("POST", `/api/objectives/${id}/key-results`, b)).body.id as string;
const chk = (c: Daymark, id: string, ...vals: [number, string, string?][]) => vals.reduce((p, [v, conf, note]) => p.then(() => c.req("POST", `/api/key-results/${id}/check-ins`, { value: v, confidence: conf, comment: note ?? null })).then(() => undefined), Promise.resolve());
const task = (c: Daymark, id: string, b: object) => c.req("POST", `/api/objectives/${id}/tasks`, b);

const g1 = await goal(ceo, { title: "Reach $12M annual recurring revenue", description: "Our single most important number this quarter. Everything else supports it.", level: "COMPANY" });
const g2 = await goal(ceo, { title: "Be the most reliable platform in our category", level: "COMPANY" });
const k1 = await kr(ceo, g1, { title: "Annual recurring revenue", type: "NUMBER", startValue: 8.4, targetValue: 12, unit: "$M", isKpi: true, weight: 3 });
await chk(ceo, k1, [8.9, "ON_TRACK", "Two enterprise renewals closed"], [9.6, "ON_TRACK"], [10.1, "AT_RISK", "Pipeline slower than planned in November"]);
const k2 = await kr(ceo, g1, { title: "Net revenue retention", type: "PERCENT", startValue: 96, targetValue: 110 }); await chk(ceo, k2, [101, "ON_TRACK"], [104, "ON_TRACK"]);
const k3 = await kr(ceo, g2, { title: "Uptime", type: "PERCENT", startValue: 99.5, targetValue: 99.99, isKpi: true }); await chk(ceo, k3, [99.8, "ON_TRACK"], [99.93, "ON_TRACK"]);

const dSales = await goal(ceo, { title: "Close 40 new enterprise accounts", level: "DEPARTMENT", departmentId: dept.Sales, ownerId: P("sara"), parentId: g1 });
const dEng = await goal(ceo, { title: "Ship the v2 platform and retire the legacy stack", level: "DEPARTMENT", departmentId: dept.Engineering, ownerId: P("arjun"), parentId: g2 });
const dCs = await goal(ceo, { title: "Keep churn under 3% a quarter", level: "DEPARTMENT", departmentId: dept["Customer Success"], ownerId: P("lena"), parentId: g1 });
const ks1 = await kr(people.sara.c, dSales, { title: "Enterprise accounts closed", type: "NUMBER", startValue: 0, targetValue: 40, unit: "accounts", ownerId: P("sara") }); await chk(people.sara.c, ks1, [9, "ON_TRACK"], [17, "AT_RISK", "Two deals slipped to January"]);
const ke1 = await kr(people.arjun.c, dEng, { title: "Services migrated to v2", type: "NUMBER", startValue: 0, targetValue: 24, unit: "services", ownerId: P("arjun") }); await chk(people.arjun.c, ke1, [8, "ON_TRACK"], [15, "ON_TRACK"]);
const kc1 = await kr(people.lena.c, dCs, { title: "Quarterly churn", type: "PERCENT", startValue: 6, targetValue: 3, isKpi: true, ownerId: P("lena") }); await chk(people.lena.c, kc1, [5, "ON_TRACK"], [4.2, "ON_TRACK"]);

const tPlat = await goal(people.arjun.c, { title: "Migrate billing and auth to v2", level: "TEAM", teamId: team.platform, ownerId: P("dev"), parentId: dEng });
const tGrowth = await goal(people.sara.c, { title: "Build a repeatable outbound motion", level: "TEAM", teamId: team.growth, ownerId: P("sara"), parentId: dSales });
const kt1 = await kr(people.dev.c, tPlat, { title: "Zero-downtime cutovers", type: "NUMBER", startValue: 0, targetValue: 6, ownerId: P("dev") }); await chk(people.dev.c, kt1, [2, "ON_TRACK"], [4, "ON_TRACK", "Billing done, auth next"]);
const kt2 = await kr(people.sara.c, tGrowth, { title: "Qualified meetings booked", type: "NUMBER", startValue: 0, targetValue: 120, ownerId: P("sara") }); await chk(people.sara.c, kt2, [30, "ON_TRACK"], [52, "AT_RISK"]);

const iMaya = await goal(people.maya.c, { title: "Cut over the billing service", level: "INDIVIDUAL", parentId: tPlat });
const iOmar = await goal(people.omar.c, { title: "Automate failover testing", level: "INDIVIDUAL", parentId: tPlat });
const iIvy = await goal(people.ivy.c, { title: "Land three Fortune 500 pilots", level: "INDIVIDUAL", parentId: tGrowth });
const km = await kr(people.maya.c, iMaya, { title: "Billing traffic on v2", type: "PERCENT", startValue: 0, targetValue: 100, ownerId: P("maya") }); await chk(people.maya.c, km, [40, "ON_TRACK"], [85, "ON_TRACK"]);
const ko = await kr(people.omar.c, iOmar, { title: "Failover drills passing", type: "NUMBER", startValue: 0, targetValue: 12, ownerId: P("omar") }); await chk(people.omar.c, ko, [2, "AT_RISK", "Flaky test environment"]);
const ki = await kr(people.ivy.c, iIvy, { title: "Pilots signed", type: "NUMBER", startValue: 0, targetValue: 3, ownerId: P("ivy") }); await chk(people.ivy.c, ki, [1, "ON_TRACK"]);
for (const [c, id, title, who, st] of [[people.dev.c, tPlat, "Write the auth cutover runbook", "dev", "IN_PROGRESS"], [people.dev.c, tPlat, "Load-test the v2 gateway", "omar", "TODO"], [people.maya.c, iMaya, "Dual-write billing events", "maya", "DONE"], [people.maya.c, iMaya, "Reconcile invoices after cutover", "maya", "TODO"]] as const) {
  const r = await task(c, id, { title, assigneeId: P(who), dueDate: "2026-12-05" }); if (st !== "TODO") await c.req("PATCH", `/api/tasks/${r.body.id}`, { status: st });
}

// a fortnight of updates
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const works = ["Migrated the invoice worker to v2 and verified parity", "Paired on the auth cutover plan; documented rollback steps", "Reviewed 6 pull requests and fixed two flaky tests", "Ran discovery calls with three prospects", "Prepared the pilot proposal and security questionnaire", "Handled 24 support tickets, escalated 2 to engineering", "Drafted the quarterly business review deck"];
let n = 0;
for (const [k, p] of Object.entries(people)) for (let d = 0; d < 7; d++) {
  if ((n++ + d) % 6 === 0) continue;                                           // a few gaps, like real life
  await p.c.req("POST", "/api/updates", { updateDate: day(d), submit: true, sections: { workedOn: [works[(n + d) % works.length]], completed: d % 2 ? ["Closed the loop with the customer"] : [], blockers: k === "omar" && d < 2 ? ["Test environment keeps timing out"] : [] } });
}
console.log(`DEMO email=priya.${tag}@northwind.test password=${PW}`);
