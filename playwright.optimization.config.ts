import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "output/playwright/optimization-results",
  reporter: [["list"], ["json", { outputFile: "output/playwright/optimization-results.json" }]],
  use: { ...base.use, baseURL: "http://127.0.0.1:3010" },
  webServer: {
    command: "pnpm --filter @fashion/web exec next dev --port 3010",
    env: { NEXT_DIST_DIR: ".next/optimization", NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_POSTHOG_KEY: "" },
    url: "http://127.0.0.1:3010",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
