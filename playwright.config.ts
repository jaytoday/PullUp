import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests start their own servers (see e2e/servers.ts): a throwaway
 * AskWithAI from ASKWITHAI_REPO with an in-memory database, and PullUp in
 * demo mode on port 3591 with a fresh database file. No model keys needed.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${process.env.PULLUP_E2E_PORT ?? 3591}`, trace: "retain-on-failure", screenshot: "only-on-failure", colorScheme: "dark" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
