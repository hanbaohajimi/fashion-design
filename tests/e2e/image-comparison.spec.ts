import { openImageComparison } from "./image-workspace-controls";
import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { prepareImageComparison } from "./image-comparison-fixture";
import { chooseValue } from "./choice-control";

test.setTimeout(90_000);
test.use({
  video: process.env.IMAGE_COMPARISON_DEMO
    ? { mode: "on", size: { width: 1440, height: 900 } }
    : "off",
});
test.beforeEach(async () => {
  await mkdir("output/playwright/image-comparison", { recursive: true });
});
test.afterEach(async ({ page }, info) => {
  if (!process.env.IMAGE_COMPARISON_DEMO || info.status !== "passed") return;
  const video = page.video();
  await page.close();
  await video?.saveAs(
    `output/playwright/image-comparison/tour-${info.title.match(/\d+px/u)?.[0] ?? "history"}.webm`,
  );
});
const history = async (workspace: Locator) => {
  await workspace.getByRole("button", { name: "版本与对比", exact: true }).click();
  await workspace
    .getByRole("button", { name: "版本历史", exact: true })
    .click();
};
const saveOrientation = async (workspace: Locator) => {
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await workspace.getByRole("button", { name: "向右旋转 90 度" }).click();
  if (process.env.IMAGE_COMPARISON_DEMO)
    await workspace.page().waitForTimeout(1200);
  await workspace
    .getByRole("button", { name: "保存为新版本", exact: true })
    .click();
};

for (const width of [1440, 390, 320]) {
  test(`${width}px 比较两版并从选中图片继续修改`, async ({ page }) => {
    const state = await prepareImageComparison(page, width);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openImageComparison(workspace);
    const comparison = workspace.getByRole("region", {
      name: "比较方案",
      exact: true,
    });
    const current = comparison.getByRole("region", {
      name: "当前图片",
      exact: true,
    });
    const other = comparison.getByRole("region", {
      name: "对比图片",
      exact: true,
    });
    await expect(
      other.getByAltText("袖口细节方案", { exact: true }),
    ).toHaveAttribute("src", "/api/design-assets/look-b/content");
    if (width < 768) {
      await expect(current).toBeHidden();
      await comparison
        .getByRole("button", { name: "当前图", exact: true })
        .click();
      await expect(current).toBeVisible();
      await comparison
        .getByRole("button", { name: "对比图", exact: true })
        .click();
    } else await expect(current).toBeVisible();
    await chooseValue(
      comparison.getByLabel("比较图片缩放", { exact: true }),
      "100",
    );
    await chooseValue(
      comparison.getByLabel("比较图片缩放", { exact: true }),
      "fit",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      other.getByRole("button", { name: "继续编辑对比图" }),
    ).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        other
          .getByAltText("袖口细节方案", { exact: true })
          .evaluate(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    if (process.env.IMAGE_COMPARISON_DEMO) await page.waitForTimeout(1500);
    await workspace.screenshot({
      path: `output/playwright/image-comparison/compare-${width}.png`,
    });
    await comparison
      .getByRole("button", { name: "返回图片", exact: true })
      .press("Escape");
    await expect(
      workspace.getByRole("button", { name: "版本与对比", exact: true }),
    ).toBeFocused();
    await openImageComparison(workspace);
    await other
      .getByRole("button", { name: "继续编辑对比图", exact: true })
      .click();
    const active = page
      .getByRole("dialog", { name: "图片工作区" })
      .filter({ visible: true });
    await expect(
      active
        .getByLabel("图片查看区域")
        .getByAltText("袖口细节方案", { exact: true }),
    ).toHaveAttribute("src", "/api/design-assets/look-b/content");
    if (process.env.IMAGE_COMPARISON_DEMO) await page.waitForTimeout(1000);
    await saveOrientation(active);
    await expect.poll(() => state.commands.length).toBe(1);
    await expect(
      active.getByText("任务已提交，完成后会展示新版本"),
    ).toBeVisible();
    if (process.env.IMAGE_COMPARISON_DEMO) await page.waitForTimeout(1200);
    expect(state.commands[0]).toMatchObject({
      type: "run_tool",
      inputs: [{ nodeId: "look-b", port: "source" }],
    });
    expect(state.restores).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("历史分页、版本对比、恢复后立即编辑正确结果", async ({ page }) => {
  const state = await prepareImageComparison(page);
  await state.open();
  const workspace = page
    .getByRole("dialog", { name: "图片工作区" })
    .filter({ visible: true });
  await history(workspace);
  await workspace.getByRole("button", { name: "加载更多版本" }).click();
  await expect(workspace.getByText("已显示完整资产链")).toBeVisible();
  const target = workspace
    .getByRole("listitem")
    .filter({ hasText: "局部重绘" });
  await target.getByRole("button", { name: "对比当前版本" }).click();
  const comparison = workspace.getByRole("region", {
    name: "对比历史版本",
    exact: true,
  });
  await expect(
    comparison
      .getByRole("region", { name: "对比图片" })
      .getByAltText(/^局部重绘 /u),
  ).toHaveAttribute("src", "/api/design-assets/historic/content");
  await workspace.screenshot({
    path: "output/playwright/image-comparison/history-comparison.png",
  });
  await comparison.getByRole("button", { name: "恢复为新版本" }).click();
  await expect(
    workspace
      .getByLabel("图片查看区域")
      .getByAltText("恢复的版本", { exact: true }),
  ).toHaveAttribute("src", "/api/design-assets/restored-1/content");
  await expect(
    workspace.getByText("恢复的版本", { exact: true }),
  ).toBeVisible();
  expect(state.created.size).toBe(1);
  expect(state.imports[0]).toMatchObject({
    sourceNodeId: "look-a",
    assetId: "restored-1",
    operation: "restore",
  });
  await saveOrientation(workspace);
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]).toMatchObject({
    inputs: [{ nodeId: "restored-1", port: "source" }],
  });
  expect(state.errors).toEqual([]);
});

for (const stage of ["restore", "import"] as const) {
  test(`${stage} 响应丢失后刷新重试只沿用原恢复`, async ({ page }) => {
    const state = await prepareImageComparison(page);
    await state.open();
    let workspace = page
      .getByRole("dialog", { name: "图片工作区" })
      .filter({ visible: true });
    await history(workspace);
    state.failNext(stage);
    await workspace
      .getByRole("button", { name: "恢复此版", exact: true })
      .click();
    await expect(
      workspace.getByRole("button", { name: "继续恢复版本" }),
    ).toBeEnabled();
    const first = { ...state.restores[0] };
    await page.reload();
    await state.open();
    workspace = page
      .getByRole("dialog", { name: "图片工作区" })
      .filter({ visible: true });
    await history(workspace);
    await expect(
      workspace.getByRole("button", { name: "继续恢复版本" }),
    ).toBeVisible();
    expect(state.restores).toHaveLength(1);
    await workspace.getByRole("button", { name: "继续恢复版本" }).click();
    await expect(
      workspace
        .getByLabel("图片查看区域")
        .getByAltText("恢复的版本", { exact: true }),
    ).toHaveAttribute("src", "/api/design-assets/restored-1/content");
    expect(state.restores[1]).toEqual(first);
    expect(state.created.size).toBe(1);
    if (stage === "import") expect(state.imports[1]).toEqual(state.imports[0]);
    expect(state.errors).toEqual([]);
  });
}

test("历史读取和比较图片失败均可重试，不提交恢复", async ({ page }) => {
  const state = await prepareImageComparison(page, 320, 640);
  await state.open();
  const workspace = page
    .getByRole("dialog", { name: "图片工作区" })
    .filter({ visible: true });
  state.setHistoryFailure(true);
  await history(workspace);
  await expect(
    workspace.getByRole("button", { name: "重新读取", exact: true }),
  ).toBeVisible();
  state.setHistoryFailure(false);
  await workspace
    .getByRole("button", { name: "重新读取", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "恢复此版", exact: true }),
  ).toBeEnabled();
  await workspace.getByRole("button", { name: /返回图片/u }).click();
  state.setImageFailure(true);
  await openImageComparison(workspace);
  const other = workspace.getByRole("region", {
    name: "对比图片",
    exact: true,
  });
  await expect(
    other.getByRole("button", { name: /重新加载|重试/ }),
  ).toBeVisible();
  state.setImageFailure(false);
  await other.getByRole("button", { name: /重新加载|重试/ }).click();
  await expect(
    other.getByAltText("袖口细节方案", { exact: true }),
  ).toBeVisible();
  expect(state.restores).toHaveLength(0);
});

test("多方案切换和往返编辑保留原图的方向草稿", async ({ page }) => {
  const state = await prepareImageComparison(page, 1440, 900, true);
  await state.open();
  const workspace = page
    .getByRole("dialog", { name: "图片工作区" })
    .filter({ visible: true });
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await workspace.getByLabel("旋转角度", { exact: true }).fill("17");
  await openImageComparison(workspace);
  const comparison = workspace.getByRole("region", {
    name: "比较方案",
    exact: true,
  });
  await chooseValue(
    comparison.getByLabel("选择对比图片", { exact: true }),
    "look-c",
  );
  await expect(
    comparison
      .getByRole("region", { name: "对比图片" })
      .getByAltText("第三张对照图", { exact: true }),
  ).toBeVisible();
  await chooseValue(
    comparison.getByLabel("选择对比图片", { exact: true }),
    "look-b",
  );
  await comparison.getByRole("button", { name: "继续编辑对比图" }).click();
  await workspace.getByRole("button", { name: "查看藏蓝通勤外套" }).click();
  await workspace.getByRole("button", { name: "继续编辑当前图" }).click();
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await expect(workspace.getByLabel("旋转角度", { exact: true })).toHaveValue(
    "17",
  );
  expect(state.commands).toHaveLength(0);
  expect(state.restores).toHaveLength(0);
});

test("320px 短屏历史对比保留恢复入口，Escape 回到原版本", async ({ page }) => {
  const state = await prepareImageComparison(page, 320, 640);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await state.open();
  const workspace = page
    .getByRole("dialog", { name: "图片工作区" })
    .filter({ visible: true });
  await history(workspace);
  await workspace.getByRole("button", { name: "对比当前版本" }).click();
  const comparison = workspace.getByRole("region", {
    name: "对比历史版本",
    exact: true,
  });
  await expect(
    comparison.getByRole("button", { name: "恢复为新版本" }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    workspace.getByRole("navigation", { name: "图片工具" }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await workspace.screenshot({
    path: "output/playwright/image-comparison/history-320-short.png",
  });
  await comparison
    .getByRole("button", { name: "返回版本历史" })
    .press("Escape");
  await expect(
    workspace.getByRole("button", { name: "对比当前版本" }),
  ).toBeFocused();
  await expect(
    workspace.getByRole("navigation", { name: "图片工具" }),
  ).toBeVisible();
  expect(state.restores).toHaveLength(0);
});
