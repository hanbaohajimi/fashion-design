import { defineConfig } from "@playwright/test";

const port = process.env.ATELIER_VISUAL_PORT;
if (!port || !process.env.ATELIER_VISUAL_CDP)
  throw new Error("请使用 pnpm test:e2e:visual 启动固定的视觉验收环境");

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "output/playwright/visual-results",
  // Review candidates outside the committed baseline before promoting individual images.
  snapshotPathTemplate:
    process.env.ATELIER_VISUAL_REVIEW === "1"
      ? "{testDir}/../../output/ui-refactor/visual-candidates/{testFilePath}/{arg}{ext}"
      : "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 12_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
    },
  },
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "output/playwright/visual-report" },
    ],
  ],
  use: {
    baseURL: `http://host.docker.internal:${port}`,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm --filter @fashion/web exec next dev --port ${port} --hostname 0.0.0.0`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
