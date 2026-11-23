import { expect, test, type Page } from "@playwright/test";
import { A, addMemberApi, anonApi, apiAs, createOrgApi, login, newCtx, uniq } from "./helpers";
import { orgIdOf, seedDelivery, seedFlow } from "./seed";

const tag = uniq();
const E = (n: string) => `${n}-${tag}@auto.test`;
const admin = { org: `Auto ${tag}`, name: "Ada Admin", email: E("ada") };
const mgr = { name: "Mona Manager", email: E("mona") };
const emp = { name: "Eddie Employee", email: E("eddie") };

let adminApi: Awaited<ReturnType<typeof createOrgApi>>;
let orgId = "";
let activeFlowId = "", pausedFlowId = "", failedDeliveryId = "";

const noHScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1);
// Keep the real viaSocket embed out of CI-style runs: block its script so the isolated error state is deterministic.
async function signIn(page: Page, email: string) {
  await login(page, email);
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible(); // wait until the session really exists
}
const blockEmbed = (page: Page) => page.route("https://embed.viasocket.com/**", (r) => r.abort());

test.describe.serial("Daymark × viaSocket — Automations (UI, permissions, isolation)", () => {
  test.beforeAll(async () => {
    adminApi = await createOrgApi(A, admin);
    orgId = await orgIdOf(admin.email);
    await addMemberApi(A, adminApi, { role: "MANAGER", ...mgr });
    await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...emp });
    activeFlowId = (await seedFlow(orgId, { title: "Slack: blocker alert", status: "active" })).id;
    pausedFlowId = (await seedFlow(orgId, { title: "Email: weekly digest", status: "paused" })).id;
    await seedDelivery(orgId, activeFlowId, { status: "DELIVERED", attempts: [{ outcome: "SUCCESS", httpStatus: 200 }] });
    failedDeliveryId = (await seedDelivery(orgId, activeFlowId, {
      status: "FAILED", type: "UPDATE_BLOCKER_REPORTED",
      attempts: [{ outcome: "RETRYABLE_ERROR", httpStatus: 503, errorMessage: "viaSocket answered with status 503." }, { outcome: "RETRYABLE_ERROR", httpStatus: 503, errorMessage: "viaSocket answered with status 503." }, { outcome: "RETRYABLE_ERROR", httpStatus: 503, errorMessage: "viaSocket answered with status 503." }],
    })).delivery.id;
  });

  test("admin: sees Automations, the page loads, and a viaSocket outage is contained to the builder panel", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await blockEmbed(page);
    await login(page, admin.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    await nav.getByRole("link", { name: "Automations" }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
    await expect(page.getByTestId("viasocket-embed")).toBeAttached();
    await expect(page.getByText("The automation builder couldn't load")).toBeVisible();
    await expect(page.getByText(/Daymark itself is unaffected/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // Everything else on the page, and the rest of Daymark, still works.
    await expect(page.getByTestId("flow-row")).toHaveCount(2);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await page.goto("/my-updates");
    await expect(page.getByRole("heading", { name: "My Updates", level: 1 })).toBeVisible();
    await ctx.close();
  });

  test("admin: link a flow to a Daymark event (persists, never exposes a URL), and the field documentation is shown", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await blockEmbed(page);
    await signIn(page, admin.email);
    await page.goto("/automations");
    const row = page.getByTestId("flow-row").filter({ hasText: "Email: weekly digest" });
    await expect(row.getByText("paused", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Send test event" })).toBeDisabled(); // not linked / not active
    await row.getByLabel(/Starts when/).selectOption({ label: "Daily Update Missing" });
    await expect(page.getByText("Automation linked")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("flow-row").filter({ hasText: "Email: weekly digest" }).getByLabel(/Starts when/)).toHaveValue("UPDATE_MISSING");
    await expect(page.getByTestId("flow-row").filter({ hasText: "Email: weekly digest" }).getByRole("button", { name: "Send test event" })).toBeDisabled(); // linked but paused
    // The page and its data never contain a flow URL or the embed secret.
    const html = await page.content();
    expect(html).not.toContain("flow.sokt.io");
    expect(html).not.toContain(process.env.VIASOCKET_EMBED_SECRET!);
    // unlink
    await page.getByTestId("flow-row").filter({ hasText: "Email: weekly digest" }).getByLabel(/Starts when/).selectOption({ label: "Not linked" });
    await expect(page.getByText("Automation unlinked")).toBeVisible();

    // Documentation of what each event sends.
    await page.getByText("Daily Update Missing").last().click();
    await expect(page.getByText("reminder.submitUrl").last()).toBeVisible();
    await page.getByText("Employee Reports a Blocker").last().click();
    await expect(page.getByText("blocker.text")).toBeVisible();
    await expect(page.getByText(/Only when an admin enabled/)).toBeVisible();
    await ctx.close();
  });

  test("admin: delivery history shows each event, its status and every attempt (retry history)", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await blockEmbed(page);
    await signIn(page, admin.email);
    await page.goto("/automations");
    await expect(page.getByText("at-least-once", { exact: true })).toBeVisible();
    const rows = page.getByTestId("delivery-row");
    await expect(rows).toHaveCount(2);
    const failed = rows.filter({ hasText: "Employee Reports a Blocker" });
    await expect(failed.getByText("Failed", { exact: true })).toBeVisible();
    await expect(failed.getByText("3 attempts")).toBeVisible();
    await failed.getByRole("button").first().click();
    await expect(failed.getByText(/Event ID/)).toBeVisible();
    await expect(failed.locator("tbody tr")).toHaveCount(3);
    await expect(failed.getByText("viaSocket answered with status 503.").first()).toBeVisible();
    const ok = rows.filter({ hasText: "Daily Update Submitted" });
    await expect(ok.getByText("Accepted by viaSocket", { exact: true })).toBeVisible();
    await ctx.close();
  });

  test("admin: settings — manager access and blocker text are off by default and persist", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await blockEmbed(page);
    await signIn(page, admin.email);
    await page.goto("/automations");
    const managers = page.getByLabel(/Allow managers to manage Automations/);
    const blockerText = page.getByLabel(/Include blocker text/);
    await expect(managers).not.toBeChecked();
    await expect(blockerText).not.toBeChecked();
    await blockerText.check();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Include blocker text/)).toBeChecked();
    await page.getByLabel(/Include blocker text/).uncheck();
    await expect(page.getByText("Settings saved").last()).toBeVisible();
    await ctx.close();
  });

  test("manager: no access by default (nav, page, API) — and access only while an admin allows it", async ({ browser }) => {
    const mApi = await apiAs(A, mgr.email);
    for (const [method, path] of [["get", "/api/automations"], ["get", "/api/viasocket/token"], ["post", "/api/automations/sync"], ["patch", `/api/automations/flows/${activeFlowId}`], ["post", `/api/automations/flows/${activeFlowId}/test`], ["get", `/api/automations/deliveries/${failedDeliveryId}`]] as const) {
      const res = await (mApi as any)[method](path, method === "get" ? undefined : { data: {} });
      expect(res.status(), `${method} ${path}`).toBe(403);
    }
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await blockEmbed(page);
    await login(page, mgr.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Automations" })).toHaveCount(0);
    await page.goto("/automations");
    await expect(page).toHaveURL(/\/dashboard$/);

    // The admin authorizes managers.
    expect((await adminApi.patch("/api/automations/settings", { data: { managerAccess: true } })).ok()).toBeTruthy();
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Automations" }).click();
    await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
    await expect(page.getByText("Allow managers to manage Automations")).toHaveCount(0); // settings stay admin-only
    expect((await mApi.get("/api/automations")).ok()).toBeTruthy();
    expect((await mApi.patch("/api/automations/settings", { data: { includeBlockerText: true } })).status()).toBe(403);
    expect((await mApi.get("/api/viasocket/token")).ok()).toBeTruthy();

    // …and revokes it again.
    expect((await adminApi.patch("/api/automations/settings", { data: { managerAccess: false } })).ok()).toBeTruthy();
    expect((await mApi.get("/api/automations")).status()).toBe(403);
    await page.goto("/automations");
    await expect(page).toHaveURL(/\/dashboard$/);
    await ctx.close();
  });

  test("employee: never — nav, page and every API refuse", async ({ browser }) => {
    expect((await adminApi.patch("/api/automations/settings", { data: { managerAccess: true } })).ok()).toBeTruthy(); // even with manager access on
    const eApi = await apiAs(A, emp.email);
    for (const [method, path] of [["get", "/api/automations"], ["get", "/api/viasocket/token"], ["post", "/api/automations/sync"], ["patch", `/api/automations/flows/${activeFlowId}`], ["post", `/api/automations/flows/${activeFlowId}/test`], ["get", `/api/automations/deliveries/${failedDeliveryId}`], ["patch", "/api/automations/settings"]] as const) {
      const res = await (eApi as any)[method](path, method === "get" ? undefined : { data: { managerAccess: true } });
      expect(res.status(), `${method} ${path}`).toBe(403);
    }
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await login(page, emp.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Automations" })).toHaveCount(0);
    await page.goto("/automations");
    await expect(page).toHaveURL(/\/dashboard$/);
    await ctx.close();
    expect((await adminApi.patch("/api/automations/settings", { data: { managerAccess: false } })).ok()).toBeTruthy();
  });

  test("unauthenticated callers are refused everywhere; the cron route needs its secret", async () => {
    const anon = await anonApi(A);
    for (const p of ["/api/automations", "/api/viasocket/token", `/api/automations/deliveries/${failedDeliveryId}`]) expect((await anon.get(p)).status(), p).toBe(401);
    for (const p of ["/api/automations/sync", `/api/automations/flows/${activeFlowId}/test`]) expect((await anon.post(p, { data: {} })).status(), p).toBe(401);
    expect((await anon.patch(`/api/automations/flows/${activeFlowId}`, { data: { eventType: null } })).status()).toBe(401);
    expect((await anon.patch("/api/automations/settings", { data: { managerAccess: true } })).status()).toBe(401);

    expect((await anon.get("/api/cron/integrations")).status()).toBe(401);
    expect((await anon.get("/api/cron/integrations", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
    expect((await anon.get("/api/cron/integrations", { headers: { authorization: process.env.CRON_SECRET! } })).status()).toBe(401);
    const ok = await anon.get("/api/cron/integrations", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toHaveProperty("sweep");
    // Two overlapping cron invocations (Vercel can deliver twice) are both safe.
    const [x, y] = await Promise.all([1, 2].map(() => anon.get("/api/cron/integrations", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })));
    expect([x.status(), y.status()]).toEqual([200, 200]);
  });

  test("the embed token is signed for the SESSION's organization only, and never carries the secret", async () => {
    const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    const r = await adminApi.get("/api/viasocket/token");
    expect(r.ok()).toBeTruthy();
    const { token } = await r.json();
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain(process.env.VIASOCKET_EMBED_SECRET!);
    expect(decode(token)).toMatchObject({ unique_identifier: `daymark-org-${orgId}`, org_id: "test-org", project_id: "test-project" });
    // Nothing in the query string can change the identity.
    const spoof = await (await adminApi.get(`/api/viasocket/token?organizationId=other&unique_identifier=daymark-org-other&userId=x`)).json();
    expect(decode(spoof.token).unique_identifier).toBe(`daymark-org-${orgId}`);
    expect((await adminApi.get("/api/viasocket/token?apps=../../etc")).status()).toBe(400);
    expect((await adminApi.get("/api/viasocket/token?apps=a,b,c,d")).status()).toBe(400);

    const rival = await createOrgApi(A, { org: `Rival ${tag}`, name: "Rita Rival", email: E("rita") });
    const rt = decode((await (await rival.get("/api/viasocket/token")).json()).token);
    expect(rt.unique_identifier).toMatch(/^daymark-org-/);
    expect(rt.unique_identifier).not.toBe(`daymark-org-${orgId}`);
  });

  test("another organization sees none of this: flows, history, linking, testing — all 404/empty", async () => {
    const rival = await apiAs(A, E("rita"));
    const list = await (await rival.get("/api/automations")).json();
    expect(list.flows).toEqual([]);
    expect(list.deliveries).toEqual([]);
    expect(JSON.stringify(list)).not.toContain("Slack: blocker alert");
    expect((await rival.patch(`/api/automations/flows/${activeFlowId}`, { data: { eventType: "UPDATE_SUBMITTED" } })).status()).toBe(404);
    expect((await rival.post(`/api/automations/flows/${activeFlowId}/test`, { data: {} })).status()).toBe(404);
    expect((await rival.get(`/api/automations/deliveries/${failedDeliveryId}`)).status()).toBe(404);
    // A's data is untouched.
    const mine = await (await adminApi.get("/api/automations")).json();
    expect(mine.flows.find((f: any) => f.id === activeFlowId).eventType).toBeNull();
  });

  test("a viaSocket outage on sync is reported plainly and does not break the page or the API", async () => {
    // The dummy credentials can't list flows (and the sandbox may not reach viaSocket at all): either way the
    // server answers 502 with a calm message, and Daymark keeps working.
    const r = await adminApi.post("/api/automations/sync", { data: {} });
    expect(r.status()).toBe(502);
    expect((await r.json()).error.message).toMatch(/Daymark itself is unaffected/);
    expect((await adminApi.get("/api/me")).ok()).toBeTruthy();
    expect((await adminApi.get("/api/automations")).ok()).toBeTruthy();
  });

  test("the Automations page works on a phone", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: A, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 200) } });
    const page = await ctx.newPage();
    await blockEmbed(page);
    await signIn(page, admin.email);
    await page.goto("/automations");
    await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
    await expect(page.getByText("The automation builder couldn't load")).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/mobile-automations.png", fullPage: true });
    await ctx.close();
  });
});
