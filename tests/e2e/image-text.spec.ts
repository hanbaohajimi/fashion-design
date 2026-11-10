import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import sharp from "../../apps/worker/node_modules/sharp";
import { imageTextRegions as regions, prepareImageText as prepare, openText, scanText } from "./image-text-fixture";

test.setTimeout(90_000);
test.beforeEach(async () => {
  await mkdir("output/playwright/image-text", { recursive: true });
});
const regionButton = (workspace: Locator) =>
  workspace.getByRole("button", { name: "文字区域 1：SENZHI", exact: true });
async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`文字编辑测试目标不可见：${locator}`);
  return box;
}

for (const width of [1440, 320]) {
  test(`${width}px 识别明确触发，核对与修改草稿在关闭和刷新后恢复`, async ({
    page,
  }) => {
    const state = await prepare(page, width);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openText(workspace);
    expect(state.scans()).toBe(0);
    await expect(
      workspace.getByRole("button", { name: "生成文字修改版本" }),
    ).toBeDisabled();
    await scanText(workspace);
    await workspace
      .getByLabel("替换为", { exact: true })
      .fill("SENZHI STUDIO\n2026 冬季");
    const rect = await bounds(regionButton(workspace));
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await state.open();
    await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue(
      "SENZHI STUDIO\n2026 冬季",
    );
    await page.reload();
    await state.open();
    await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue(
      "SENZHI STUDIO\n2026 冬季",
    );
    expect(await bounds(regionButton(workspace))).toEqual(rect);
    expect(state.scans()).toBe(1);
    expect(state.commands).toHaveLength(0);
    expect(state.masks).toHaveLength(0);
    await expect(
      workspace.getByRole("button", { name: "生成文字修改版本" }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await workspace.screenshot({
      path: `output/playwright/image-text/restored-${width}.png`,
    });
    expect(state.errors).toEqual([]);
  });
}

test("识别失败和没有文字允许手动补充，纠正原文不制造反向替换", async ({
  page,
}) => {
  const state = await prepare(page);
  state.failScan();
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openText(workspace);
  await workspace
    .getByRole("button", { name: "识别图片文字", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText("手动添加");
  state.emptyScan();
  await workspace
    .getByRole("button", { name: "识别图片文字", exact: true })
    .click();
  await expect(
    workspace.getByRole("status").filter({ hasText: "没有识别到" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "手动添加区域", exact: true })
    .click();
  await workspace.getByLabel("原文", { exact: true }).fill("原文");
  await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue(
    "原文",
  );
  await expect(
    workspace.getByRole("button", { name: "生成文字修改版本" }),
  ).toBeDisabled();
  await workspace.getByLabel("替换为", { exact: true }).fill("新文案");
  await expect(
    workspace.getByRole("button", { name: "生成文字修改版本" }),
  ).toBeEnabled();
  await workspace
    .getByRole("button", { name: "移除此区域", exact: true })
    .click();
  await expect(workspace.getByLabel("原文", { exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("选区键盘微调、单指针拖动、限位和取消均使用图片坐标，操作点保持44px", async ({
  page,
}) => {
  const state = await prepare(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openText(workspace);
  await scanText(workspace);
  const region = regionButton(workspace);
  const handle = workspace.getByRole("button", {
    name: "调整文字区域 1 大小",
    exact: true,
  });
  const badge = workspace.getByRole("button", {
    name: "移动文字区域 1",
    exact: true,
  });
  await expect(workspace.getByRole("button", { name: "移动文字区域 2", exact: true })).toHaveCount(0);
  const image = workspace.getByAltText("藏蓝通勤外套", { exact: true });
  const fitted = await bounds(image);
  await page.mouse.move(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fitted.width);
  await page.waitForTimeout(180);
  for (const control of [handle, badge]) {
    const box = await bounds(control);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
  const original = await bounds(region);
  await region.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const moved = await bounds(region);
  expect(moved.x).toBeGreaterThan(original.x);
  await handle.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const resized = await bounds(region);
  expect(resized.width).toBeGreaterThan(original.width);
  for (const cancel of ["Escape", "blur", "pointercancel"]) {
    const box = await bounds(handle);
    await handle.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          (element as HTMLElement).dataset.pointer = String(
            (event as PointerEvent).pointerId,
          );
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 });
    expect((await bounds(region)).width).toBeGreaterThan(resized.width);
    const imageDuringDrag = await bounds(image);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(160);
    expect(await bounds(image)).toEqual(imageDuringDrag);
    const width = (await bounds(region)).width;
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 99,
          clientX: 0,
          clientY: 0,
        }),
      );
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 99 }));
    });
    expect((await bounds(region)).width).toBe(width);
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await page.evaluate(
        (pointerId) =>
          window.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId }),
          ),
        Number(await handle.getAttribute("data-pointer")),
      );
    await page.mouse.up();
    expect(await bounds(region)).toEqual(resized);
  }
  const box = await bounds(region);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(-100, -100, { steps: 5 });
  await page.mouse.up();
  const source = await bounds(image);
  expect((await bounds(region)).x).toBeCloseTo(source.x, 0);
  expect((await bounds(region)).y).toBeCloseTo(source.y, 0);
  expect(state.errors).toEqual([]);
});

for (const width of [1440, 320]) {
  test(`${width}px 图片文字编辑短录屏`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      viewport: { width, height: 900 },
      hasTouch: width === 320,
      recordVideo: { dir: "output/playwright/image-text/recordings", size: { width, height: 900 } },
    });
    const page = await context.newPage();
    const video = page.video();
    try {
      const state = await prepare(page, width);
      await state.open();
      const workspace = page.getByRole("dialog", { name: "图片工作区" });
      await openText(workspace);
      await scanText(workspace);
      await workspace.getByLabel("替换为", { exact: true }).fill("森织 STUDIO\n冬季 2026");
      await page.waitForTimeout(650);
      await regionButton(workspace).focus();
      await page.keyboard.press("Shift+ArrowRight");
      await workspace.getByRole("button", { name: "调整文字区域 1 大小", exact: true }).focus();
      await page.keyboard.press("Shift+ArrowDown");
      await page.waitForTimeout(500);
      await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
      await state.open();
      await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue("森织 STUDIO\n冬季 2026");
      await workspace.getByLabel("替换为", { exact: true }).focus();
      await page.waitForTimeout(650);
      await workspace.screenshot({ path: `output/playwright/image-text/final-${width}.png` });
      expect(state.scans()).toBe(1);
      expect(state.commands).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally {
      await context.close();
      await video?.saveAs(`output/playwright/image-text/tour-${width}.webm`);
    }
  });
}

test("待确认锁住文字与范围，刷新重试复用同一蒙版和命令；只修改改变的区域", async ({
  page,
}) => {
  const state = await prepare(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openText(workspace);
  await scanText(workspace);
  await workspace
    .getByLabel("替换为", { exact: true })
    .fill("森织 STUDIO\n冬季 2026");
  state.holdNextSubmission();
  state.loseNextResponse();
  await workspace
    .getByRole("button", { name: "生成文字修改版本", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(1);
  await expect(workspace.getByLabel("替换为", { exact: true })).toBeDisabled();
  await expect(regionButton(workspace)).toBeDisabled();
  state.releaseSubmission();
  await expect(
    workspace.getByRole("alert").filter({ hasText: "暂未收到任务确认" }),
  ).toBeVisible();
  await expect(workspace.getByLabel("替换为", { exact: true })).toBeDisabled();
  await page.reload();
  await state.open();
  await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue(
    "森织 STUDIO\n冬季 2026",
  );
  await workspace
    .getByRole("button", { name: "重试原操作", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.masks).toHaveLength(1);
  expect(state.receipts.size).toBe(1);
  const command = state.commands[0];
  if (!command) throw new Error("文字修改命令未创建");
  expect(command.parameters).toMatchObject({
    taskType: "inpaint",
    mask: { fileAssetId: "edit-mask" },
    textEdits: [
      {
        original: "SENZHI",
        replacement: "森织 STUDIO\n冬季 2026",
        rect: regions[0].rect,
      },
    ],
  });
  const { data, info } = await sharp(state.masks[0])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([600, 800]);
  for (let y = 0; y < 800; y++)
    for (let x = 0; x < 600; x++) {
      const edited = x >= 60 && x < 444 && y >= 52 && y < 121;
      if (data[(y * 600 + x) * 4 + 3] !== (edited ? 0 : 255))
        throw new Error(`蒙版像素范围错误 ${x},${y}`);
    }
  await expect(
    workspace.getByRole("button", { name: "查看编辑结果", exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("删除文字及上传失败可恢复，失败前不创建任务", async ({ page }) => {
  const state = await prepare(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openText(workspace);
  await scanText(workspace);
  await workspace.getByLabel("替换为", { exact: true }).fill("");
  state.failNextUpload();
  await workspace
    .getByRole("button", { name: "生成文字修改版本", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toBeVisible();
  expect(state.commands).toHaveLength(0);
  await expect(workspace.getByLabel("替换为", { exact: true })).toBeEnabled();
  await expect(workspace.getByLabel("原文", { exact: true })).toHaveValue(
    "SENZHI",
  );
  await workspace
    .getByRole("button", { name: "生成文字修改版本", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(1);
  const command = state.commands[0];
  if (!command) throw new Error("删除文字命令未创建");
  expect(command.parameters.textEdits).toEqual([
    { original: "SENZHI", replacement: "", rect: regions[0].rect },
  ]);
  expect(state.errors).toEqual([]);
});

test.describe("短屏触控", () => {
  test.use({ hasTouch: true });
  test("双指缩放和单指平移保持文字范围、文案及固定操作点", async ({ page }) => {
    const state = await prepare(page, 320, 900);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openText(workspace);
    await scanText(workspace);
    await workspace.getByLabel("替换为", { exact: true }).fill("森织 STUDIO");
    const image = workspace.getByAltText("藏蓝通勤外套", { exact: true });
    const original = await bounds(image);
    const center = { x: original.x + original.width / 2, y: original.y + original.height * .65 };
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: center.x - 30, y: center.y, id: 0 }, { x: center.x + 30, y: center.y, id: 1 }],
      });
      for (let step = 1; step <= 5; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: center.x - 30 - step * 6, y: center.y, id: 0 }, { x: center.x + 30 + step * 6, y: center.y, id: 1 }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(original.width * 1.8);
      const zoomed = await bounds(image);
      const region = await bounds(regionButton(workspace));
      expect(region.width / zoomed.width).toBeCloseTo(regions[0].rect.width, 3);
      expect((region.x - zoomed.x) / zoomed.width).toBeCloseTo(regions[0].rect.x, 3);
      const viewer = await bounds(workspace.getByLabel("图片查看区域", { exact: true }));
      const point = { x: viewer.x + viewer.width / 2, y: viewer.y + viewer.height * .7 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + 24, y: point.y - 10, id: 0 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await bounds(image)).x).toBeCloseTo(zoomed.x + 24, 0);
      const panned = await bounds(image);
      const pannedRegion = await bounds(regionButton(workspace));
      expect((pannedRegion.x - panned.x) / panned.width).toBeCloseTo(regions[0].rect.x, 3);
      expect((pannedRegion.y - panned.y) / panned.height).toBeCloseTo(regions[0].rect.y, 3);
      for (const name of ["移动文字区域 1", "调整文字区域 1 大小"]) {
        const control = await bounds(workspace.getByRole("button", { name, exact: true }));
        expect(control.width).toBeCloseTo(44, 1);
        expect(control.height).toBeCloseTo(44, 1);
      }
      await expect(workspace.getByLabel("替换为", { exact: true })).toHaveValue("森织 STUDIO");
      expect(state.commands).toHaveLength(0);
      expect(state.masks).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally {
      await cdp.detach();
    }
  });

  test("320×568 选区可触控取消，文案可滚动编辑，主操作完整可见", async ({
    page,
  }) => {
    const state = await prepare(page, 320, 568);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openText(workspace);
    await scanText(workspace);
    const handle = workspace.getByRole("button", {
      name: "调整文字区域 1 大小",
      exact: true,
    });
    const original = await bounds(regionButton(workspace));
    const box = await bounds(handle);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 22, y: box.y + 22, id: 0 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + 32, y: box.y + 24, id: 0 }],
    });
    expect(
      (await bounds(regionButton(workspace))).width,
    ).toBeGreaterThan(original.width);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await cdp.detach();
    expect(await bounds(regionButton(workspace))).toEqual(original);
    const replacement = workspace.getByLabel("替换为", { exact: true });
    await replacement.fill("森织\n2026冬季系列");
    await expect(replacement).toBeInViewport({ ratio: 1 });
    await expect(
      workspace.getByRole("button", { name: "生成文字修改版本", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await replacement.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    await workspace.screenshot({
      path: "output/playwright/image-text/short-touch-320.png",
    });
    expect(state.errors).toEqual([]);
  });
});
