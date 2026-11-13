import { readFileSync } from "node:fs";
import { expect, type Browser, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { playwright } from "./pw";

export const A = "http://localhost:3100"; // SMTP configured (captured)
export const B = "http://localhost:3101"; // no SMTP
export const PASSWORD = "correct-horse-battery";
export const MAILBOX = "test-results/mailbox.jsonl";

export const uniq = () => Math.random().toString(36).slice(2, 8);
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** A browser context that looks like a distinct client (own IP for rate limiting). */
export async function newCtx(browser: Browser, baseURL: string): Promise<BrowserContext> {
  return browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
}

export async function onboard(page: Page, o: { org: string; name: string; email: string; password?: string }) {
  await page.goto("/onboarding");
  await page.getByLabel("Company name").fill(o.org);
  await page.getByLabel("Your name").fill(o.name);
  await page.getByLabel("Work email").fill(o.email);
  await page.getByLabel("Password").fill(o.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A signed-in API client for the given user (real session cookie, like a browser). */
export async function apiAs(baseURL: string, email: string, password = PASSWORD): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-forwarded-for": randomIp() } });
  const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
  return ctx;
}

export async function anonApi(baseURL: string): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-forwarded-for": randomIp() } });
}

type Mail = { to: string; subject: string; text: string; html: string };
export async function waitForMail(to: string, subjectIncludes: string, timeoutMs = 15_000): Promise<Mail> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const mails: Mail[] = readFileSync(MAILBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const hit = mails.reverse().find((m) => m.to.toLowerCase() === to.toLowerCase() && m.subject.includes(subjectIncludes));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} with subject containing "${subjectIncludes}"`);
}

export function linkIn(mail: Mail, pattern: RegExp): string {
  const m = mail.text.match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in:\n${mail.text}`);
  return m[0];
}
