import { expect, test } from "@playwright/test";
import { A, newCtx, onboard, uniq } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// Under mobile emulation innerWidth can grow with the content, so compare against the real
// layout width (clientWidth) and check both the root and body scroll widths.
const noHScroll = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= w + 1;
  });

test("mobile: public pages, drawer navigation and tables fit the viewport", async ({ browser }) => {
  const tag = uniq();
  const ctx = await browser.newContext({ baseURL: A, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 200) } });
  void newCtx;
  const page = await ctx.newPage();

  await page.goto("/login");
  expect(await noHScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-login.png" });

  await page.goto("/onboarding");
  expect(await noHScroll(page)).toBe(true);
  await onboard(page, { org: `Mobile ${tag}`, name: "Mia Mobile", email: `mia-${tag}@mobile.test` });
  expect(await noHScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-dashboard.png", fullPage: true });

  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer.getByRole("link", { name: "Employees" })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-menu.png" });
  await drawer.getByRole("link", { name: "Employees" }).click();
  await expect(page).toHaveURL(/\/employees$/);
  await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible(); // real content, not the skeleton
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0); // drawer closes on navigation
  expect(await noHScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-employees.png", fullPage: true });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-settings.png", fullPage: true });
  await ctx.close();
});
