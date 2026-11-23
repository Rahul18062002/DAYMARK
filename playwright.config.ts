import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test", override: true });

const base = {
  DATABASE_URL: process.env.DATABASE_URL!,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
};
// Dummy viaSocket values (tokens are signed locally; nothing real). Server :3101 has none at all.
const viaSocketDummy = {
  VIASOCKET_ORG_ID: "test-org",
  VIASOCKET_PROJECT_ID: "test-project",
  VIASOCKET_EMBED_SECRET: process.env.VIASOCKET_EMBED_SECRET!,
  CRON_SECRET: process.env.CRON_SECRET!,
};

// Two real servers on the same database:
//  :3100 has SMTP pointed at a local capture server (emails are really sent over SMTP)
//  :3101 has no SMTP at all (exercises the copyable-link fallback)
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    // Optional: use an already-installed Chromium (set PW_CHROMIUM_PATH) instead of Playwright's own download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx next start -p 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...base, BETTER_AUTH_URL: "http://localhost:3100", NEXT_PUBLIC_APP_URL: "http://localhost:3100", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_FROM: "Daymark <no-reply@daymark.test>", ANTHROPIC_API_KEY: "e2e-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:2526", AI_PROVIDER: "anthropic", ...viaSocketDummy },
    },
    {
      command: "npx next start -p 3101",
      url: "http://localhost:3101/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...base, BETTER_AUTH_URL: "http://localhost:3101", NEXT_PUBLIC_APP_URL: "http://localhost:3101", SMTP_HOST: "", VIASOCKET_ORG_ID: "", VIASOCKET_PROJECT_ID: "", VIASOCKET_EMBED_SECRET: "", CRON_SECRET: "" },
    },
  ],
});
