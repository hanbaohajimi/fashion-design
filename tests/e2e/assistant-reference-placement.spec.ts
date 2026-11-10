import { expect, test, type Page } from "@playwright/test";
import { openZhiya } from "./zhiya-fixture";
import {
  assistantImageUploadFixture,
  chatImageBytes,
} from "./assistant-image-upload-fixture";

const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const chips = (page: Page) =>
  page
    .getByLabel("正在讨论", { exact: true })
    .locator("[data-assistant-reference-id]");
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "参考图片预览", exact: true });
const shape = (page: Page) =>
  page.locator('.tl-shape[data-shape-id^="shape:reference-"]');
async function upload(page: Page) {
  await page.getByLabel("选择助手参考图片").setInputFiles({
    name: "外套参考.png",
    mimeType: "image/png",
    buffer: chatImageBytes,
  });
  await expect(chips(page)).toHaveCount(1);
  await expect(page.getByLabel("待加入的参考图片")).toHaveCount(0);
}
async function preview(page: Page) {
  await chips(page)
    .getByRole("button", { name: "外套参考.png", exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
}

for (const width of [1440, 320])
  test(`${width}px聊天参考先预览，明确放入画布只增加一份且不发送`, async ({
    page,
  }) => {
    const state = await assistantImageUploadFixture(page, { width });
    await state.open();
    await input(page).fill("保留这份草稿与面料细节");
    const element = await input(page).elementHandle();
    await input(page).evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(2, 5),
    );
    await upload(page);
    expect(state.imports[0]).toMatchObject({ placement: "reference" });
    expect(state.imports[0]).not.toHaveProperty("position");
    await expect(
      page.locator('.tl-shape[data-shape-id="shape:canvas-uploaded-1"]'),
    ).toHaveCount(0);
    await expect(shape(page)).toHaveCount(0);
    await preview(page);
    await expect(
      dialog(page).getByRole("img", { name: "外套参考.png", exact: true }),
    ).toBeVisible();
    await dialog(page)
      .getByRole("button", { name: "放入画布", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("button", { name: "在画布中查看", exact: true }),
    ).toBeVisible();
    expect(state.placements).toHaveLength(1);
    expect(state.sends).toEqual([]);
    await dialog(page)
      .getByRole("button", { name: "关闭预览", exact: true })
      .click();
    await expect(input(page)).toHaveValue("保留这份草稿与面料细节");
    expect(await element?.evaluate((value) => value.isConnected)).toBe(true);
    expect(
      await input(page).evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([2, 5]);
    await preview(page);
    await expect(
      dialog(page).getByRole("button", { name: "放入画布", exact: true }),
    ).toHaveCount(0);
    await dialog(page)
      .getByRole("button", { name: "在画布中查看", exact: true })
      .click();
    await expect(shape(page)).toHaveCount(1);
    await page.reload();
    await expect(shape(page)).toHaveCount(1);
    expect(state.placements).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });

test("回执丢失后刷新不自动放置，继续使用原编号和位置", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await upload(page);
  await preview(page);
  state.losePlacement = true;
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("尚未确认");
  const command = state.placements[0];
  await page.reload();
  await preview(page);
  await expect(
    dialog(page).getByRole("button", { name: "继续确认放置", exact: true }),
  ).toBeVisible();
  expect(state.placements).toHaveLength(1);
  await dialog(page)
    .getByRole("button", { name: "继续确认放置", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "继续确认放置", exact: true }),
  ).toHaveCount(0);
  expect(state.placements[1]).toEqual(command);
  await dialog(page)
    .getByRole("button", { name: "关闭预览", exact: true })
    .click();
  await expect(shape(page)).toHaveCount(1);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("明确拒绝可核对权限后重试，原草稿与引用继续保留", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("保留输入");
  await upload(page);
  await preview(page);
  state.failPlacementCode = 403;
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("暂时不可");
  state.failPlacementCode = 0;
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "在画布中查看", exact: true }),
  ).toBeVisible();
  expect(state.placements[1]?.mutationId).not.toBe(
    state.placements[0]?.mutationId,
  );
  await dialog(page)
    .getByRole("button", { name: "关闭预览", exact: true })
    .click();
  await expect(input(page)).toHaveValue("保留输入");
  await expect(chips(page)).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test("关闭预览中断迟到应用，重开继续核对同一操作", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await upload(page);
  await preview(page);
  let release!: () => void;
  state.holdPlacement = new Promise((resolve) => {
    release = resolve;
  });
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect.poll(() => state.placements.length).toBe(1);
  await dialog(page)
    .getByRole("button", { name: "关闭预览", exact: true })
    .click();
  release();
  state.holdPlacement = null;
  await preview(page);
  await expect(
    dialog(page).getByRole("button", { name: "继续确认放置", exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "继续确认放置", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "在画布中查看", exact: true }),
  ).toBeVisible();
  expect(state.placements[1]).toEqual(state.placements[0]);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("只读时仍可预览已有参考，没有放置操作", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await upload(page);
  state.setCanEdit(false);
  await page.reload();
  await preview(page);
  await expect(
    dialog(page).getByRole("img", { name: "外套参考.png", exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: "放入画布", exact: true }),
  ).toHaveCount(0);
  expect(state.placements).toEqual([]);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("预览图片读取失败可重试，参考仍能移除而不影响正文", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("还在讨论中");
  await upload(page);
  await page.route("**/api/files/*/thumbnail/1024", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await preview(page);
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await page.unroute("**/api/files/*/thumbnail/1024");
  await dialog(page).getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(
    dialog(page).getByRole("img", { name: "外套参考.png", exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "关闭预览", exact: true })
    .click();
  await chips(page)
    .getByRole("button", { name: /^移除引用/ })
    .click();
  await expect(chips(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("还在讨论中");
  expect(state.placements).toEqual([]);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("放置前画布保存失败时不发送命令，原引用与正文仍可继续", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("保留设计要求");
  await upload(page);
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await page.getByRole("button", { name: "画布对象", exact: true }).click();
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  state.failSave = true;
  await objects
    .getByRole("button", { name: "隐藏 通勤外套 1", exact: true })
    .click();
  await objects
    .getByRole("button", { name: "关闭画布对象", exact: true })
    .click();
  await openZhiya(page);
  await preview(page);
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "画布保存暂不可用",
  );
  expect(state.placements).toEqual([]);
  state.failSave = false;
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "在画布中查看", exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "关闭预览", exact: true })
    .click();
  await expect(input(page)).toHaveValue("保留设计要求");
  await expect(chips(page)).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test("320×400预览操作完整可见，键盘关闭后焦点回到原引用", async ({ page }) => {
  const state = await assistantImageUploadFixture(page, { width: 320 });
  await state.open();
  await upload(page);
  await page.setViewportSize({ width: 320, height: 400 });
  await preview(page);
  await expect(
    dialog(page).getByRole("button", { name: "放入画布", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog(page).getByRole("button", { name: "关闭预览", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog(page)
    .getByRole("button", { name: "原始大小", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    chips(page).getByRole("button", { name: "外套参考.png", exact: true }),
  ).toBeFocused();
  expect(state.placements).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("发送后可从回复的引用记录预览图片，继续放入画布", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("分析这份参考");
  await upload(page);
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  await expect(chips(page)).toHaveCount(0);
  await page.getByText("查看引用记录", { exact: true }).click();
  await page
    .getByRole("button", { name: /外套参考.png/ })
    .first()
    .click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "放入画布", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "在画布中查看", exact: true }),
  ).toBeVisible();
  expect(state.placements).toHaveLength(1);
  expect(state.sends).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
