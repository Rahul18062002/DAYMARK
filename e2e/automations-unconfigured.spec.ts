import { expect, test } from "@playwright/test";
import { B, createOrgApi, login, newCtx, uniq } from "./helpers";

// Server :3101 has NO viaSocket configuration at all.
test("without viaSocket configured: a calm setup state, no errors, and everything else is untouched", async ({ browser }) => {
  const tag = uniq();
  const email = `una-${tag}@auto.test`;
  const api = await createOrgApi(B, { org: `Unconf ${tag}`, name: "Una Admin", email });
  const ctx = await newCtx(browser, B);
  const page = await ctx.newPage();
  await login(page, email);
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Automations" }).click();
  await expect(page.getByText("Automations aren't set up on this server")).toBeVisible();
  await expect(page.getByText(/VIASOCKET_EMBED_SECRET/)).toBeVisible();
  await expect(page.getByTestId("viasocket-embed")).toHaveCount(0);
  const token = await api.get("/api/viasocket/token");
  expect(token.status()).toBe(503);
  const cron = await api.get("/api/cron/integrations");
  expect(cron.status()).toBe(503); // CRON_SECRET is not set → refuses to run
  // Core features work exactly as before.
  const created = await api.post("/api/updates", { data: { sections: { workedOn: ["core works without viaSocket"], blockers: ["a real blocker"] }, submit: true } });
  expect(created.ok()).toBeTruthy();
  await ctx.close();
});
