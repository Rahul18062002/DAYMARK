import { expect, test } from "@playwright/test";
import { B, PASSWORD, newCtx, onboard, uniq } from "./helpers";

// Server :3101 has no SMTP configured: nothing may pretend to send email.
test("without SMTP: copyable invitation links work and password reset reports the missing config", async ({ browser }) => {
  const tag = uniq();
  const ctx = await newCtx(browser, B);
  const admin = await ctx.newPage();
  await onboard(admin, { org: `NoMail ${tag}`, name: "Nora Admin", email: `nora-${tag}@nomail.test` });

  await admin.goto("/forgot-password");
  await expect(admin.getByText(/Email delivery isn't configured/)).toBeVisible();
  await expect(admin.getByRole("button", { name: "Send reset link" })).toHaveCount(0);

  const inviteEmail = `ivy-${tag}@nomail.test`;
  await admin.goto("/employees");
  await admin.getByRole("button", { name: "Invite" }).click();
  const d = admin.getByRole("dialog");
  await d.getByLabel("Email").fill(inviteEmail);
  await d.getByRole("button", { name: "Send invitation" }).click();
  await expect(d.getByRole("heading", { name: "Invitation created" })).toBeVisible();
  await expect(d.getByText(/Email isn't configured/)).toBeVisible();
  const link = await d.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(new RegExp(`^${B}/invite/`));
  await d.getByRole("button", { name: "Done" }).click();

  // Resend rotates the link; the old one stops working.
  await admin.getByRole("button", { name: "Resend" }).click();
  const fresh = await admin.getByLabel("Invitation link").inputValue();
  expect(fresh).not.toBe(link);

  const guest = await (await newCtx(browser, B)).newPage();
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();
  await guest.goto(fresh);
  await guest.getByLabel("Your name").fill("Ivy Invited");
  await guest.getByLabel("Choose a password").fill(PASSWORD);
  await guest.getByRole("button", { name: /Create account/ }).click();
  await expect(guest.getByRole("heading", { name: "Welcome, Ivy" })).toBeVisible();
});
