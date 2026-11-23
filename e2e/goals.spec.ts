import { expect, test, type Page } from "@playwright/test";
import { A, addMemberApi, apiAs, createOrgApi, login, newCtx, uniq } from "./helpers";

const tag = uniq();
const E = (n: string) => `${n}-${tag}@goals.test`;
const admin = { org: `Goals ${tag}`, name: "Gina Goals", email: E("gina") };
const mgr = { name: "Mo Manager", email: E("mo") };
const emp = { name: "Eve Employee", email: E("eve") };
const other = { org: `Rival ${tag}`, name: "Rita Rival", email: E("rita") };

let adminApi: Awaited<ReturnType<typeof createOrgApi>>;
const noHScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1);
async function signIn(page: Page, email: string) { await login(page, email); await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible(); }

test.describe.serial("Daymark goals: cascade, progress, visibility, org chart", () => {
  test.beforeAll(async () => {
    adminApi = await createOrgApi(A, admin);
    await addMemberApi(A, adminApi, { role: "MANAGER", ...mgr });
    await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...emp });
  });

  test("1. the admin (CEO) creates a company goal with a key result and records progress", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, admin.email);
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Goals" }).click();
    await expect(page.getByRole("heading", { name: "Goals", level: 1 })).toBeVisible();
    await expect(page.getByText("No goals this period yet")).toBeVisible();

    await page.getByRole("button", { name: "New goal" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New goal" });
    await dlg.getByLabel("Goal", { exact: true }).fill("Reach 100 customers");
    await dlg.getByLabel("Level").selectOption("COMPANY");
    await dlg.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("link", { name: "Reach 100 customers" })).toBeVisible();

    await page.getByRole("link", { name: "Reach 100 customers" }).click();
    await expect(page.getByRole("heading", { name: "Reach 100 customers", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Add key result" }).click();
    const kr = page.getByRole("dialog", { name: "Add a key result" });
    await kr.getByLabel("Key result", { exact: true }).fill("Paying customers");
    await kr.getByLabel("Target").fill("100");
    await kr.getByRole("button", { name: "Add key result" }).click();
    await expect(page.getByText("Paying customers", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Check in" }).click();
    const ci = page.getByRole("dialog", { name: "Record progress" });
    await ci.getByLabel(/Current value/).fill("40");
    await ci.getByLabel("Note (optional)").fill("Three signed this week");
    await ci.getByRole("button", { name: "Save progress" }).click();
    await expect(page.getByRole("progressbar", { name: "Goal progress" })).toHaveAttribute("aria-valuenow", "40");
    await expect(page.getByText("Progress history (2)")).toBeVisible();
  });

  test("2. an employee sees the company goal read-only and adds their own goal under it; progress rolls up", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, emp.email);
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Goals" }).click();
    await page.getByRole("link", { name: "Reach 100 customers" }).click();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);                 // cannot edit a company goal
    await expect(page.getByRole("button", { name: "Add key result" })).toHaveCount(0);

    await page.getByRole("link", { name: "Goals" }).first().click();
    await page.getByRole("button", { name: "New goal" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New goal" });
    await dlg.getByLabel("Goal", { exact: true }).fill("Onboard ten pilot customers");
    await expect(dlg.getByLabel("Level")).toBeDisabled();                                    // employees: individual goals only
    await dlg.getByLabel("Contributes to (optional)").selectOption({ label: "Reach 100 customers (Company)" });
    await dlg.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("link", { name: "Onboard ten pilot customers" })).toBeVisible();

    await page.getByRole("link", { name: "Onboard ten pilot customers" }).click();
    await page.getByRole("button", { name: "Add key result" }).click();
    const kr = page.getByRole("dialog", { name: "Add a key result" });
    await kr.getByLabel("Key result", { exact: true }).fill("Pilots onboarded");
    await kr.getByLabel("Target").fill("10");
    await kr.getByRole("button", { name: "Add key result" }).click();
    await page.getByRole("button", { name: "Check in" }).click();
    const ci = page.getByRole("dialog", { name: "Record progress" });
    await ci.getByLabel(/Current value/).fill("5");
    await ci.getByRole("button", { name: "Save progress" }).click();
    await expect(page.getByRole("progressbar", { name: "Goal progress" })).toHaveAttribute("aria-valuenow", "50");

    // a task, picked up by the employee, finished from the status menu
    await page.getByLabel("New task").fill("Email the first five pilots");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Email the first five pilots")).toBeVisible();
    await page.getByLabel("Status of Email the first five pilots").selectOption("DONE");
    await expect(page.getByLabel("Status of Email the first five pilots")).toHaveValue("DONE");

    // roll-up: company goal = average of its own KR (40) and the child goal (50)
    await page.goto("/goals");
    const row = page.getByRole("progressbar", { name: "Reach 100 customers progress" });
    await expect(row).toHaveAttribute("aria-valuenow", "45");
    await expect(page.getByRole("tab", { name: "My goals" }).or(page.getByRole("link", { name: "My goals" }))).toBeVisible();
  });

  test("3. 'My goals' shows only what the person owns", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, emp.email);
    await page.goto("/goals?view=mine");
    await expect(page.getByRole("link", { name: "Onboard ten pilot customers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reach 100 customers" })).toBeVisible();     // the readable chain above it stays, so the tree hangs together
  });

  test("4. visibility is private until the admin opens it; then employees get a read-only colleagues view", async ({ browser }) => {
    const emp2 = { name: "Ed Peer", email: E("ed") };
    await addMemberApi(A, adminApi, { role: "EMPLOYEE", ...emp2 });
    const peer = await apiAs(A, emp2.email);
    await peer.post("/api/updates", { data: { submit: true, sections: { workedOn: ["Peer work item", ], blockers: ["Peer secret blocker"] } } });

    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, emp.email);
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    await expect(nav.getByRole("link", { name: "Colleagues" })).toHaveCount(0);
    await page.goto("/team-updates");
    await expect(page).toHaveURL(/\/dashboard$/);                                            // closed by default

    // admin opens visibility to the whole company, blockers still private
    const set = await adminApi.patch("/api/organization/settings", { data: { visibilityScope: "COMPANY", peersSeeBlockers: false } });
    expect(set.ok()).toBeTruthy();
    await page.goto("/dashboard");
    await nav.getByRole("link", { name: "Colleagues" }).click();
    await expect(page.getByRole("heading", { name: "Colleagues", level: 1 })).toBeVisible();
    await expect(page.getByText("Peer work item").first()).toBeVisible();
    await expect(page.getByText("Peer secret blocker")).toHaveCount(0);
    await expect(page.getByText("Pending today")).toHaveCount(0);                             // peers never see who hasn't submitted
    await page.getByRole("link", { name: "Ed Peer" }).first().click();
    await expect(page.getByText("Peer work item").first()).toBeVisible();
    await expect(page.getByText("Peer secret blocker")).toHaveCount(0);

    await adminApi.patch("/api/organization/settings", { data: { peersSeeBlockers: true } });
    await page.reload();
    await expect(page.getByText("Peer secret blocker").first()).toBeVisible();
    await adminApi.patch("/api/organization/settings", { data: { visibilityScope: "OWN", peersSeeBlockers: false } });
  });

  test("5. the org chart shows the reporting line, and level and mentor can be set", async ({ browser }) => {
    const people = (await (await adminApi.get("/api/employees?status=ACTIVE")).json()).employees as { id: string; email: string; name: string }[];
    const idOf = (email: string) => people.find((p) => p.email === email)!.id;
    expect((await adminApi.patch(`/api/employees/${idOf(emp.email)}`, { data: { managerId: idOf(mgr.email), level: 4, mentorId: idOf(mgr.email) } })).ok()).toBeTruthy();
    expect((await adminApi.patch(`/api/employees/${idOf(mgr.email)}`, { data: { managerId: idOf(admin.email), level: 2, jobTitle: "Head of Sales" } })).ok()).toBeTruthy();
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, admin.email);
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Org chart" }).click();
    const tree = page.getByRole("list", { name: "Reporting tree" });
    await expect(tree).toContainText("Gina Goals");
    await expect(tree).toContainText("Mo Manager");
    await expect(tree).toContainText("Head of Sales");
    await expect(tree).toContainText("Eve Employee");
    await expect(tree).toContainText("Level 4");
    await expect(tree).toContainText("Mentor: Mo Manager");
    // an employee with private visibility sees only their own chain
    const epage = await (await newCtx(browser, A)).newPage();
    await signIn(epage, emp.email);
    await epage.goto("/org-chart");
    await expect(epage.getByRole("list", { name: "Reporting tree" })).toContainText("Mo Manager");
    await expect(epage.getByRole("list", { name: "Reporting tree" })).not.toContainText("Ed Peer");
  });

  test("6. another company cannot open or change these goals", async ({ browser }) => {
    const rival = await createOrgApi(A, other);
    const goals = (await (await adminApi.get("/api/objectives")).json()).items as { id: string }[];
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) {
      expect((await rival.get(`/api/objectives/${g.id}`)).status()).toBe(404);
      expect((await rival.patch(`/api/objectives/${g.id}`, { data: { title: "hijacked" } })).status()).toBe(404);
      expect((await rival.delete(`/api/objectives/${g.id}`)).status()).toBe(404);
    }
    expect(((await (await rival.get("/api/objectives")).json()).items as unknown[]).length).toBe(0);
    const page = await (await newCtx(browser, A)).newPage();
    await signIn(page, other.email);
    await page.goto(`/goals/${goals[0].id}`);
    await expect(page.getByText("We couldn't find that")).toBeVisible();                       // streamed pages answer 200 with the not-found screen
    await expect(page.getByText("Reach 100 customers")).toHaveCount(0);
  });

  test("7. goals and the org chart work on a phone", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: A, viewport: { width: 375, height: 740 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const page = await ctx.newPage();
    await signIn(page, admin.email);
    for (const path of ["/goals", "/org-chart"]) { await page.goto(path); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); expect(await noHScroll(page), `${path} overflows`).toBe(true); }
    await page.goto("/goals");
    await page.getByRole("link", { name: "Reach 100 customers" }).click();
    await expect(page.getByRole("heading", { name: "Reach 100 customers", level: 1 })).toBeVisible();
    expect(await noHScroll(page), "goal detail overflows").toBe(true);
  });
});

test.describe.serial("Daymark insights: tagging work to goals, comparing peers, profiles", () => {
  const tag2 = uniq();
  const a = { org: `Insight ${tag2}`, name: "Ivy Insight", email: `ivy-${tag2}@ins.test` };
  const p1 = { name: "Pia Peer", email: `pia-${tag2}@ins.test` };
  const p2 = { name: "Paz Peer", email: `paz-${tag2}@ins.test` };
  let api: Awaited<ReturnType<typeof createOrgApi>>;
  let goalId = "";

  test.beforeAll(async () => {
    api = await createOrgApi(A, a);
    await addMemberApi(A, api, { role: "EMPLOYEE", ...p1 });
    await addMemberApi(A, api, { role: "EMPLOYEE", ...p2 });
    const g = await api.post("/api/objectives", { data: { title: "Improve onboarding", level: "COMPANY", periodStart: "2020-01-01", periodEnd: "2099-12-31" } });
    expect(g.ok(), await g.text()).toBeTruthy();
    goalId = (await g.json()).id;
    await api.patch("/api/organization/settings", { data: { visibilityScope: "COMPANY" } });
  });

  test("8. an employee tags today's update with a goal, and it shows on the goal as recent work", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await login(page, p1.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await page.goto("/my-updates/new");
    await page.getByLabel("What did you work on today?").first().fill("Rewrote the welcome checklist");
    await page.getByLabel("Improve onboarding").check();
    await page.getByRole("button", { name: "Submit update" }).click();
    await expect(page.getByText("Rewrote the welcome checklist")).toBeVisible();
    await expect(page.getByRole("link", { name: "Improve onboarding" })).toBeVisible();          // the "contributes to" tag
    await page.goto(`/goals/${goalId}`);
    await expect(page.getByText("Recent work")).toBeVisible();
    await expect(page.getByRole("link", { name: "Rewrote the welcome checklist" })).toBeVisible();
  });

  test("9. peers compare under company visibility; the page is read-only and carries no ranking", async ({ browser }) => {
    const page = await (await newCtx(browser, A)).newPage();
    await login(page, p2.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Compare" }).click();
    await expect(page.getByRole("heading", { name: "Compare", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Everyone" }).click();
    const table = page.getByTestId("compare-table");
    await expect(table).toContainText("Pia Peer");
    await expect(table).toContainText("Paz Peer");
    await expect(page.getByText(/not .*rank people/i)).toBeVisible();
    await expect(page.getByText(/rank #|leaderboard/i)).toHaveCount(0);
    await page.getByRole("link", { name: "12 weeks" }).click();
    await expect(page).toHaveURL(/weeks=12/);
  });

  test("10. a profile shows habits and goals, and the pages fit a phone", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: A, viewport: { width: 375, height: 740 }, extraHTTPHeaders: { "x-forwarded-for": "10.8.8.8" } });
    const page = await ctx.newPage();
    await login(page, p2.email);
    await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
    await page.goto("/compare?group=all");
    await page.getByRole("link", { name: "Pia Peer" }).first().click();
    await expect(page.getByRole("heading", { name: "Pia Peer", level: 1 })).toBeVisible();
    await expect(page.getByText("Reporting consistency")).toBeVisible();
    await expect(page.getByText("Rewrote the welcome checklist")).toBeVisible();
    for (const path of [page.url().replace(A, ""), "/compare?group=all", "/dashboard"]) { await page.goto(path); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); expect(await noHScroll(page), `${path} overflows`).toBe(true); }
  });

  test("11. a stranger from another company cannot open a profile", async ({ browser }) => {
    const rival = await createOrgApi(A, { org: `Nope ${tag2}`, name: "Nia Nope", email: `nia-${tag2}@ins.test` });
    const people = (await (await api.get("/api/employees?status=ACTIVE")).json()).employees as { id: string }[];
    for (const p of people) expect((await rival.get(`/api/people/${p.id}/insights`)).status()).toBe(404);
    expect(JSON.stringify(await (await rival.get("/api/insights?group=all")).json())).not.toContain("Pia");
    void browser;
  });
});
