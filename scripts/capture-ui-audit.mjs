/** Read-only browser audit; all API requests use fixtures. Writes only output/. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const { chromium } = require("@playwright/test");
const {
  seedVisualApp,
  settleImages,
  PROJECT,
} = require("../tests/visual/fixtures.ts");
const {
  workspaceFixture,
  experimentFixture,
} = require("../tests/visual/workspace-fixture.ts");
const {
  contrastFailures,
  controlFontFailures,
} = require("../tests/e2e/review-accessibility.ts");
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "output/ui-refactor/after");
fs.mkdirSync(output, { recursive: true });
const css = fs.readFileSync(
  path.join(root, "apps/web/src/styles/design-system.css"),
  "utf8",
);
// Local inspection uses the real project font stack. Linux snapshot tests pin CJK fonts separately.
const fontPatch =
  ":root{" +
  ["font-sans", "font-serif", "font-mono"]
    .map(
      (key) =>
        `--${key}:${css.match(new RegExp(`--${key}:([^;]+);`))[1]}!important;`,
    )
    .join("") +
  "}";
const widths = (process.env.UI_AUDIT_WIDTHS ?? "1280,1366,1440,1920,375,390")
  .split(",")
  .map(Number);
const filter = process.env.UI_AUDIT_SCREENS?.split(",");
const screens = [
  ["login", "/login"],
  ["projects", "/"],
  ["fabrics", "/fabrics"],
  ["trends", "/trends"],
  ["invalid-link", "/auth/confirm"],
  ["canvas", `/${PROJECT}`],
  ...[
    "tasks",
    "styles",
    "experiments",
    "patterns",
    "presentation",
    "brand",
    "planning",
    "tech",
    "samples",
    "team",
    "trends",
  ].map((tab) => [`studio-${tab}`, `/${PROJECT}/studio?tab=${tab}`]),
].filter(([name]) => !filter || filter.includes(name));
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const width of widths)
    for (const [name, url] of screens) {
      const height =
        width === 1280
          ? 800
          : width === 1366
            ? 768
            : width === 375
              ? 812
              : width === 390
                ? 844
                : width === 1920
                  ? 1080
                  : 900;
      const page = await browser.newPage({
        viewport: { width, height },
        locale: "zh-CN",
        hasTouch: width < 768,
      });
      try {
        await seedVisualApp(page);
        const data = workspaceFixture();
        await page.route("**/api/projects/*/studio", (route) =>
          route.fulfill({ json: data }),
        );
        await page.route("**/api/projects/*/experiments", (route) =>
          route.fulfill({ json: experimentFixture(PROJECT) }),
        );
        await page.route("**/images/*.png", (route) =>
          route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e9e5df"/><path d="M200 120 300 70 400 120 470 260 380 290 370 690 230 690 220 290 130 260Z" fill="#263950"/></svg>',
          }),
        );
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:3000${url}`);
        await page.addStyleTag({ content: fontPatch });
        await page.locator("main").first().waitFor();
        if (name.startsWith("studio-"))
          await page
            .locator('[role="tabpanel"]:not([hidden]) h2')
            .first()
            .waitFor();
        if (name === "studio-experiments")
          await page
            .getByRole("heading", { name: "藏蓝方案", exact: true })
            .waitFor();
        if (name === "fabrics")
          await page
            .getByRole("img", { name: "棉布、哑光、通勤", exact: true })
            .first()
            .waitFor();
        if (name === "trends")
          await page
            .getByRole("heading", { name: "克制的都市通勤廓形" })
            .waitFor();
        if (name === "projects")
          await page
            .getByRole("heading", { name: "秋冬通勤服装设计" })
            .first()
            .waitFor();
        if (name === "canvas") {
          await page
            .locator('[data-type="candidate"]')
            .waitFor({ state: "attached" });
          await page.getByRole("button", { name: "适合画布" }).click();
        }
        await settleImages(page);
        await page.screenshot({
          path: path.join(output, `${name}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          firstControlTop: [
            ...document.querySelectorAll(
              'main input:not([type="file"]):not([type="checkbox"]),main textarea',
            ),
          ]
            .filter((element) => element.checkVisibility())[0]
            ?.getBoundingClientRect().top,
        }));
        const result = {
          name,
          width,
          ...metrics,
          contrast: await contrastFailures(page, name !== "canvas"),
          smallControls: await controlFontFailures(page),
          errors,
        };
        results.push(result);
        console.log(JSON.stringify(result));
        if (name === "canvas" && width >= 1280) {
          await page.locator('[data-type="candidate"]').focus();
          await page.keyboard.press("Enter");
          await page
            .getByRole("button", { name: "打开大图、版本与局部重绘" })
            .click();
          await settleImages(page);
          await page.screenshot({
            path: path.join(output, `asset-preview-${width}.png`),
            animations: "disabled",
          });
          await page.getByRole("button", { name: "单图高清导出" }).click();
          await page
            .getByRole("button", { name: "开始导出", exact: true })
            .waitFor();
          await page.screenshot({
            path: path.join(output, `export-${width}.png`),
            animations: "disabled",
          });
        }
      } catch (error) {
        results.push({ name, width, error: error.message });
        console.error(`${name} ${width}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
} finally {
  await browser.close();
}
const auditPath = path.join(output, "audit.json");
const previous = fs.existsSync(auditPath)
  ? JSON.parse(fs.readFileSync(auditPath, "utf8"))
  : [];
const merged = new Map(
  previous.map((result) => [`${result.name}:${result.width}`, result]),
);
for (const result of results)
  merged.set(`${result.name}:${result.width}`, result);
fs.writeFileSync(auditPath, JSON.stringify([...merged.values()], null, 2));
if (
  results.some(
    (result) =>
      result.error ||
      result.overflow ||
      result.contrast?.length ||
      result.smallControls?.length ||
      result.errors?.length,
  )
)
  process.exitCode = 1;
