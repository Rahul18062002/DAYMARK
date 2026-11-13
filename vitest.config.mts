import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config({ path: ".env.test", override: true });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/empty.ts") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
