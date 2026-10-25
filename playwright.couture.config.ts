import { defineConfig, devices } from "@playwright/test";

// Separate port and artifacts keep motion recordings independent of other UI reviews.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "couture-motion.spec.ts",
  outputDir: "output/playwright/couture-results",
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 12_000 },
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "output/playwright/couture-report" },
    ],
  ],
  use: { baseURL: "http://127.0.0.1:3107", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @fashion/web exec next start --port 3107",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
