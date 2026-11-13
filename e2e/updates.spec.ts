import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { A, PASSWORD, addMemberApi, anonApi, apiAs, createOrgApi, login, newCtx, uniq } from "./helpers";

const tag = uniq();
const E = (n: string) => `${n}-${tag}@pulse.test`;
const admin = { org: `Pulse ${tag}`, name: "Ada Admin", email: E("ada") };
const people = {
  mona: { name: "Mona Manager", email: E("mona") },
  eddie: { name: "Eddie Employee", email: E("eddie") },
  cara: { name: "Cara Colleague", email: E("cara") },
  bella: { name: "Bella Beta", email: E("bella") },
  dan: { name: "Dan Window", email: E("dan") },
};
const SENTENCE = "Today I completed the recruitment screening for five candidates, scheduled three interviews and shared feedback with the hiring manager.";

let adminApi: APIRequestContext;
let ids: Record<string, string> = {};
let teams: Record<string, string> = {};
let eddieUpdateId = "";
let bellaUpdateId = "";

const current = (page: Page) => page.getByTestId("current-update");
const ctxFor = (browser: import("@playwright/test").Browser) => newCtx(browser, A);
async function asUser(browser: import("@playwright/test").Browser, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  await login(page, email);
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
  return { ctx, page };
}

test.describe.serial("Daymark Phase 2 — daily updates", () => {
  test.beforeAll(async () => {
    adminApi = await createOrgApi(A, admin);
    // Every day is a working day so the scenarios don't depend on the weekday the suite runs on.
    expect((await adminApi.patch("/api/organization/settings", { data: { workingDays: [1, 2, 3, 4, 5, 6, 7] } })).ok()).toBeTruthy();
    for (const n of ["Alpha", "Beta"]) {
      const r = await adminApi.post("/api/teams", { data: { name: n } });
      teams[n] = (await r.json()).team.id;
    }
    ids.mona = await addMemberApi(A, adminApi, { role: "MANAGER", ...people.mona });
    expect((await adminApi.patch(`/api/teams/${teams.Alpha}`, { data: { managerId: ids.mona } })).ok()).toBeTruthy();
    ids.eddie = await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...people.eddie, teamId: teams.Alpha });
    ids.cara = await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...people.cara, teamId: teams.Alpha });
    ids.bella = await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...people.bella, teamId: teams.Beta });
    ids.dan = await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...people.dan, teamId: teams.Beta });
  });

  test("4. employee submits a natural-language update with several items and links; sees a clear confirmation", async ({ browser }) => {
    const { ctx, page } = await asUser(browser, people.eddie.email);
    await expect(page.getByText("You haven't submitted today's update yet.")).toBeVisible();
    await page.getByRole("link", { name: "Submit Daily Update" }).click();
    await expect(page).toHaveURL(/\/my-updates\/new/);
    await expect(page.getByRole("heading", { name: "Daily update" })).toBeVisible();

    await page.getByLabel("What did you work on today?").fill(SENTENCE);
    await page.getByRole("button", { name: "Add another" }).first().click();
    await page.getByLabel("What did you work on today? — entry 2").fill("Updated the candidate tracker");
    await page.getByLabel("What work did you complete?").fill("Screening round one");
    await page.getByLabel("What work is still pending?").fill("Feedback from the hiring manager");
    await page.getByLabel("What challenges or blockers did you face?").fill("Waiting for the hiring manager to share feedback");
    await page.getByLabel("What are your priorities for tomorrow?").fill("Follow up on candidate feedback");
    await page.getByRole("button", { name: "Add a link" }).click();
    await page.getByLabel("Link 1 URL").fill("https://docs.example.com/tracker");
    await page.getByLabel("Link 1 label").fill("Candidate tracker");
    await page.screenshot({ path: "test-results/desktop-update-form.png", fullPage: true });
    await page.getByRole("button", { name: "Submit update" }).click();

    await expect(page).toHaveURL(/\/my-updates\/[\w-]+\?submitted=1/);
    await page.screenshot({ path: "test-results/desktop-update-submitted.png", fullPage: true });
    eddieUpdateId = page.url().match(/my-updates\/([\w-]+)\?/)![1];
    await expect(page.getByText("Update submitted", { exact: true })).toBeVisible();
    await expect(page.getByText("Your manager can now see it", { exact: false })).toBeVisible();
    await expect(current(page).getByText(SENTENCE)).toBeVisible();
    await expect(current(page).getByText("Updated the candidate tracker")).toBeVisible();
    await expect(page.getByRole("link", { name: /Candidate tracker/ })).toHaveAttribute("href", "https://docs.example.com/tracker");
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await ctx.close();
  });

  test("5. updates are saved: they show in history, on the dashboard, and survive a reload", async ({ browser }) => {
    const { ctx, page } = await asUser(browser, people.eddie.email);
    await expect(page.getByText("Today's update is in. Thank you!")).toBeVisible();
    await page.screenshot({ path: "test-results/desktop-employee-dashboard.png", fullPage: true });
    await expect(page.getByRole("link", { name: /View today's update/ }).first()).toBeVisible();
    await page.goto("/my-updates");
    const row = page.getByRole("link", { name: new RegExp("Submitted") }).first();
    await expect(row).toContainText("Today I completed the recruitment screening");
    await expect(row).toContainText("Blocker");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/my-updates/${eddieUpdateId}$`));
    await page.reload();
    await expect(page.getByText(SENTENCE)).toBeVisible();
    await expect(page.getByText("Version history")).toHaveCount(0); // never edited → nothing to compare
    await expect(current(page).getByText("Waiting for the hiring manager to share feedback")).toBeVisible();
    await ctx.close();
  });

  test("6. editing within the window marks it Edited and keeps the original submission in the history", async ({ browser }) => {
    const { ctx, page } = await asUser(browser, people.eddie.email);
    await page.goto(`/my-updates/${eddieUpdateId}`);
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText(/You can edit this update until/)).toBeVisible();
    await page.getByLabel("What did you work on today? — entry 2").fill("Updated the candidate tracker and booked rooms");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\?edited=1/);
    await expect(page.getByText("Changes saved")).toBeVisible();
    await expect(page.getByText("Edited", { exact: true }).first()).toBeVisible();
    await expect(current(page).getByText("Updated the candidate tracker and booked rooms")).toBeVisible();

    await expect(page.getByText("Version history")).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
    await expect(page.getByText("· Original submission")).toBeVisible();
    await expect(page.getByText("Version 2")).toBeVisible();
    await page.getByText("Version 1").click(); // expand the original
    const original = page.locator("details", { hasText: "Version 1" });
    await expect(original.getByText("Updated the candidate tracker", { exact: true })).toBeVisible();
    await expect(original.getByText("and booked rooms")).toHaveCount(0);
    await ctx.close();
  });

  test("7. drafts: save, come back later, submit — and a draft is never visible to managers", async ({ browser }) => {
    const { ctx, page } = await asUser(browser, people.cara.email);
    await page.goto("/my-updates/new");
    await page.getByRole("button", { name: "Submit update" }).click(); // nothing written yet
    await expect(page.getByText("Tell us what you worked on today before submitting.")).toBeVisible();
    await page.getByLabel("What did you work on today?").fill("Half-written thoughts");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/my-updates\/[\w-]+\/edit/);
    await expect(page.getByRole("heading", { name: "Continue your draft" })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Continue draft/ }).first()).toBeVisible();

    // Manager can't see the draft; Cara is still "Not submitted".
    const mona = await asUser(browser, people.mona.email);
    await mona.page.goto("/team-updates");
    await expect(mona.page.getByRole("heading", { name: "Team Updates" })).toBeVisible();
    await expect(mona.page.getByText("Half-written thoughts")).toHaveCount(0);
    await expect(mona.page.locator("tr", { hasText: people.cara.name }).getByText("Not submitted")).toBeVisible();
    await mona.ctx.close();
    await ctx.close();
  });

  test("8. managers see their team: overview cards, rows, filters and the full submission", async ({ browser }) => {
    // Bella (other team) submits so we can prove Mona does not see her.
    const bella = await apiAs(A, people.bella.email);
    const r = await bella.post("/api/updates", { data: { sections: { workedOn: ["Beta team work"] }, submit: true } });
    expect(r.ok()).toBeTruthy();
    bellaUpdateId = (await r.json()).id;

    const { ctx, page } = await asUser(browser, people.mona.email);
    await page.goto("/team-updates");
    await expect(page.getByTestId("stat-members")).toContainText("2"); // Eddie + Cara
    await expect(page.getByTestId("stat-submitted")).toContainText("1");
    await expect(page.getByTestId("stat-pending")).toContainText("1");
    await expect(page.getByTestId("stat-blockers")).toContainText("1");
    await expect(page.getByTestId("stat-week")).toContainText("1");
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible(); // trend chart renders
    await page.screenshot({ path: "test-results/desktop-team-updates.png", fullPage: true });

    const table = page.getByTestId("updates-table");
    await expect(table.locator("tr", { hasText: people.eddie.name })).toContainText("Edited");
    await expect(table.locator("tr", { hasText: people.eddie.name })).toContainText("Blocker");
    await expect(table.locator("tr", { hasText: people.cara.name })).toContainText("Not submitted");
    await expect(page.getByText(people.bella.name)).toHaveCount(0);
    await expect(page.getByText("Beta team work")).toHaveCount(0);

    // Filters
    await page.getByLabel("Status").selectOption("missing");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText(people.cara.name);
    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/team-updates$/);
    await expect(page.getByLabel("Status")).toHaveValue("");
    await page.getByLabel("Only with blockers").check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText(people.eddie.name);
    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/team-updates$/);
    await expect(page.getByLabel("Only with blockers")).not.toBeChecked();
    await page.getByLabel("Employee").selectOption({ label: people.cara.name });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByLabel("Employee").locator("option", { hasText: people.bella.name })).toHaveCount(0); // not even offered

    // Open the complete submission
    await page.goto("/team-updates");
    await page.getByTestId("updates-table").getByRole("link", { name: people.eddie.name }).click();
    await expect(page).toHaveURL(new RegExp(`/team-updates/${eddieUpdateId}`));
    await expect(current(page).getByText(SENTENCE)).toBeVisible();
    await expect(current(page).getByText("Follow up on candidate feedback")).toBeVisible();
    await expect(page.getByText("Version history")).toBeVisible();
    await page.screenshot({ path: "test-results/desktop-team-update-detail.png", fullPage: true });
    await expect(page.getByText(/hasn.t been independently verified/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0); // managers can't edit
    await ctx.close();
  });

  test("9. managers cannot reach other teams' updates (UI and API); employees cannot use the team view", async ({ browser }) => {
    const mona = await apiAs(A, people.mona.email);
    expect((await mona.get(`/api/team-updates/${bellaUpdateId}`)).status()).toBe(404);
    expect((await mona.get(`/api/team-updates/${eddieUpdateId}`)).status()).toBe(200);
    const list = await (await mona.get("/api/team-updates")).json();
    expect(JSON.stringify(list)).not.toContain(people.bella.name);
    const probe = await (await mona.get(`/api/team-updates?membershipId=${ids.bella}`)).json();
    expect(probe.rows).toHaveLength(0);
    expect((await mona.get(`/api/team-updates?teamId=${teams.Beta}`).then((r) => r.json())).rows).toHaveLength(0);
    // Managers can't edit anyone's update — not even their own team's.
    expect((await mona.patch(`/api/updates/${eddieUpdateId}`, { data: { sections: { workedOn: ["hax"] } } })).status()).toBe(404);

    const { ctx, page } = await asUser(browser, people.mona.email);
    await page.goto(`/team-updates/${bellaUpdateId}`);
    await expect(page.getByText("We couldn't find that")).toBeVisible();
    await expect(page.getByText("Beta team work")).toHaveCount(0);
    await ctx.close();

    const eddie = await apiAs(A, people.eddie.email);
    for (const p of ["/api/team-updates", `/api/team-updates/${eddieUpdateId}`, "/api/team-updates/overview"]) expect((await eddie.get(p)).status(), p).toBe(403);
    expect((await eddie.get(`/api/updates/${bellaUpdateId}`)).status()).toBe(404);
    expect((await eddie.patch(`/api/updates/${bellaUpdateId}`, { data: { sections: { workedOn: ["hax"] } } })).status()).toBe(404);
    expect((await eddie.delete(`/api/updates/${bellaUpdateId}`)).status()).toBe(404);
    const own = (await (await eddie.get("/api/updates")).json()).updates as { id: string }[];
    expect(own.map((u) => u.id)).toEqual([eddieUpdateId]);

    const { ctx: c2, page: p2 } = await asUser(browser, people.eddie.email);
    await p2.goto("/team-updates");
    await expect(p2).toHaveURL(/\/dashboard$/);
    await expect(p2.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Team Updates" })).toHaveCount(0);
    await c2.close();
  });

  test("10. admins see every team's updates; another company sees none of them", async ({ browser }) => {
    const { ctx, page } = await asUser(browser, admin.email);
    await page.goto("/team-updates");
    await expect(page.getByTestId("updates-table").getByRole("link", { name: people.eddie.name })).toBeVisible();
    await expect(page.getByTestId("updates-table").getByRole("link", { name: people.bella.name })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByText("Update submissions today")).toBeVisible();
    await expect(page.getByTestId("stat-submitted")).toContainText("2");
    await ctx.close();

    const rival = await createOrgApi(A, { org: `Rival ${tag}`, name: "Rita Rival", email: E("rita") });
    for (const id of [eddieUpdateId, bellaUpdateId]) {
      expect((await rival.get(`/api/team-updates/${id}`)).status()).toBe(404);
      expect((await rival.get(`/api/updates/${id}`)).status()).toBe(404);
      expect((await rival.patch(`/api/updates/${id}`, { data: { sections: { workedOn: ["x"] } } })).status()).toBe(404);
    }
    const rows = (await (await rival.get("/api/team-updates")).json()).rows as { status: string }[];
    expect(rows.filter((r) => r.status !== "MISSING")).toHaveLength(0);
    const o = (await (await rival.get("/api/team-updates/overview")).json()).overview;
    expect(o.submitted).toBe(0);
  });

  test("11. the edit window is enforced by the server and the UI follows it", async ({ browser }) => {
    expect((await adminApi.patch("/api/organization/settings", { data: { editWindowHours: 0 } })).ok()).toBeTruthy();
    const dan = await apiAs(A, people.dan.email);
    const r = await dan.post("/api/updates", { data: { sections: { workedOn: ["Closed books"] }, submit: true } });
    const id = (await r.json()).id as string;
    const patch = await dan.patch(`/api/updates/${id}`, { data: { sections: { workedOn: ["Changed my mind"] } } });
    expect(patch.status()).toBe(403);
    expect((await patch.json()).error.code).toBe("EDIT_WINDOW_CLOSED");

    const { ctx, page } = await asUser(browser, people.dan.email);
    await page.goto(`/my-updates/${id}`);
    await expect(page.getByText("Closed books")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await page.goto(`/my-updates/${id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/my-updates/${id}$`));
    await ctx.close();
    expect((await adminApi.patch("/api/organization/settings", { data: { editWindowHours: 24 } })).ok()).toBeTruthy();
  });

  test("12. the API validates input and rejects unauthenticated access", async () => {
    const anon = await anonApi(A);
    for (const p of ["/api/updates", "/api/team-updates", "/api/team-updates/overview"]) expect((await anon.get(p)).status(), p).toBe(401);
    expect((await anon.post("/api/updates", { data: { sections: { workedOn: ["x"] }, submit: true } })).status()).toBe(401);

    const bella = await apiAs(A, people.bella.email);
    const post = (data: object) => bella.post("/api/updates", { data });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await post({ updateDate: yesterday, sections: { workedOn: ["x"] }, links: [{ url: "javascript:alert(1)" }] })).status()).toBe(400);
    expect((await post({ updateDate: yesterday, sections: { workedOn: ["x"] }, links: [{ url: "data:text/html,hi" }] })).status()).toBe(400);
    expect((await post({ updateDate: yesterday, sections: {}, submit: true })).status()).toBe(400);
    expect((await post({ updateDate: tomorrow, sections: { workedOn: ["x"] } })).status()).toBe(400);
    expect((await post({ updateDate: "2020-01-01", sections: { workedOn: ["x"] } })).status()).toBe(400);
    const dup = await post({ sections: { workedOn: ["again"] }, submit: true });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("UPDATE_EXISTS");
    // A client cannot pose as another person or channel.
    const spoof = await post({ updateDate: yesterday, sections: { workedOn: ["spoof"] }, submit: true, membershipId: ids.eddie, organizationId: "x", source: "SLACK", channel: "EMAIL" });
    expect(spoof.ok()).toBe(true);
    const created = (await (await bella.get(`/api/updates/${(await spoof.json()).id}`)).json()).update;
    expect(created.membershipId).toBe(ids.bella);
    expect(created.source).toBe("DASHBOARD");
  });

  test("13. the update form and team view work on a phone", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: A, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 200) } });
    const noHScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1);

    const page = await ctx.newPage();
    await login(page, people.dan.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await page.goto("/my-updates");
    await expect(page.getByRole("heading", { name: "My Updates", level: 1 })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await page.goto("/my-updates/new?date=" + new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    await expect(page.getByRole("heading", { name: "Daily update" })).toBeVisible();
    await page.getByLabel("What did you work on today?").fill("Mobile entry");
    await page.getByRole("button", { name: "Add a link" }).click();
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/mobile-update-form.png", fullPage: true });

    const mgr = await ctx.newPage();
    await ctx.clearCookies();
    await login(mgr, people.mona.email);
    await expect(mgr.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await mgr.goto("/team-updates");
    await expect(mgr.getByRole("heading", { name: "Team Updates", level: 1 })).toBeVisible();
    await expect(mgr.getByRole("link", { name: people.eddie.name }).first()).toBeVisible();
    expect(await noHScroll(mgr)).toBe(true);
    await mgr.screenshot({ path: "test-results/mobile-team-updates.png", fullPage: true });
    await mgr.goto("/dashboard");
    await expect(mgr.getByTestId("stat-members")).toBeVisible();
    expect(await noHScroll(mgr)).toBe(true);
    await mgr.screenshot({ path: "test-results/mobile-manager-dashboard.png", fullPage: true });
    await ctx.close();
  });
});
