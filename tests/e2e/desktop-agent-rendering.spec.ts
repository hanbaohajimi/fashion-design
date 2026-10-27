import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { seedVisualApp, PROJECT, settleImages } from "../visual/fixtures";

const audit = readFileSync("scripts/manual/clip-audit.js", "utf8");

for (const dpr of [1, 1.25, 2]) {
  test(`多状态阴影与焦点 DPR ${dpr}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, baseURL: "http://127.0.0.1:3000" });
    const page = await context.newPage();
    await seedVisualApp(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/${PROJECT}`);
    await expect(page.getByRole("heading", { name: "方案与灵感" })).toBeInViewport();
    await settleImages(page);
    const directory = `output/desktop-agent-ui/states/${dpr}`;
    await mkdir(directory, { recursive: true });
    const capture = async (state: string) => {
      const result = await page.evaluate(source => (0, eval)(source)({ root: "body" }) as { cut: number; hidden: number; issues: unknown[] }, audit);
      await writeFile(`${directory}/${state}.json`, JSON.stringify(result, null, 2));
      await page.screenshot({ path: `${directory}/${state}.png` });
      expect.soft(result.cut, `${state} shadow clipping`).toBe(0);
    };
    await capture("default");
    const task = page.getByRole("button", { name: /^项目任务/ });
    await task.hover();
    await capture("hover");
    await task.click();
    const dialog = page.getByRole("dialog", { name: "项目任务", exact: true });
    await expect(dialog).toBeVisible();
    await capture("expanded");
    await expect(dialog).toHaveAttribute("data-phase", "open");
    await capture("motion-end");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(task).toBeFocused();
    await task.press("Tab");
    await page.screenshot({ path: `${directory}/keyboard-focus.png` });
    await context.close();
  });
}
