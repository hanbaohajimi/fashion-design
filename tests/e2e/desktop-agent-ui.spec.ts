import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { seedVisualApp, settleImages, PROJECT } from "../visual/fixtures";
import { workspaceFixture, experimentFixture } from "../visual/workspace-fixture";

const tabs = ["tasks", "styles", "experiments", "patterns", "presentation", "runway", "planning", "tech", "samples", "team", "trends", "brand"];
const clipAudit = readFileSync("scripts/manual/clip-audit.js", "utf8");
const phase = process.env.DESKTOP_UI_PHASE ?? "after";

for (const width of [1920, 1440, 1366, 1024, 768, 390]) {
  test(`桌面工作台全入口 ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await seedVisualApp(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
    await page.route(`**/api/projects/${PROJECT}/experiments`, route => route.fulfill({ json: experimentFixture(PROJECT) }));
    await page.setViewportSize({ width, height: width < 768 ? 844 : width === 1920 ? 1080 : width === 1440 ? 900 : 768 });
    const directory = `output/desktop-agent-ui/${phase}/${width}`;
    await mkdir(directory, { recursive: true });
    for (const [name, url] of [
      ["projects", "/"], ["workbench", `/${PROJECT}`], ["fabrics", "/fabrics"], ["trend-library", "/trends"],
      ...tabs.map(tab => [tab, `/${PROJECT}/studio?tab=${tab}${tab === "runway" ? "&showId=show-1&runId=run-1" : ""}`]),
      ["login", "/login"], ["confirm", "/auth/confirm"], ["share", `/share/${"a".repeat(43)}`],
    ]) {
      await page.goto(url!);
      await expect(page.locator("main")).toBeVisible();
      if (url!.includes("/studio?")) await expect(page.locator('[role="tabpanel"]:not([hidden]) h2').first()).toBeVisible();
      if (name === "workbench") {
        await expect(page.getByRole("heading", { name: "方案与灵感" })).toBeVisible();
        await writeFile(`${directory}/geometry.json`, JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("main, [data-split-docked], [data-group], [data-panel], [aria-label='设计作品工作台']")).map(node => ({ tag: node.tagName, class: node.className, rect: node.getBoundingClientRect().toJSON(), display: getComputedStyle(node).display, flex: getComputedStyle(node).flex, overflow: getComputedStyle(node).overflow }))), null, 2));
        await expect(page.getByRole("heading", { name: "方案与灵感" })).toBeInViewport();
      }
      await settleImages(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
      await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
      const fonts = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll("body *")).filter(node => !node.closest("script, style, svg, [aria-hidden=true], .tl-container") && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1 && Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(node => getComputedStyle(node).fontSize))].sort());
      await writeFile(`${directory}/${name}-fonts.json`, JSON.stringify(fonts));
      expect.soft(fonts.map(parseFloat).every(size => size >= 12), `${name} minimum font size`).toBe(true);
      expect.soft(fonts.length, `${name} type scale`).toBeLessThanOrEqual(4);
      const audit = await page.evaluate(source => (0, eval)(source)({ root: "body" }) as { cut: number; issues: unknown[] }, clipAudit);
      await writeFile(`${directory}/${name}-clip.json`, JSON.stringify(audit, null, 2));
      expect.soft(audit.cut, `${name} shadow clipping`).toBe(0);
    }
  });
}
