import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 400 },
]) {
  test(`${viewport.width}px分组功能面板可滚动且保持底部入口`, async ({
    page,
  }) => {
    const state = await prepareZhiya(page, {
      realClock: true,
      count: 2,
      viewport,
    });
    await useCanvasPhotograph(page);
    await loadZhiya(page);
    const trigger = page.getByRole("button", {
      name: "全部功能模块",
      exact: true,
    });
    await expect(trigger).toHaveText("");
    await expect(
      trigger.locator('[data-bottom-toolbar-icon="modules"]'),
    ).toHaveCount(1);
    await mkdir("output/creation-catalog", { recursive: true });
    await page
      .getByRole("complementary", { name: "工具条", exact: true })
      .screenshot({
        path: `output/creation-catalog/toolbar-${viewport.width}.png`,
      });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "全部功能模块",
      exact: true,
    });
    await expect(dialog.getByRole("textbox", { name: "搜索功能" })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("searchbox", { name: "搜索功能" }),
    ).toBeFocused();
    for (const name of ["图片", "实验", "工作台", "研究", "画布管理"])
      await expect(
        dialog.getByRole("heading", { name, exact: true }),
      ).toBeAttached();
    const items = dialog
      .getByRole("region", { name: "图片", exact: true })
      .getByRole("button");
    const columns = await items.evaluateAll(
      (buttons) =>
        new Set(
          buttons.map((button) => Math.round(button.getBoundingClientRect().x)),
        ).size,
    );
    expect(columns).toBe(
      viewport.width > 800 ? 3 : viewport.width > 600 ? 2 : 1,
    );
    await page.screenshot({
      path: `output/creation-catalog/panel-${viewport.width}.png`,
      animations: "disabled",
    });
    await dialog.screenshot({
      path: `output/creation-catalog/panel-detail-${viewport.width}.png`,
      animations: "disabled",
    });
    const objects = dialog.getByRole("button", {
      name: "画布对象",
      exact: true,
    });
    await objects.scrollIntoViewIfNeeded();
    await expect(objects).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "关闭全部功能" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("searchbox")).toBeInViewport({ ratio: 1 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("现有描述和画布关键词继续可搜索，最近记录来自原有偏好", async ({
  page,
}) => {
  const state = await prepareZhiya(page, { realClock: true });
  await page.addInitScript(() =>
    localStorage.setItem(
      "fashion:creative-canvas:visual-designer",
      JSON.stringify({ connections: true, recent: ["color", "image-crop"] }),
    ),
  );
  await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "全部功能模块" });
  const recent = dialog.getByRole("region", { name: "最近使用", exact: true });
  await expect(
    recent.getByRole("button", { name: "换色实验", exact: true }),
  ).toBeVisible();
  await expect(
    recent.getByRole("button", { name: "裁剪图片", exact: true }),
  ).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "搜索功能" });
  await search.fill("材质效果");
  await expect(
    dialog.getByRole("button", { name: "换面料", exact: true }),
  ).toBeVisible();
  await search.fill("锁定");
  await expect(
    dialog.getByRole("button", { name: "画布对象", exact: true }),
  ).toBeVisible();
  await search.fill("不存在的功能");
  await expect(dialog.getByRole("status")).toHaveText("没有找到相关功能");
  await dialog.getByRole("button", { name: "清除搜索" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("只读项目保留原有功能权限和画布对象入口", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, canEdit: false });
  await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "全部功能模块" });
  await expect(
    dialog.getByRole("button", { name: "图片创作", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "时尚趋势", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "画布对象", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "画布对象", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "全部功能模块" })).toBeHidden();
  await expect(
    page.getByRole("region", { name: "画布对象", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
