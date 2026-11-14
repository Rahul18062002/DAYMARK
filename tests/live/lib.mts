// Real-connection test harness. NOT product code and NOT part of CI: it talks to a running Daymark server
// and to real viaSocket with your own keys. See tests/live/README.md.
import { readFileSync } from "node:fs";
import { ViaSocket } from "viasocket-apps";

export const BASE = process.env.LIVE_BASE ?? "http://localhost:3300";
const STATE = process.env.LIVE_STATE_DIR ?? ".live";
export const state = (name: string) => readFileSync(`${STATE}/${name}`, "utf8").trim();

function dotenv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = { ...dotenv(".env"), ...process.env } as Record<string, string>;
export const ORG_ID = env.VIASOCKET_ORG_ID, PROJECT_ID = env.VIASOCKET_PROJECT_ID;
export const viasocket = new ViaSocket({ orgId: ORG_ID, projectId: PROJECT_ID, secret: env.VIASOCKET_EMBED_SECRET });
export const identityOf = (daymarkOrgId: string) => `daymark-org-${daymarkOrgId}`;
export const CRON_SECRET = () => state("cron_secret");

// ── Daymark HTTP client (real session cookie, like a browser) ────────────────────────────────
export class Daymark {
  cookie = "";
  async signIn(email: string, password: string) {
    const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
    this.cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return this;
  }
  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", origin: BASE, cookie: this.cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as T };
  }
}

// ── Automation API (copied from viasocket.com/docs/automations.md; used only to build TEST flows) ──
const API = "https://flow-api.viasocket.com";
async function call(token: string, method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", proxy_auth_token: token }, body: body && JSON.stringify(body) });
  const payload: any = await res.json();
  if (!res.ok) throw new Error(payload?.message || `${method} ${url}: ${res.status}`);
  return payload.data;
}
export async function automationToken(userId: string) {
  const res = await fetch(`${API}/users/register`, { headers: { authorization: await viasocket.user(String(userId)).token() } });
  const payload: any = await res.json();
  if (!res.ok) throw new Error(payload?.message || `automationToken: ${res.status}`);
  return payload.data.token as string;
}
export const createFlow = async (token: string, a: { title: string; description: string }) => (await call(token, "POST", `${API}/automations`, a)).script_id as string;
export const setTrigger = (token: string, scriptId: string, trigger: object) => call(token, "POST", `${API}/automations/${scriptId}/trigger`, trigger);
export const saveSteps = (token: string, scriptId: string, steps: object[]) => call(token, "POST", `${API}/automations/${scriptId}/steps`, { steps });
export const readFlow = (token: string, scriptId: string) => call(token, "GET", `${API}/automations/${scriptId}`);
export async function runHistory(token: string, scriptId: string, { page = 1, limit = 40 } = {}) {
  const url = `${API}/logs/orgId/${ORG_ID}?projectId=${PROJECT_ID}&scriptId=${scriptId}&page=${page}&limit=${limit}`;
  const res = await fetch(url, { headers: { proxy_auth_token: token } });
  if (!res.ok) throw new Error(`runHistory: ${res.status}`);
  return ((await res.json()) as any).data as { finalResponse?: any[] } | any[];
}
export const runsOf = (h: any): any[] => (Array.isArray(h) ? h : h?.finalResponse ?? []);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(label: string, fn: () => Promise<T | null | false | undefined>, ms = 60_000, every = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(every);
  }
}
let pass = 0, fail = 0;
export function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
}
export const summary = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
