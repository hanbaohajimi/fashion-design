import { test, expect, seedVisualApp, settleImages, PROJECT } from "./fixtures";
import { contrastFailures, controlFontFailures } from "../e2e/review-accessibility";

test.beforeEach(async ({ page }) => seedVisualApp(page));

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}`, () => {
  test.use({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768 });
  for (const screen of ["login", "projects", "fabrics", "trends", "invalid-link"]) {
    test(`${screen} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(screen === "projects" ? "/" : screen === "invalid-link" ? "/auth/confirm" : `/${screen}`);
      await expect(page.locator("main")).toBeVisible();
      if (screen === "projects") await expect(page.locator("article")).toHaveCount(2);
      if (screen === "fabrics") await expect(page.getByRole("img", { name: "棉布、哑光、通勤", exact: true }).first()).toBeVisible();
      if (screen === "trends") await expect(page.getByRole("heading", { name: "克制的都市通勤廓形" })).toBeVisible();
      if (screen === "invalid-link") await expect(page.getByRole("link", { name: /登录/u })).toBeVisible();
      await settleImages(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await controlFontFailures(page)).toEqual([]);
      expect(await contrastFailures(page)).toEqual([]);
      if (viewport.width < 768) expect(await page.locator('main button,main input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),main select,main summary').evaluateAll((elements) => {
        const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-height-touch"));
        return elements.filter((element) => element.checkVisibility({ checkVisibilityCSS: true })).map((element) => ({ text: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30), height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })).filter((item) => item.height + 0.1 < minimum || item.width + 0.1 < minimum);
      })).toEqual([]);
      await expect(page).toHaveScreenshot(`${screen}-${viewport.width}.png`, { fullPage: true });
    });
  }
  });
}

test("project empty and failure states", async ({ page }) => {
  await page.route("**/api/projects?*", route => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从第一个系列开始" })).toBeVisible();
  await expect(page).toHaveScreenshot("projects-empty.png");
  await page.route("**/api/projects?*", route => route.fulfill({ status: 503, json: { message: "项目暂时无法读取，请重试" } }));
  await page.reload();
  await expect(page.getByText("项目暂时无法读取，请重试", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("projects-error.png");
});

test.describe("studio touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("assistant actions remain reachable with touch controls", async ({ page }) => {
    await page.goto(`/${PROJECT}`);
    await page.getByRole("button", { name: "助手", exact: true }).click();
    const send = page.getByRole("button", { name: "发送 ↑", exact: true });
    await expect(send).toBeInViewport({ ratio: 1 });
    const minimum = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-height-touch")));
    for (const target of [send, page.getByRole("button", { name: "收起设计助手" }), page.getByText("更多", { exact: true }), page.getByRole("link", { name: "返回项目库", exact: true })]) {
      const bounds = await target.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(minimum);
      expect(bounds!.height).toBeGreaterThanOrEqual(minimum);
    }
    await expect(page).toHaveScreenshot("studio-assistant-touch.png");
    await page.getByText("更多", { exact: true }).click();
    await expect(page.getByRole("button", { name: "新建设计对话", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page).toHaveScreenshot("studio-menu-touch.png");
  });
});

test("studio, sketch, asset and export", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${PROJECT}`);
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(1);
  await page.getByRole("button", { name: "适合画布" }).click();
  await expect(page.locator('[data-type="candidate"]')).toBeInViewport({ ratio: 0.999 });
  await settleImages(page);
  await expect(page).toHaveScreenshot("studio-desktop.png");
  await page.getByRole("button", { name: "＋ 添加素材", exact: true }).click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "绘制廓形草图" })).toBeVisible();
  await expect(page).toHaveScreenshot("sketch.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-type="candidate"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  await expect(page.getByRole("dialog", { name: "候选资产工作台" })).toBeVisible();
  await settleImages(page);
  await expect(page).toHaveScreenshot("asset-preview.png");
  const preview = page.getByRole("tab", { name: "大图预览", exact: true });
  await preview.focus();
  await preview.press("End");
  await expect(page.getByRole("tab", { name: "版本历史" })).toBeFocused();
  await expect(preview).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "版本历史" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "版本时间线" })).toBeVisible();
  await expect(page).toHaveScreenshot("asset-history-empty.png");
  await preview.click();
  await page.getByRole("button", { name: "单图高清导出" }).click();
  await expect(page.getByRole("button", { name: "开始导出", exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("export-ready.png");
});
