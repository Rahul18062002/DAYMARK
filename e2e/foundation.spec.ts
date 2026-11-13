import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { A, PASSWORD, anonApi, apiAs, linkIn, login, newCtx, onboard, uniq, waitForMail } from "./helpers";

const tag = uniq();
const org = { org: `Acme ${tag}`, name: "Alice Admin", email: `alice-${tag}@acme.test` };
const emp1 = { name: "Eddie Employee", email: `eddie-${tag}@acme.test` };
const mgr = { name: "Mona Manager", email: `mona-${tag}@acme.test` };
const emp2 = { name: "Bella Billing", email: `bella-${tag}@acme.test` };

let adminCtx: BrowserContext;
let admin: Page;
let adminApi: APIRequestContext;
let teams: Record<string, string> = {};

async function inviteViaUi(page: Page, email: string, role: "Employee" | "Manager", team?: string) {
  await page.goto("/employees");
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Role").selectOption({ label: role });
  if (team) await dialog.getByLabel("Team (optional)").selectOption({ label: team });
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation emailed to ${email}`)).toBeVisible();
}

async function acceptInviteViaEmail(browser: Browser, email: string, name: string) {
  const mail = await waitForMail(email, "invited you");
  const link = linkIn(mail, /http:\/\/localhost:3100\/invite\/[\w-]+/);
  const ctx = await newCtx(browser, A);
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /^Join Acme/ })).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.getByRole("heading", { name: `Welcome, ${name.split(" ")[0]}` })).toBeVisible();
  return { ctx, page };
}

/** Invite + accept through the HTTP API (fast setup for scenarios that are not about the invite UI). */
async function addMemberApi(role: "EMPLOYEE" | "MANAGER", email: string, name: string, teamId?: string) {
  const inv = await adminApi.post("/api/invitations", { data: { email, role, teamId } });
  expect(inv.ok()).toBeTruthy();
  const { inviteUrl } = await inv.json();
  const accept = await (await anonApi(A)).post("/api/invitations/accept", { data: { token: inviteUrl.split("/invite/")[1], name, password: PASSWORD } });
  expect(accept.ok(), await accept.text()).toBeTruthy();
}

test.describe.serial("Daymark Phase 1 — foundation (SMTP-enabled server)", () => {
  test.beforeAll(async ({ browser }) => {
    adminCtx = await newCtx(browser, A);
    admin = await adminCtx.newPage();
  });

  test("1. admin creates an organization and lands in a Daymark-branded workspace", async () => {
    await onboard(admin, org);
    await expect(admin.getByText("Active people")).toBeVisible();
    await expect(admin.getByText(org.org).first()).toBeVisible();
    await expect(admin).toHaveTitle(/Daymark/);
    expect(await admin.content()).not.toMatch(/workpulse/i);
    adminApi = await apiAs(A, org.email);
  });

  test("2. admin creates a department and a team in Settings", async () => {
    await admin.goto("/settings?tab=structure");
    await admin.getByLabel("New department name").fill("Operations");
    await admin.getByRole("button", { name: "Add", exact: true }).click();
    await expect(admin.getByText("Department created.")).toBeVisible();
    await expect(admin.getByRole("listitem").filter({ hasText: "Operations" })).toBeVisible();

    await admin.getByRole("button", { name: "Add team" }).click();
    const d = admin.getByRole("dialog");
    await d.getByLabel("Team name").fill("Support");
    await d.getByLabel("Department").selectOption({ label: "Operations" });
    await d.getByRole("button", { name: "Create team" }).click();
    await expect(admin.getByText("Team created.")).toBeVisible();

    await adminApi.post("/api/teams", { data: { name: "Billing" } });
    const list = (await (await adminApi.get("/api/teams")).json()).teams as { id: string; name: string }[];
    teams = Object.fromEntries(list.map((t) => [t.name, t.id]));
    expect(Object.keys(teams).sort()).toEqual(["Billing", "Support"]);
  });

  test("3. admin invites an employee; the email arrives over SMTP; the employee joins and sees their team", async ({ browser }) => {
    await inviteViaUi(admin, emp1.email, "Employee", "Support");
    const mail = await waitForMail(emp1.email, "invited you");
    expect(mail.subject).toContain(org.org);
    expect(mail.subject).toContain("Daymark");
    expect(mail.text).toContain("Make Every Day Count.");

    const { ctx, page } = await acceptInviteViaEmail(browser, emp1.email, emp1.name);
    await expect(page.getByText("Support", { exact: true })).toBeVisible();
    await expect(page.getByText("Operations", { exact: true })).toBeVisible(); // department follows the team
    await ctx.close();
  });

  test("4. an invitation link works exactly once", async ({ browser }) => {
    const mail = await waitForMail(emp1.email, "invited you");
    const link = linkIn(mail, /http:\/\/localhost:3100\/invite\/[\w-]+/);
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();
    await ctx.close();
  });

  test("5. employees can log out and log in again", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await login(page, emp1.email);
    await expect(page.getByRole("heading", { name: "Welcome, Eddie" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/login/);
    await login(page, emp1.email, "wrong-password-xx");
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await login(page, emp1.email);
    await expect(page.getByRole("heading", { name: "Welcome, Eddie" })).toBeVisible();
    await ctx.close();
  });

  test("6. employees don't see admin pages, and the backend refuses them anyway", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await login(page, emp1.email);
    await expect(page.getByRole("heading", { name: "Welcome, Eddie" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Employees" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/dashboard$/);

    const api = await apiAs(A, emp1.email);
    expect((await api.get("/api/employees")).status()).toBe(403);
    expect((await api.get("/api/invitations")).status()).toBe(403);
    expect((await api.post("/api/invitations", { data: { email: `x-${tag}@x.test`, role: "ADMIN" } })).status()).toBe(403);
    expect((await api.post("/api/teams", { data: { name: "Hax" } })).status()).toBe(403);
    expect((await api.post("/api/departments", { data: { name: "Hax" } })).status()).toBe(403);
    expect((await api.patch("/api/organization", { data: { name: "Hacked" } })).status()).toBe(403);
    expect((await api.patch("/api/organization/settings", { data: { aiEnabled: false } })).status()).toBe(403);
    const me = await (await api.get("/api/me")).json();
    expect((await api.patch(`/api/employees/${me.membership.id}`, { data: { role: "ADMIN" } })).status()).toBe(403); // no self-promotion
    expect((await adminApi.get("/api/organization").then((r) => r.json())).organization.name).toBe(org.org);
    await ctx.close();
  });

  test("7. managers see only their own teams and cannot administer", async ({ browser }) => {
    await inviteViaUi(admin, mgr.email, "Manager");
    const { ctx: mctx, page: mpage } = await acceptInviteViaEmail(browser, mgr.email, mgr.name);
    await addMemberApi("EMPLOYEE", emp2.email, emp2.name, teams["Billing"]);

    const all = (await (await adminApi.get("/api/employees")).json()).employees as { id: string; email: string }[];
    const mgrId = all.find((m) => m.email === mgr.email)!.id;
    expect((await adminApi.patch(`/api/teams/${teams["Support"]}`, { data: { managerId: mgrId } })).ok()).toBeTruthy();

    const api = await apiAs(A, mgr.email);
    const visible = ((await (await api.get("/api/employees")).json()).employees as { email: string }[]).map((m) => m.email);
    expect(visible).toContain(emp1.email);
    expect(visible).not.toContain(emp2.email);
    expect(visible).not.toContain(org.email);

    const emp2Id = all.find((m) => m.email === emp2.email)!.id;
    expect((await api.get(`/api/employees/${emp2Id}`)).status()).toBe(404);
    expect((await api.patch(`/api/employees/${emp2Id}`, { data: { status: "DEACTIVATED" } })).status()).toBe(403);
    expect((await api.get("/api/invitations")).status()).toBe(403);
    expect((await api.patch("/api/organization", { data: { name: "x" } })).status()).toBe(403);

    await mpage.goto("/employees");
    await expect(mpage.getByText(emp1.name)).toBeVisible();
    await expect(mpage.getByText(emp2.name)).toHaveCount(0);
    await expect(mpage.getByRole("button", { name: "Invite" })).toHaveCount(0);
    await expect(mpage.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await mpage.goto("/settings");
    await expect(mpage).toHaveURL(/\/dashboard$/);

    // Explicit grant widens the manager's scope — and only that.
    expect((await adminApi.patch(`/api/employees/${mgrId}`, { data: { accessTeamIds: [teams["Billing"]] } })).ok()).toBeTruthy();
    const widened = ((await (await api.get("/api/employees")).json()).employees as { email: string }[]).map((m) => m.email);
    expect(widened).toContain(emp2.email);
    await mctx.close();
  });

  test("8. unauthenticated requests are rejected everywhere", async ({ browser }) => {
    const anon = await anonApi(A);
    for (const path of ["/api/me", "/api/employees", "/api/organization", "/api/teams", "/api/departments", "/api/invitations"]) {
      expect((await anon.get(path)).status(), path).toBe(401);
    }
    expect((await anon.post("/api/teams", { data: { name: "x" } })).status()).toBe(401);
    expect((await anon.delete("/api/invitations/abc")).status()).toBe(401);
    // There is no public registration endpoint.
    const signup = await anon.post("/api/auth/sign-up/email", { data: { name: "x", email: `s-${tag}@x.test`, password: PASSWORD } });
    expect(signup.status()).toBe(404);
    // A foreign Origin cannot drive a signed-in session.
    const cross = await adminApi.post("/api/teams", { data: { name: "csrf" }, headers: { origin: "https://evil.example" } });
    expect(cross.status()).toBe(403);

    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    for (const path of ["/dashboard", "/employees", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    await ctx.close();
  });

  test("9. companies are isolated: another organization's data is unreachable", async () => {
    const b = { org: `Beta ${tag}`, name: "Bob Admin", email: `bob-${tag}@beta.test` };
    const anon = await anonApi(A);
    expect((await anon.post("/api/onboarding", { data: { organizationName: b.org, timezone: "UTC", name: b.name, email: b.email, password: PASSWORD } })).ok()).toBeTruthy();
    const bApi = await apiAs(A, b.email);
    const bTeam = (await (await bApi.post("/api/teams", { data: { name: "BetaTeam" } })).json()).team.id as string;
    const bDept = (await (await bApi.post("/api/departments", { data: { name: "BetaDept" } })).json()).department.id as string;
    const bInv = (await (await bApi.post("/api/invitations", { data: { email: `inv-${tag}@beta.test`, role: "EMPLOYEE" } })).json()).invitation.id as string;
    const bMe = (await (await bApi.get("/api/me")).json()).membership.id as string;

    // Each side only sees its own people.
    const bList = ((await (await bApi.get("/api/employees")).json()).employees as { email: string }[]).map((m) => m.email);
    expect(bList).toEqual([b.email]);
    const aList = ((await (await adminApi.get("/api/employees")).json()).employees as { email: string }[]).map((m) => m.email);
    expect(aList).not.toContain(b.email);

    // Admin A cannot read or change anything that belongs to B — it simply doesn't exist for them.
    expect((await adminApi.get(`/api/employees/${bMe}`)).status()).toBe(404);
    expect((await adminApi.patch(`/api/employees/${bMe}`, { data: { status: "DEACTIVATED" } })).status()).toBe(404);
    expect((await adminApi.patch(`/api/teams/${bTeam}`, { data: { name: "pwned" } })).status()).toBe(404);
    expect((await adminApi.delete(`/api/teams/${bTeam}`)).status()).toBe(404);
    expect((await adminApi.patch(`/api/departments/${bDept}`, { data: { name: "pwned" } })).status()).toBe(404);
    expect((await adminApi.delete(`/api/invitations/${bInv}`)).status()).toBe(404);
    expect((await adminApi.post(`/api/invitations/${bInv}/resend`, { data: {} })).status()).toBe(404);
    // …nor point their own records at B's teams, departments or managers.
    expect((await adminApi.post("/api/invitations", { data: { email: `cross-${tag}@x.test`, role: "EMPLOYEE", teamId: bTeam } })).status()).toBe(400);
    expect((await adminApi.post("/api/teams", { data: { name: "Cross", departmentId: bDept } })).status()).toBe(400);
    expect((await adminApi.post("/api/teams", { data: { name: "Cross2", managerId: bMe } })).status()).toBe(400);
    // The client cannot choose its organization: extra fields are ignored, not trusted.
    const spoof = await adminApi.post("/api/departments", { data: { name: `Spoof-${tag}`, organizationId: "someone-else" } });
    expect(spoof.ok()).toBeTruthy();
    expect(((await (await bApi.get("/api/departments")).json()).departments as { name: string }[]).map((d) => d.name)).not.toContain(`Spoof-${tag}`);
    // B is untouched.
    expect(((await (await bApi.get("/api/teams")).json()).teams as { name: string }[]).map((t) => t.name)).toEqual(["BetaTeam"]);
  });

  test("10. deactivating a person cuts off access immediately; reactivating restores it", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await login(page, emp1.email);
    await expect(page.getByRole("heading", { name: "Welcome, Eddie" })).toBeVisible();
    const staleApi = await apiAs(A, emp1.email);
    expect((await staleApi.get("/api/me")).ok()).toBeTruthy();

    await admin.goto("/employees");
    await admin.getByRole("button", { name: `Edit ${emp1.name}` }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(admin.getByText(/was deactivated and signed out/)).toBeVisible();

    expect((await staleApi.get("/api/me")).status()).toBe(401); // session was revoked
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await login(page, emp1.email); // identity still exists, but no active workspace
    await expect(page).toHaveURL(/\/no-access/);
    await expect(page.getByRole("heading", { name: "No active workspace" })).toBeVisible();
    expect((await (await apiAs(A, emp1.email)).get("/api/employees")).status()).toBe(403);

    await admin.getByRole("combobox", { name: "Filter by status" }).selectOption("DEACTIVATED");
    await admin.getByRole("button", { name: `Edit ${emp1.name}` }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(admin.getByText(/was reactivated/)).toBeVisible();
    // Their session (created while deactivated) now has an active workspace again: no new login needed.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Welcome, Eddie" })).toBeVisible();
    await ctx.close();
  });

  test("11. forgot password works end-to-end over SMTP and revokes old credentials", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    await page.goto("/forgot-password");
    await page.getByLabel("Work email").fill(emp2.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists/)).toBeVisible();

    const mail = await waitForMail(emp2.email, "Reset your Daymark password");
    const link = linkIn(mail, /http:\/\/localhost:3100\/api\/auth\/reset-password\/[^\s"]+/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await page.getByLabel("New password", { exact: true }).fill("a-brand-new-passphrase");
    await page.getByLabel("Confirm password").fill("a-brand-new-passphrase");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByText("Password updated.")).toBeVisible();

    await login(page, emp2.email, PASSWORD);
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await login(page, emp2.email, "a-brand-new-passphrase");
    await expect(page.getByRole("heading", { name: "Welcome, Bella" })).toBeVisible();

    // The reset link is single-use.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "This reset link isn't valid" })).toBeVisible();

    // Unknown emails get the same answer (no account enumeration).
    const other = await newCtx(browser, A);
    const p2 = await other.newPage();
    await p2.goto("/forgot-password");
    await p2.getByLabel("Work email").fill(`nobody-${tag}@nowhere.test`);
    await p2.getByRole("button", { name: "Send reset link" }).click();
    await expect(p2.getByText(/If an account exists/)).toBeVisible();
    await ctx.close(); await other.close();
  });

  test("12. sign-in attempts are rate limited", async () => {
    const api = await (await import("@playwright/test")).request.newContext({ baseURL: A, extraHTTPHeaders: { origin: A, "x-forwarded-for": "203.0.113.77" } });
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await api.post("/api/auth/sign-in/email", { data: { email: org.email, password: "nope-nope-nope" } })).status());
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBeTruthy();
    expect(statuses).toContain(429);
  });

  test("13. Daymark branding is consistent on public pages", async ({ browser }) => {
    const ctx = await newCtx(browser, A);
    const page = await ctx.newPage();
    for (const path of ["/login", "/onboarding", "/forgot-password"]) {
      await page.goto(path);
      await expect(page).toHaveTitle(/Daymark/);
      await expect(page.getByText("Make Every Day Count.").first()).toBeVisible();
      expect(await page.content()).not.toMatch(/workpulse/i);
    }
    await ctx.close();
  });
});
