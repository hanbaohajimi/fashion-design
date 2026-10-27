import { test, expect } from "@playwright/test";
import { seedVisualApp } from "../visual/fixtures";

for (const width of [1440, 900, 390]) {
  test(`隔离结构原型 ${width}`, async ({ page }) => {
    await seedVisualApp(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/prototypes/desktop-agent-ui");
    const input = page.getByRole("textbox", { name: "描述设计需求" });
    await expect(input).toBeVisible();
    await input.fill("原型草稿");
    if (width === 900) {
      await expect(page.getByRole("dialog", { name: "设计助手面板" })).toBeVisible();
      await page.keyboard.press("Escape");
    } else await page.getByRole("button", { name: "收起助手" }).click();
    for (const view of ["作品", "技术包", "项目库"]) {
      const button = page.getByRole("button", { name: view, exact: true });
      await button.focus(); await button.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("button", { name: "打开助手" }).click();
    await expect(input).toHaveValue("原型草稿");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/desktop-agent-ui/prototype-${width}.png` });
  });
}
