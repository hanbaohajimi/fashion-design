import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  elementBox,
  hit,
  loadZhiya,
  openZhiya,
  prepareZhiya,
} from "./zhiya-fixture";

test.setTimeout(90_000);
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async () => {
  await mkdir("output/playwright/creative-start", { recursive: true });
});
test.afterEach(async ({ page }, testInfo) => {
  if (!process.env.CREATIVE_START_DEMO || testInfo.status !== "passed") return;
  const video = page.video();
  await page.close();
  await video?.saveAs(
    `output/playwright/creative-start/${testInfo.title.includes("光标引用") ? "reference-tour" : "start-tour"}-${testInfo.title.match(/\d+px/u)?.[0] ?? "capture"}.webm`,
  );
});

for (const width of [1440, 390, 320]) {
  test(`${width}px 空白白板起步复用同一聊天，不覆盖草稿或自动提交`, async ({
    page,
  }) => {
    const state = await prepareZhiya(page, {
      count: 0,
      realClock: true,
      viewport: { width, height: 900 },
    });
    await loadZhiya(page);
    const welcome = page.getByRole("region", { name: "开始创作", exact: true });
    await expect(
      welcome.getByRole("heading", { name: "从一个想法开始" }),
    ).toBeVisible();
    for (const name of ["描述设计想法", "上传参考图", "绘制草图"]) {
      const button = welcome.getByRole("button", { name });
      await expect(button).toBeInViewport({ ratio: 1 });
      expect((await elementBox(button)).height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/creative-start/empty-${width}.png`,
    });
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(1800);
    await welcome.getByRole("button", { name: "描述设计想法" }).click();
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("group", { name: "设计起步示例" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "先说说你想做的服装", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        page
          .getByLabel("设计对话", { exact: true })
          .evaluate((element) => element.scrollTop),
      )
      .toBe(0);
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(1800);
    await page.getByRole("button", { name: /梳理设计方向/ }).click();
    await expect(input).toHaveValue(/暂不生成图片/);
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(1800);
    await expect(
      page.getByRole("button", { name: /通勤外套方案/ }),
    ).toBeDisabled();
    await input.fill("保留这份尚未发送的中文设计草稿");
    await input.evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(2, 6),
    );
    const handle = await input.elementHandle();
    const close = page.getByRole("button", {
      name: "收起设计助手",
      exact: true,
    });
    if (width < 768) await expect(close).toHaveText("返回画布");
    await close.click();
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(1200);
    await welcome.getByRole("button", { name: "描述设计想法" }).click();
    expect(await handle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(input).toHaveValue("保留这份尚未发送的中文设计草稿");
    expect(
      await input.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([2, 6]);
    await input.fill("");
    await expect(
      page.getByRole("button", { name: /规划一个小系列/ }),
    ).toBeEnabled();
    await page.screenshot({
      path: `output/playwright/creative-start/assistant-${width}.png`,
    });
    if (width < 768) {
      const title = await elementBox(
        page.getByRole("heading", { name: "设计助手", exact: true }),
      );
      const navigation = await elementBox(
        page.getByRole("button", { name: "展开工作区目录", exact: true }),
      );
      expect(title.x).toBeGreaterThan(navigation.x + navigation.width);
    }
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("起步区上传与草图入口可用，退出后仍为原白板", async ({ page }) => {
  const state = await prepareZhiya(page, { count: 0, realClock: true });
  await loadZhiya(page);
  const welcome = page.getByRole("region", { name: "开始创作", exact: true });
  const chooser = page.waitForEvent("filechooser");
  await welcome
    .getByRole("button", { name: "上传参考图", exact: true })
    .click();
  expect((await chooser).isMultiple()).toBe(true);
  await welcome.getByRole("button", { name: "绘制草图", exact: true }).click();
  const sketch = page.getByRole("dialog", {
    name: "绘制廓形草图",
    exact: true,
  });
  await expect(sketch).toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开工作区目录", exact: true }),
  ).toBeHidden();
  await sketch.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(sketch).toBeHidden();
  await expect(welcome).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test.describe("触屏输入", () => {
  test.use({ hasTouch: true });
  test("320px 触屏起步不强制聚焦输入，短屏操作保持可达", async ({ page }) => {
    const state = await prepareZhiya(page, {
      count: 0,
      realClock: true,
      viewport: { width: 320, height: 568 },
    });
    await loadZhiya(page);
    await page.getByRole("button", { name: "描述设计想法" }).tap();
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();
    await expect(
      page.getByRole("button", { name: "收起设计助手", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: "output/playwright/creative-start/short-mobile.png",
    });
    expect(state.mutations).toEqual([]);
  });
  test("触屏点选引用恢复光标，退出聊天后浮层彻底关闭", async ({ page }) => {
    const state = await prepareZhiya(page, {
      count: 3,
      realClock: true,
      viewport: { width: 390, height: 844 },
    });
    await loadZhiya(page);
    await hit(page).tap({ position: { x: 48, y: 78 } });
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await input.tap();
    await input.fill("参考@通勤");
    const list = page.getByRole("listbox", {
      name: "引用画布节点",
      exact: true,
    });
    await list.getByRole("option", { name: /通勤外套 3 / }).tap();
    await expect(input).toHaveValue("参考@通勤外套 3 ");
    await expect(input).toBeFocused();
    await expect(list).toBeHidden();
    await input.fill("再看看@");
    await expect(list).toBeVisible();
    await page.getByRole("button", { name: "收起设计助手", exact: true }).tap();
    await expect(page.locator("[data-assistant-mention-popup]")).toHaveCount(0);
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});

test("只读空白白板说明当前状态，不提供创建或上传入口", async ({ page }) => {
  const state = await prepareZhiya(page, {
    count: 0,
    realClock: true,
    canEdit: false,
  });
  await loadZhiya(page);
  const welcome = page.getByRole("region", { name: "开始创作", exact: true });
  await expect(
    welcome.getByRole("heading", { name: "白板中还没有素材" }),
  ).toBeVisible();
  await expect(welcome.getByRole("button")).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

for (const width of [1440, 640, 320]) {
  test(`${width}px 光标引用可键盘选择、取消，保留正文与输入位置`, async ({
    page,
  }) => {
    const state = await prepareZhiya(page, {
      count: 20,
      realClock: true,
      viewport: { width, height: width === 640 ? 450 : 900 },
    });
    await loadZhiya(page);
    await openZhiya(page);
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await input.fill("参考@通勤，保留衣领。");
    await input.press("Home");
    for (let index = 0; index < 5; index++) await input.press("ArrowRight");
    const list = page.getByRole("listbox", {
      name: "引用画布节点",
      exact: true,
    });
    await expect(list).toBeVisible();
    await input.press("ArrowDown");
    const option = list.getByRole("option", { name: /通勤外套 2 / });
    await expect(option).toHaveAttribute("aria-selected", "true");
    await expect(option).toBeInViewport({ ratio: 1 });
    expect(
      await option.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
    const before = await elementBox(input);
    await page.screenshot({
      path: `output/playwright/creative-start/references-${width}.png`,
    });
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(2000);
    await input.press("Enter");
    await expect(input).toHaveValue("参考@通勤外套 2，保留衣领。");
    await expect(input).toBeFocused();
    await expect(list).toBeHidden();
    await expect(page.getByLabel("正在讨论", { exact: true })).toContainText(
      "通勤外套 2",
    );
    if (process.env.CREATIVE_START_DEMO) await page.waitForTimeout(1800);
    expect(
      await input.evaluate(
        (element: HTMLTextAreaElement) => element.selectionStart,
      ),
    ).toBe("参考@通勤外套 2".length);
    await input.fill("@");
    await expect(list).toBeVisible();
    const visible = await elementBox(input);
    await input.press("Escape");
    await expect(list).toBeHidden();
    await expect(input).toHaveValue("@");
    expect(Math.abs((await elementBox(input)).y - visible.y)).toBeLessThan(1);
    expect(before.width).toBe((await elementBox(input)).width);
    await input.fill("@没有这个名字");
    await input.press("Enter");
    await expect(page.getByText(/没有匹配的未引用对象/)).toBeVisible();
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}
