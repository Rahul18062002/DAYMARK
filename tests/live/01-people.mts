// Creates a small team in the live test organization through Daymark's real API.
import { writeFileSync } from "node:fs";
import { BASE, Daymark, state, check, summary } from "./lib.mts";

const tag = Date.now().toString(36);
const PW = `Live-${tag}-${Math.random().toString(36).slice(2, 10)}`;
const ADMIN = `lia.${tag}@daymark-live.test`;
const ob = await fetch(`${BASE}/api/onboarding`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ organizationName: `Daymark Live Test ${tag}`, timezone: "UTC", name: "Lia Live", email: ADMIN, password: PW }) });
check("created a fresh live organization", ob.ok);
const ORG = ((await ob.json()) as any).organizationId as string;
const dir = process.env.LIVE_STATE_DIR!;
writeFileSync(`${dir}/org_id`, ORG); writeFileSync(`${dir}/pw`, PW); writeFileSync(`${dir}/admin_email`, ADMIN);
const admin = await new Daymark().signIn(ADMIN, PW);
const team = (await admin.req("POST", "/api/teams", { name: "Live Team" })).body.team.id;
const people: Record<string, { email: string; id: string }> = {};

async function add(key: string, name: string, role: "MANAGER" | "EMPLOYEE", teamId?: string) {
  const email = `${key}.${tag}@daymark-live.test`;
  const inv = await admin.req("POST", "/api/invitations", { email, role, teamId });
  const token = inv.body.inviteUrl.split("/invite/")[1];
  const acc = await fetch(`${BASE}/api/invitations/accept`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ token, name, password: PW }) });
  check(`created ${role.toLowerCase()} ${name}`, acc.ok);
  const list = (await admin.req("GET", "/api/employees?status=ACTIVE")).body.employees as any[];
  people[key] = { email, id: list.find((e) => e.email === email).id };
}
await add("max", "Max Manager", "MANAGER");
await admin.req("PATCH", `/api/teams/${team}`, { managerId: people.max.id });
await add("eva", "Eva Employee", "EMPLOYEE", team);
await add("finn", "Finn Forgetful", "EMPLOYEE", team);
await add("gus", "Gus Good", "EMPLOYEE", team);
// every day counts as a working day so the run doesn't depend on the weekday
const s = await admin.req("PATCH", "/api/organization/settings", { workingDays: [1, 2, 3, 4, 5, 6, 7] });
check("all days are working days", s.status === 200);
writeFileSync(`${process.env.LIVE_STATE_DIR}/people.json`, JSON.stringify(people));
summary();
