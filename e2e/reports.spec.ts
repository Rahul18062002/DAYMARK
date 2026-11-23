import { expect, test, type Page } from "@playwright/test";
import { A, addMemberApi, apiAs, createOrgApi, login, newCtx, uniq } from "./helpers";

const tag = uniq();
const E = (n: string) => `${n}-${tag}@rep.test`;
const admin = { org: `Reports ${tag}`, name: "Rae Admin", email: E("rae") };
const mgr = { name: "Mel Manager", email: E("mel") };
const ann = { name: "Ann Author", email: E("ann") };
const bob = { name: "Bob Peer", email: E("bob") };
let adminApi: Awaited<ReturnType<typeof createOrgApi>>;
let reportId = "";

const monday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const noHScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1);
async function signIn(page: Page, email: string) { await login(page, email); await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible(); }

test.describe.serial("AI summaries and weekly reports (real provider code path against a local stand-in)", () => {
  test.beforeAll(async () => {
    adminApi = await createOrgApi(A, admin);
    const teamRes = await adminApi.post("/api/teams", { data: { name: "Alpha" } });
    const teamId = (await teamRes.json()).team.id as string;
    const mgrId = await addMemberApi(A, adminApi, { role: "MANAGER", ...mgr });
    await adminApi.patch(`/api/teams/${teamId}`, { data: { managerId: mgrId } });
    for (const p of [ann, bob]) await addMemberApi(A, adminApi, { role: "EMPLOYEE", teamId, ...p });
    const people = (await (await adminApi.get("/api/employees?status=ACTIVE")).json()).employees as { id: string; email: string }[];
    for (const p of [ann, bob]) await adminApi.patch(`/api/employees/${people.find((x) => x.email === p.email)!.id}`, { data: { managerId: mgrId } });
  });

  test("1. AI is off until the admin opts in; the disclosure is shown and the connection test works", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, admin.email);
    await page.goto("/settings?tab=schedule");
    await expect(page.getByRole("button", { name: "Test AI connection" })).toHaveCount(0);
    await page.getByLabel(/Enable AI summaries and weekly reports/).check();
    await expect(page.getByText(/sent to an outside AI provider/)).toBeVisible();
    await expect(page.getByText("An AI provider key is configured on the server.")).toBeVisible();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await page.getByRole("button", { name: "Test AI connection" }).click();
    await expect(page.getByText(/Connected to anthropic/)).toBeVisible();
  });

  test("2. a submitted update gets a short AI summary, labelled as AI-generated and unverified", async ({ browser }) => {
    const annApi = await apiAs(A, ann.email);
    const res = await annApi.post("/api/updates", { data: { submit: true, sections: { workedOn: ["Wrote the onboarding guide"], blockers: ["Waiting for design review"] } } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const id = (await res.json()).id as string;
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, ann.email);
    await expect.poll(async () => { await page.goto(`/my-updates/${id}`); return page.getByTestId("update-summary").getByText("E2E headline").count(); }, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("update-summary")).toContainText("Not independently verified");
  });

  test("3. a manager writes the team report, edits it and publishes it; nothing is shared before that", async ({ browser }) => {
    const bobApi = await apiAs(A, bob.email);
    await bobApi.post("/api/updates", { data: { submit: true, sections: { workedOn: ["Fixed the login bug"] } } });
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, mgr.email);
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Reports" }).click();
    await page.goto(`/reports?week=${monday()}&view=review`);
    await expect(page.getByText("Nothing waiting for your review")).toBeVisible();
    await page.getByRole("button", { name: "Write a report" }).click();
    const dlg = page.getByRole("dialog", { name: "Write a report now" });
    await dlg.getByLabel("Which one").selectOption({ label: "Alpha" });
    await dlg.getByRole("button", { name: "Write report" }).click();
    await expect(page.getByRole("heading", { name: /Alpha team/ })).toBeVisible();
    reportId = page.url().split("/reports/")[1];
    await expect(page.getByText("Draft · needs review").first()).toBeVisible();
    await expect(page.getByText("E2E headline").first()).toBeVisible();
    await expect(page.getByText("E2E blocker reported")).toBeVisible();                       // the manager sees blockers
    // a team member can't see the draft
    const bobPage = await (await newCtx(browser, A)).newPage();
    await signIn(bobPage, bob.email);
    await bobPage.goto(`/reports/${reportId}`);
    await expect(bobPage.getByText("We couldn't find that")).toBeVisible();
    // edit then approve
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Headline").fill("Alpha shipped the onboarding guide");
    await page.getByRole("button", { name: "Save report" }).click();
    await expect(page.getByText("Alpha shipped the onboarding guide").first()).toBeVisible();
    await expect(page.getByText(/then edited by a reviewer/)).toBeVisible();
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText("Published").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);                  // published: reopen first
  });

  test("4. the published report reaches the team, blockers stay hidden from peers, and there's no review panel for them", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, bob.email);
    await page.goto(`/reports?week=${monday()}&view=published`);
    await expect(page.getByRole("link", { name: /Alpha team/ })).toBeVisible();
    await page.getByRole("link", { name: /Alpha team/ }).click();
    await expect(page.getByText("Alpha shipped the onboarding guide").first()).toBeVisible();
    await expect(page.getByText("E2E blocker reported")).toHaveCount(0);
    await expect(page.getByText(/only shown to the people involved and their managers/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and publish" })).toHaveCount(0);
    await expect(page.getByText(/reviewed and published by Mel Manager/)).toBeVisible();
  });

  test("5. another company cannot read it, and the pages fit a phone", async ({ browser }) => {
    const rival = await createOrgApi(A, { org: `Rival ${tag}`, name: "Rita Rival", email: E("rita") });
    expect((await rival.get(`/api/reports/${reportId}`)).status()).toBe(404);
    expect((await rival.post(`/api/reports/${reportId}/review`, { data: { action: "reject" } })).status()).toBe(404);
    const ctx = await browser.newContext({ baseURL: A, viewport: { width: 375, height: 740 }, extraHTTPHeaders: { "x-forwarded-for": "10.7.7.7" } });
    const page = await ctx.newPage();
    await signIn(page, mgr.email);
    for (const path of [`/reports?week=${monday()}&view=published`, `/reports/${reportId}`]) { await page.goto(path); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); expect(await noHScroll(page), `${path} overflows`).toBe(true); }
  });
});
