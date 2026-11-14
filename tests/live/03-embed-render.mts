// The REAL viaSocket embed, in a real browser, mounted by Daymark's Automations page with a real token.
import { chromium } from "@playwright/test";
import { BASE, check, state, summary } from "./lib.mts";

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
const seen: any[] = [];
await page.addInitScript(() => {
  (window as any).__vsMessages = [];
  window.addEventListener("message", (e) => { if (e.origin === "https://embedfrontend.viasocket.com") (window as any).__vsMessages.push(e.data); });
});
const failed: string[] = [];
page.on("requestfailed", (r) => { if (/viasocket/.test(r.url())) failed.push(r.url().slice(0, 90)); });
await page.goto("/login");
await page.getByLabel("Work email").fill(state("admin_email"));
await page.getByLabel("Password").fill(state("pw"));
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: /^Welcome,/ }).waitFor();
await page.goto("/automations");
await page.getByRole("heading", { name: "Automations", level: 1 }).waitFor();
const frame = await page.waitForSelector('#viasocket-embed iframe', { timeout: 45_000 }).catch(() => null);
check("the real embed's iframe was added inside Daymark's box", !!frame, frame ? await frame.getAttribute("src").then((s) => (s ?? "").split("?")[0]) : "none; failed requests: " + failed.join(", "));
await page.waitForTimeout(8000);
check("Daymark did not show its error state", (await page.getByText("The automation builder couldn't load").count()) === 0);
const f = page.frames().find((x) => /embedfrontend\.viasocket\.com/.test(x.url()));
check("the iframe is served from viaSocket's embed origin", !!f, f?.url().split("?")[0] ?? "");
if (f) {
  const text = (await f.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  check("the embed rendered content (not blank / 'Could not load')", text.length > 20 && !/could not load/i.test(text), text.slice(0, 160));
}
await page.screenshot({ path: `${process.env.LIVE_STATE_DIR}/embed.png`, fullPage: true });
console.log("messages from the embed so far:", JSON.stringify(await page.evaluate(() => (window as any).__vsMessages.map((m: any) => ({ action: m?.action, status: m?.status })))));
await browser.close();
summary();
