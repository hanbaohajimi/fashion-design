import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { elementBox } from "./zhiya-fixture";

test.setTimeout(90_000);
test.use({
  video: process.env.IMAGE_ORIENTATION_DEMO
    ? { mode: "on", size: { width: 1440, height: 900 } }
    : "off",
});
test.beforeEach(async () => {
  await mkdir("output/playwright/image-orientation", { recursive: true });
});
test.afterEach(async ({ page }, info) => {
  if (!process.env.IMAGE_ORIENTATION_DEMO || info.status !== "passed") return;
  const video = page.video();
  await page.close();
  await video?.saveAs(
    `output/playwright/image-orientation/tour-${info.title.match(/\d+px/u)?.[0] ?? "capture"}.webm`,
  );
});
const orientation = (workspace: Locator) =>
  workspace.locator("[data-orientation]");

for (const width of [1440, 390, 320]) {
  test(`${width}px 图片旋转、镜像、原图比较与真实新图片`, async ({ page }) => {
    const state = await prepareImageOrientation(page, width);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await workspace
      .getByRole("button", { name: "旋转与翻转", exact: true })
      .click();
    const panel = workspace.getByRole("complementary", {
      name: "图片工具参数",
    });
    await expect(
      panel.getByRole("button", { name: "保存为新版本" }),
    ).toBeDisabled();
    if (process.env.IMAGE_ORIENTATION_DEMO) await page.waitForTimeout(1000);
    await panel.getByRole("button", { name: "向右旋转 90 度" }).click();
    await expect(
      panel.getByText("800 × 600 px", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "水平翻转" }).click();
    await expect(orientation(workspace)).toHaveAttribute(
      "data-orientation",
      JSON.stringify({ rotate: 90, flipHorizontal: true, flipVertical: false }),
    );
    if (process.env.IMAGE_ORIENTATION_DEMO) await page.waitForTimeout(1200);
    await panel.getByRole("button", { name: "查看原图" }).click();
    await expect(
      workspace.locator('[data-image-preview="原图"]'),
    ).toBeVisible();
    await expect(panel.getByLabel("旋转角度", { exact: true })).toHaveValue(
      "90",
    );
    await panel.getByRole("button", { name: "返回预览" }).click();
    await panel.getByRole("button", { name: "复位", exact: true }).click();
    await expect(panel.getByLabel("旋转角度", { exact: true })).toHaveValue(
      "0",
    );
    await expect(
      panel.getByRole("button", { name: "水平翻转" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(state.commands).toHaveLength(0);
    await panel.getByLabel("旋转角度", { exact: true }).fill("17");
    await expect(
      panel.getByText("808 × 940 px", { exact: true }),
    ).toBeVisible();
    await expect(
      workspace.locator('[data-image-preview="调整预览"]'),
    ).toBeInViewport({ ratio: 1 });
    await panel
      .getByRole("group", { name: "方向调整参数" })
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await workspace.screenshot({
      path: `output/playwright/image-orientation/preview-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await elementBox(panel.getByRole("button", { name: "向右旋转 90 度" })))
        .height,
    ).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    if (process.env.IMAGE_ORIENTATION_DEMO) await page.waitForTimeout(1800);
    await panel.getByRole("button", { name: "保存为新版本" }).click();
    await expect.poll(() => state.commands.length).toBe(1);
    await expect(
      workspace.getByRole("status").filter({ hasText: "任务已提交" }),
    ).toBeVisible();
    expect(state.commands[0]?.parameters).toMatchObject({
      rotate: 17,
      flipHorizontal: false,
      flipVertical: false,
      width: 808,
      height: 940,
    });
    expect(state.results.size).toBe(1);
    if (width < 768) {
      await workspace
        .getByRole("button", { name: "导出", exact: true })
        .click();
      await expect(
        workspace.getByRole("button", { name: "下载图片", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        workspace.getByRole("button", { name: "分享链接", exact: true }),
      ).toBeVisible();
      await expect(
        workspace.getByRole("link", { name: "保存为款式", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(
        workspace.getByRole("button", { name: "导出", exact: true }),
      ).toBeFocused();
    }
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await page
      .getByRole("button", { name: "查看新方案 ↗", exact: true })
      .click();
    await expect(
      workspace.getByAltText("外套调整 1", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        workspace
          .getByAltText("外套调整 1", { exact: true })
          .evaluate((image) => [
            (image as HTMLImageElement).naturalWidth,
            (image as HTMLImageElement).naturalHeight,
          ]),
      )
      .toEqual([808, 940]);
    await workspace.screenshot({
      path: `output/playwright/image-orientation/result-${width}.png`,
    });
    expect(state.errors).toEqual([]);
  });
}

test("关闭与重新进入保留方向草稿，复位后不再恢复", async ({ page }) => {
  const state = await prepareImageOrientation(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await workspace.getByLabel("旋转角度", { exact: true }).fill("-12.5");
  await workspace.getByRole("button", { name: "垂直翻转" }).click();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await state.open();
  await expect(workspace.getByLabel("旋转角度", { exact: true })).toHaveValue(
    "-12.5",
  );
  await expect(
    workspace.getByRole("button", { name: "垂直翻转" }),
  ).toHaveAttribute("aria-pressed", "true");
  await workspace.getByRole("button", { name: "复位", exact: true }).click();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await state.open();
  await expect(workspace.getByLabel("旋转角度", { exact: true })).toHaveValue(
    "0",
  );
  expect(state.commands).toHaveLength(0);
});

test("未确认的提交可用同一操作重试，恢复期间禁止再次创建版本", async ({
  page,
}) => {
  const state = await prepareImageOrientation(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await workspace.getByRole("button", { name: "向左旋转 90 度" }).click();
  state.failNextSubmission();
  await workspace.getByRole("button", { name: "保存为新版本" }).click();
  await expect(
    workspace.getByRole("button", { name: "重试原操作", exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "保存为新版本" }),
  ).toBeDisabled();
  await expect(
    workspace.getByRole("button", { name: "水平翻转" }),
  ).toBeDisabled();
  await workspace
    .getByRole("button", { name: "重试原操作", exact: true })
    .click();
  await expect.poll(() => state.results.size).toBe(1);
  expect(state.commands).toHaveLength(2);
  expect(state.commands[0]?.mutationId).toBe(state.commands[1]?.mutationId);
  expect(state.commands[1]?.parameters).toMatchObject({
    rotate: -90,
    width: 800,
    height: 600,
  });
});

test("减弱动态、键盘和短屏仍能预览、复位与保存", async ({ page }) => {
  const state = await prepareImageOrientation(page, 320, 568);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  await workspace.getByLabel("旋转角度", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(workspace.getByLabel("旋转角度", { exact: true })).toHaveValue(
    "0.1",
  );
  await page.keyboard.press("Control+a");
  await workspace
    .getByLabel("旋转角度", { exact: true })
    .pressSequentially("-12.5");
  await expect(workspace.getByLabel("旋转角度", { exact: true })).toHaveValue(
    "-12.5",
  );
  await workspace.getByRole("button", { name: "水平翻转" }).focus();
  await page.keyboard.press("Space");
  await expect(
    workspace.getByRole("button", { name: "水平翻转" }),
  ).toHaveAttribute("aria-pressed", "true");
  await workspace
    .getByRole("button", { name: "保存为新版本" })
    .scrollIntoViewIfNeeded();
  await expect(
    workspace.getByRole("button", { name: "保存为新版本" }),
  ).toBeInViewport({ ratio: 1 });
  await workspace.screenshot({
    path: "output/playwright/image-orientation/short-mobile.png",
  });
  expect(state.commands).toHaveLength(0);
});
