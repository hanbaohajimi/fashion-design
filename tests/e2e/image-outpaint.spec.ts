import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { prepareImageEditing } from "./image-editing-fixture";

test.setTimeout(90_000);
test.beforeEach(async () => {
  await mkdir("output/playwright/image-outpaint", { recursive: true });
});

async function openOutpaint(workspace: Locator) {
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await workspace.getByRole("radio", { name: "AI 扩图", exact: true }).click();
}

for (const width of [1440, 320]) {
  test(`${width}px 扩图边界可操作且重开保留范围与要求`, async ({ page }) => {
    const state = await prepareImageEditing(page, width);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openOutpaint(workspace);
    await workspace.screenshot({
      path: `output/playwright/image-outpaint/initial-${width}.png`,
    });
    const handle = workspace.getByRole("button", { name: "拖动扩图边界" });
    const bounds = await handle.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(43.5);
    expect(bounds?.height).toBeGreaterThanOrEqual(43.5);
    await workspace.getByLabel("画布宽度", { exact: true }).fill("1024");
    await workspace.getByLabel("画布高度", { exact: true }).fill("1024");
    await workspace.getByLabel("原图左边距", { exact: true }).fill("128");
    await workspace.getByLabel("原图上边距", { exact: true }).fill("96");
    await workspace
      .getByLabel("扩图要求")
      .fill("向两侧延伸暖白背景，保留原图服装与光线。");
    await workspace
      .getByRole("button", { name: "收起工具", exact: true })
      .click();
    await workspace
      .getByRole("button", { name: "调整大小", exact: true })
      .click();
    await expect(
      workspace.getByLabel("原图左边距", { exact: true }),
    ).toHaveValue("128");
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await state.open();
    await expect(
      workspace.getByRole("radio", { name: "AI 扩图", exact: true }),
    ).toBeChecked();
    await expect(workspace.getByLabel("扩图要求")).toHaveValue(
      "向两侧延伸暖白背景，保留原图服装与光线。",
    );
    await page.reload();
    await state.open();
    await expect(workspace.getByLabel("画布宽度", { exact: true })).toHaveValue(
      "1024",
    );
    await expect(
      workspace.getByLabel("原图上边距", { exact: true }),
    ).toHaveValue("96");
    await expect(
      workspace.getByRole("button", { name: "生成扩图版本" }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.commands).toHaveLength(0);
    expect(state.errors).toEqual([]);
    await workspace.screenshot({
      path: `output/playwright/image-outpaint/restored-${width}.png`,
    });
  });
}

test("方向键可微调原图与边界，鼠标拖动保持画面锚点且 Escape 撤回", async ({
  page,
}) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openOutpaint(workspace);
  const width = workspace.getByLabel("画布宽度", { exact: true });
  const height = workspace.getByLabel("画布高度", { exact: true });
  const left = workspace.getByLabel("原图左边距", { exact: true });
  const handle = workspace.getByRole("button", { name: "拖动扩图边界" });
  const source = workspace.getByRole("button", { name: "移动扩图原图" });
  const initial = {
    width: Number(await width.inputValue()),
    height: Number(await height.inputValue()),
    left: Number(await left.inputValue()),
  };
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(width).toHaveValue(String(initial.width + 16));
  await expect(height).toHaveValue(String(initial.height + 64));
  await source.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(left).toHaveValue(String(initial.left + 10));
  const original = await source.boundingBox();
  const box = await handle.boundingBox();
  if (!box || !original) throw new Error("扩图控制尚未布局");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 44,
    box.y + box.height / 2 + 22,
    { steps: 8 },
  );
  expect(Number(await width.inputValue())).toBeGreaterThan(initial.width + 16);
  const moved = await source.boundingBox();
  expect(Math.abs((moved?.x ?? 0) - original.x)).toBeLessThan(1);
  expect(Math.abs((moved?.y ?? 0) - original.y)).toBeLessThan(1);
  const draggedWidth = await width.inputValue();
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
  await expect(width).toHaveValue(draggedWidth);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(width).toHaveValue(String(initial.width + 16));
  await expect(height).toHaveValue(String(initial.height + 64));
  await expect(workspace.getByRole("radio", { name: "AI 扩图" })).toBeChecked();
  const restored = await source.boundingBox();
  expect(Math.abs((restored?.x ?? 0) - original.x)).toBeLessThan(1);
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("原图拖动限位，失焦、指针取消与丢失捕获撤回且后续可以继续拖动", async ({
  page,
}) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openOutpaint(workspace);
  const source = workspace.getByRole("button", { name: "移动扩图原图" });
  const left = workspace.getByLabel("原图左边距", { exact: true });
  const initial = await left.inputValue();
  for (const cancel of ["blur", "pointercancel", "lostpointercapture"]) {
    const box = await source.boundingBox();
    if (!box) throw new Error("原图尚未布局");
    await source.evaluate((element) =>
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
    await page.mouse.move(box.x - 50, box.y + box.height / 2, { steps: 5 });
    await expect(left).toHaveValue("0");
    const pointerId = Number(await source.getAttribute("data-pointer"));
    if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (cancel === "pointercancel")
      await page.evaluate(
        (id) =>
          window.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId: id }),
          ),
        pointerId,
      );
    else await source.dispatchEvent("lostpointercapture", { pointerId });
    await page.mouse.up();
    await expect(left).toHaveValue(initial);
  }
  await source.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(left).toHaveValue(String(Number(initial) - 1));
  expect(state.errors).toEqual([]);
});

test("扩图提交锁定范围，刷新后继续同一份任务且保留输入", async ({ page }) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openOutpaint(workspace);
  const prompt = "向四周补全白色摄影背景";
  await workspace.getByLabel("扩图要求").fill(prompt);
  const frame = Object.fromEntries(
    await Promise.all(
      ([
        ["width", "画布宽度"],
        ["height", "画布高度"],
        ["left", "原图左边距"],
        ["top", "原图上边距"],
      ] as const).map(async ([key, label]) => [
        key,
        Number(
          await workspace.getByLabel(label, { exact: true }).inputValue(),
        ),
      ]),
    ),
  );
  state.holdNextSubmission();
  state.loseNextResponse();
  await workspace.getByRole("button", { name: "生成扩图版本" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  await expect(
    workspace.getByRole("button", { name: "拖动扩图边界" }),
  ).toBeDisabled();
  await expect(
    workspace.getByRole("button", { name: "移动扩图原图" }),
  ).toBeDisabled();
  await expect(workspace.getByLabel("扩图要求")).toBeDisabled();
  expect(state.commands[0]?.parameters).toMatchObject({
    intent: "outpaint",
    outpaint: frame,
    prompt,
  });
  state.releaseSubmission();
  await expect(workspace.getByRole("alert")).toContainText("暂未收到任务确认");
  await page.reload();
  await state.open();
  await expect(
    workspace.getByRole("button", { name: "重试原操作" }),
  ).toBeVisible();
  await expect(workspace.getByLabel("扩图要求")).toHaveValue(prompt);
  await expect(
    workspace.getByLabel("画布宽度", { exact: true }),
  ).toBeDisabled();
  expect(state.commands).toHaveLength(1);
  await workspace.getByRole("button", { name: "重试原操作" }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.receipts.size).toBe(1);
  await expect(
    workspace.getByRole("button", { name: "查看编辑结果", exact: true }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await expect(workspace.getByLabel("扩图要求")).toHaveValue(prompt);
  await expect(
    page.getByText("修改已暂存于本次工作区，尚未保存。", { exact: true }),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("数字输入按原图边界对齐，过小范围不会发出生成请求", async ({ page }) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openOutpaint(workspace);
  await workspace.getByLabel("原图左边距", { exact: true }).fill("0");
  await workspace.getByLabel("原图上边距", { exact: true }).fill("0");
  const width = workspace.getByLabel("画布宽度", { exact: true });
  const height = workspace.getByLabel("画布高度", { exact: true });
  await width.fill("600");
  await height.fill("800");
  await height.press("Enter");
  await expect(width).toHaveValue("608");
  await expect(workspace.getByRole("status")).toContainText("画布太小");
  await expect(
    workspace.getByRole("button", { name: "生成扩图版本" }),
  ).toBeDisabled();
  await width.fill("");
  await width.press("Escape");
  await expect(width).toHaveValue("608");
  await workspace.getByRole("button", { name: "四周留白" }).click();
  await expect(
    workspace.getByRole("button", { name: "生成扩图版本" }),
  ).toBeEnabled();
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("输入尺寸后直接拖动不会覆盖刚输入的范围", async ({ page }) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openOutpaint(workspace);
  const width = workspace.getByLabel("画布宽度", { exact: true });
  await width.fill("1290");
  const handle = workspace.getByRole("button", { name: "拖动扩图边界" });
  const box = await handle.boundingBox();
  if (!box) throw new Error("扩图控制不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await width.inputValue())).toBeGreaterThanOrEqual(1296);
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test.describe("短屏触控", () => {
  test.use({ hasTouch: true });
  test("320×568 的参数可滚动编辑，触控拖动可撤回，生成入口始终可见", async ({
    page,
  }) => {
    const state = await prepareImageEditing(page, 320, 568);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await openOutpaint(workspace);
    const handle = workspace.getByRole("button", { name: "拖动扩图边界" });
    const width = workspace.getByLabel("画布宽度", { exact: true });
    const initial = await width.inputValue();
    const box = await handle.boundingBox();
    if (!box) throw new Error("扩图边界不可见");
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 0 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x + 12, y: point.y, id: 0 }],
    });
    expect(Number(await width.inputValue())).toBeGreaterThan(Number(initial));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(width).toHaveValue(initial);
    await cdp.detach();
    await width.fill("1024");
    await width.press("Enter");
    await workspace.getByLabel("扩图要求").fill("延伸淡灰背景，保持原图主体");
    await workspace.screenshot({
      path: "output/playwright/image-outpaint/short-touch-320.png",
    });
    await expect(workspace.getByLabel("扩图要求")).toBeInViewport({ ratio: 1 });
    await expect(
      workspace.getByRole("button", { name: "生成扩图版本" }),
    ).toBeInViewport({ ratio: 1 });
    await workspace.screenshot({
      path: "output/playwright/image-outpaint/short-touch-320.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.commands).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
});

test("裁剪复用的拖动在取消后恢复原范围，操作点保持固定大小", async ({
  page,
}) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await workspace.getByRole("radio", { name: "裁剪", exact: true }).click();
  const width = workspace.getByLabel("裁剪宽度", { exact: true });
  const handle = workspace.getByRole("button", { name: "调整裁剪区域" });
  const box = await handle.boundingBox();
  if (!box) throw new Error("裁剪边界不可见");
  expect(box.width).toBeGreaterThanOrEqual(43.5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y - 60, { steps: 5 });
  expect(Number(await width.inputValue())).toBeLessThan(600);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(width).toHaveValue("600");
  await expect(
    workspace.getByRole("radio", { name: "裁剪", exact: true }),
  ).toBeChecked();
  expect(state.errors).toEqual([]);
});

for (const width of [1440, 320]) {
  test(`${width}px 扩图操作短录屏`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      viewport: { width, height: 900 },
      recordVideo: {
        dir: "output/playwright/image-outpaint/recordings",
        size: { width, height: 900 },
      },
    });
    const page = await context.newPage();
    const video = page.video();
    try {
      const state = await prepareImageEditing(page, width);
      await state.open();
      const workspace = page.getByRole("dialog", { name: "图片工作区" });
      await openOutpaint(workspace);
      const source = workspace.getByRole("button", { name: "移动扩图原图" });
      await source.focus();
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("Shift+ArrowDown");
      const handle = workspace.getByRole("button", { name: "拖动扩图边界" });
      await handle.focus();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(160);
      }
      await workspace.getByRole("button", { name: "原图居中" }).click();
      await workspace
        .getByLabel("扩图要求")
        .fill("延伸暖白摄影背景，保留服装细节与原图光线。");
      await page.waitForTimeout(700);
      await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
      await state.open();
      await expect(workspace.getByLabel("扩图要求")).toHaveValue(
        "延伸暖白摄影背景，保留服装细节与原图光线。",
      );
      await workspace.screenshot({
        path: `output/playwright/image-outpaint/final-${width}.png`,
      });
      await page.waitForTimeout(700);
      expect(state.commands).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally {
      await context.close();
      await video?.saveAs(
        `output/playwright/image-outpaint/tour-${width}.webm`,
      );
    }
  });
}
