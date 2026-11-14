// The full lifecycle through the REAL viaSocket builder, embedded in Daymark, in a real browser.
// Covers the embed page's "Finished when" lines that need a human-style interaction.
import { chromium, type Page } from "@playwright/test";
import { BASE, Daymark, automationToken, check, identityOf, runHistory, runsOf, state, summary, until, viasocket } from "./lib.mts";

const ID = identityOf(state("org_id"));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const page: Page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 } })).newPage();
await page.addInitScript(() => {
  (window as any).__vs = [];
  window.addEventListener("message", (e) => { if (e.origin === "https://embedfrontend.viasocket.com") (window as any).__vs.push(e.data); });
});
const events = () => page.evaluate(() => (window as any).__vs as any[]);
const frame = () => page.frames().find((x) => /embedfrontend\.viasocket\.com/.test(x.url()))!;
// Clicks by coordinates inside the embed, after scrolling it clear of Daymark's sticky header.
const embedClick = async (x: number, y: number) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const b = (await page.locator("#viasocket-embed").boundingBox())!;
  await page.mouse.click(b.x + x, b.y + y);
};

await page.goto("/login");
await page.getByLabel("Work email").fill(state("admin_email"));
await page.getByLabel("Password").fill(state("pw"));
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: /^Welcome,/ }).waitFor();
await page.goto("/automations");
await page.waitForSelector("#viasocket-embed iframe", { timeout: 45_000 });
await until("embed frame loaded", async () => frame(), 45_000, 500);
check("[embed 1] the page loaded with the organization's token and the embed rendered in Daymark's box", !!frame());
await until("embed content", async () => /Add new Automation/i.test(await frame().locator("body").innerText().catch(() => "")), 40_000, 1000);

// Build a trivial flow in the real UI: Custom Logic (JS) → code → Test → Save
const fl = page.frameLocator("#viasocket-embed iframe");
await fl.getByText("Add new Automation").first().click();
await fl.getByText("Custom Logic (JS)").first().click({ timeout: 30_000 });
await fl.getByText("See code").first().click({ timeout: 30_000 });
await page.waitForTimeout(3000);
// Focus the (third-party) code editor and type; retry until the builder reports it has code (Test becomes enabled).
const testButton = () => frame().getByRole("button", { name: "Test", exact: true }).first();
for (let attempt = 0; attempt < 5 && !(await testButton().isEnabled().catch(() => false)); attempt++) {
  await embedClick(500, 380 + attempt * 25);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("return 42");
  await page.waitForTimeout(1500);
}
await testButton().click();
await frame().getByRole("button", { name: "Confirm Test" }).first().click({ timeout: 4000 }).catch(() => undefined); // only appears when the code reads inputs
await until("save enabled", async () => frame().getByRole("button", { name: "Save", exact: true }).first().isEnabled().catch(() => false), 40_000, 800);
await frame().getByRole("button", { name: "Save", exact: true }).first().click();

const published = await until("published event", async () => (await events()).find((e) => e?.action === "published"), 60_000, 1000);
check("[embed 3] a flow published in the real UI reached the listener as `published` with a webhook URL", published.status === "active" && typeof published.webhookurl === "string" && new URL(published.webhookurl).host === "flow.sokt.io", `status=${published.status}`);
check("an `initiated`(drafted) event preceded it", (await events()).some((e) => e?.action === "initiated" && e.status === "drafted" && e.id === published.id));
const title: string = published.title;

// Daymark finds it by itself (the event only says "something changed"; the server re-reads viaSocket)
const row = page.getByTestId("flow-row").filter({ hasText: title });
await row.waitFor({ timeout: 30_000 });
check("Daymark picked the new flow up automatically (no manual refresh), unlinked and active", (await row.innerText()).includes("active") && (await row.getByLabel(/Starts when/).inputValue()) === "");
check("the page never exposes the flow URL", !(await page.content()).includes("flow.sokt.io"));

// Link it and send a real test event
await row.getByLabel(/Starts when/).selectOption({ label: "Daily Update Submitted" });
await page.getByText("Automation linked").waitFor();
const reqs: string[] = [];
page.on("request", (r) => { if (/\/api\/automations/.test(r.url())) reqs.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[a-z0-9]{20,}/g, ":id")}`); });
const testBtn = row.getByRole("button", { name: "Send test event" });
console.log("button disabled before click?", await testBtn.isDisabled(), "| select value:", await row.getByLabel(/Starts when/).inputValue());
await testBtn.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const bb = (await testBtn.boundingBox())!;
const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${(e.className || "").toString().slice(0, 60)} :: ${(e.textContent || "").trim().slice(0, 30)}` : "none"; }, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
console.log("element at the button centre:", hit, "| box:", JSON.stringify({ y: Math.round(bb.y), h: Math.round(bb.height) }));
await testBtn.click();
await page.waitForTimeout(2500);
console.log("requests after click:", JSON.stringify(reqs));
await page.screenshot({ path: `${process.env.LIVE_STATE_DIR}/after-click.png` });
console.log("toasts:", JSON.stringify(await page.locator("[data-sonner-toast]").allInnerTexts()));
await page.getByText(/Test event accepted by viaSocket/).waitFor({ timeout: 30_000 });
check("[embed 4] POST to the flow URL was done and answered (test event accepted)", true);
await page.getByTestId("delivery-row").first().waitFor();
const T = await automationToken(ID);
const runs = await until("a run exists in viaSocket", async () => { const r = runsOf(await runHistory(T, published.id)); return r.length ? r : null; }, 30_000, 1500);
check("viaSocket's run history shows the run Daymark caused", runs[0].status === "success", `status=${runs[0].status}`);

// `embed.update(...)`-style live change is covered by the page's own config; here: pause in the real UI
await embedClick(934, 24); // ⋮
await frame().getByText("Pause", { exact: true }).first().click({ timeout: 15_000 });
const paused = await until("paused event", async () => (await events()).find((e) => e?.action === "paused"), 40_000, 1000);
check("[embed 5] a flow paused in the real UI reached the listener as `paused`", paused.status === "paused" && paused.id === published.id);
await row.getByText("paused", { exact: true }).waitFor({ timeout: 30_000 });
check("Daymark marked it paused and disabled 'Send test event'", await row.getByRole("button", { name: "Send test event" }).isDisabled());

// Quick start: the page opens the real builder at Slack, carrying the event's synthetic sample data
const quick = page.getByRole("group", { name: "Quick start with Slack for a Daymark event" });
await quick.waitFor({ timeout: 30_000 });
await quick.getByRole("button", { name: "Employee Reports a Blocker" }).click();
await until("slack actions shown", async () => /Send Message/.test(await frame().locator("body").innerText().catch(() => "")), 30_000, 1000);
check("quick start opens the real builder at Slack's actions", /\/service\/rowbu58rc/.test(frame().url()));

// clean up the flow we made
await viasocket.user(ID).deleteFlow(published.id);
await new Daymark().signIn(state("admin_email"), state("pw")).then((d) => d.req("POST", "/api/automations/sync", {}));
await page.screenshot({ path: `${process.env.LIVE_STATE_DIR}/lifecycle.png`, fullPage: true });
await browser.close();
summary();
