import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/real-e2e", timeout: 180_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  outputDir: "output/playwright/real-results",
  reporter: [["list"], ["html", { outputFolder: "output/playwright/real-report", open: "never" }]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4300", actionTimeout: 30_000, navigationTimeout: 45_000, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
