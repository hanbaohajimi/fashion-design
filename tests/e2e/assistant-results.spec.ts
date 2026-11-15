import { expect, test, type Page } from "@playwright/test";
import { assistantResultsFixture } from "./assistant-results-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { chooseValue, valueControl } from "./choice-control";
const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const gallery = (page: Page) =>
  page.getByRole("region", { name: "本次图片结果", exact: true });
const viewer = (page: Page) =>
  page.getByRole("dialog", { name: "生成结果预览", exact: true });
for (const width of [1440, 320])
  test(`${width}px聊天直接显示同次图片结果，比较与继续修改保持草稿`, async ({
    page,
  }) => {
    const state = await assistantResultsFixture(page, { width });
    await state.open();
    await expect(gallery(page).getByRole("img")).toHaveCount(2);
    await input(page).fill("保留原正文，只修正袖口");
    await gallery(page)
      .getByRole("button", { name: "比较本次结果", exact: true })
      .click();
    await expect(viewer(page)).toBeVisible();
    await expect(
      viewer(page).getByRole("region", { name: "比较方案", exact: true }),
    ).toBeVisible();
    await viewer(page)
      .getByRole("button", { name: "关闭结果预览", exact: true })
      .click();
    await expect(input(page)).toHaveValue("保留原正文，只修正袖口");
    await expect(viewer(page)).toBeHidden();
    await gallery(page).getByRole("button", { name: "更多图片操作：藏蓝通勤外套", exact: true }).click();
    await page
      .getByRole("button", { name: "继续修改：藏蓝通勤外套", exact: true })
      .click();
    await expect(
      page
        .getByLabel("正在讨论", { exact: true })
        .locator('[data-assistant-reference-id="result-node-1"]'),
    ).toBeVisible();
    expect(state.sends).toEqual([]);
    await page.getByRole("button", { name: "发送需求", exact: true }).click();
    await expect.poll(() => state.sends.length).toBe(1);
    expect(state.sends[0]?.referencedNodeIds).toEqual(["result-node-1"]);
    expect(state.errors).toEqual([]);
  });
test("点开结果进入正确图片工作区，关闭后保留聊天正文", async ({ page }) => {
  const state = await assistantResultsFixture(page);
  await state.open();
  await input(page).fill("先查看大图");
  await gallery(page)
    .getByRole("button", { name: "查看大图：袖口细节方案 2", exact: true })
    .click();
  const workspace = page.getByRole("dialog", {
    name: "图片工作区",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  await expect(
    workspace.locator('img[src="/api/design-assets/result-2/content"]'),
  ).toHaveCount(1);
  await workspace
    .getByRole("button", { name: "关闭图片工作区", exact: true })
    .click();
  await expect(input(page)).toHaveValue("先查看大图");
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("部分失败保留真实图片，取消无图片不伪造缩略图", async ({ page }) => {
  const state = await assistantResultsFixture(page, {
    status: "partial_failed",
  });
  await state.open();
  await expect(page.locator('[data-task-state="partial_failed"] [data-task-summary]')).toContainText("其余操作未完成");
  await expect(gallery(page).getByRole("img")).toHaveCount(2);
  state.messages = state.messages.map((message) => ({
    ...message,
    context: {
      executionResult: { ...state.result, status: "canceled", images: [] },
    },
    content: "本次执行已取消。",
    updatedAt: new Date().toISOString(),
  }));
  await page.reload();
  await expect(gallery(page)).toHaveCount(0);
  await expect(
    page.getByText("生成已停止。", { exact: true }),
  ).toBeVisible();
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("历史节点换成新图，旧回执仍预览原资产并提供生成文件入口", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page);
  await state.open();
  state.setGraph({
    ...state.getGraph(),
    revision: state.getGraph().revision + 1,
    nodes: state.getGraph().nodes.map((node) =>
      node.id === "result-node-1"
        ? {
            ...node,
            payload: {
              assetId: "replacement-image",
              imageUrl: "/visual-garment.svg",
            },
          }
        : node,
    ),
  });
  await page.reload();
  await expect(
    gallery(page).getByRole("button", {
      name: "继续修改：藏蓝通勤外套",
      exact: true,
    }),
  ).toHaveCount(0);
  await gallery(page)
    .getByRole("button", { name: "查看大图：藏蓝通勤外套", exact: true })
    .click();
  await expect(viewer(page)).toBeVisible();
  await expect(
    viewer(page).locator('img[src="/api/design-assets/result-1/content"]'),
  ).toBeVisible();
  await expect(
    viewer(page).getByRole("button", { name: "打开项目生成文件", exact: true }),
  ).toBeVisible();
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("查看历史结果不会混入其他执行，重复轮询不重复增加图片", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page);
  await state.open();
  const first = state.messages[0];
  if (!first) throw new Error("缺少结果回执");
  state.messages = [
    ...state.messages,
    {
      ...first,
      id: "second-receipt",
      executionId: "new-batch",
      context: {
        executionResult: {
          ...state.result,
          executionId: "new-batch",
          images: [
            {
              assetId: "new-result",
              nodeId: null,
              title: "后一次结果",
              width: 600,
              height: 800,
            },
          ],
        },
      },
    },
  ];
  await page.reload();
  await expect(gallery(page)).toHaveCount(2);
  await expect(
    page.locator(
      '[data-execution-results="result-batch-1"] [data-result-asset]',
    ),
  ).toHaveCount(2);
  await expect(
    page.locator('[data-execution-results="result-batch-1"]'),
  ).not.toContainText("后一次结果");
  await page.waitForTimeout(3500);
  await expect(gallery(page)).toHaveCount(2);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("切换会话关闭旧结果比较，原草稿与引用不串入新会话", async ({ page }) => {
  const state = await assistantResultsFixture(page);
  await page.route(
    `**/api/projects/${PROJECT}/agent-conversations?*`,
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "visual-chat",
              projectId: PROJECT,
              title: "原设计对话",
              mode: "workflow",
              createdAt: NOW,
              updatedAt: NOW,
            },
            {
              id: "other-chat",
              projectId: PROJECT,
              title: "另一对话",
              mode: "workflow",
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await state.open();
  await input(page).fill("原会话的修改要求");
  await gallery(page)
    .getByRole("button", { name: "比较本次结果", exact: true })
    .click();
  await viewer(page)
    .getByRole("button", { name: "关闭结果预览", exact: true })
    .click();
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await chooseValue(valueControl(page, "历史对话"), "other-chat");
  await expect(gallery(page)).toHaveCount(0);
  await expect(viewer(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("");
  await chooseValue(valueControl(page, "历史对话"), "visual-chat");
  await expect(gallery(page)).toHaveCount(1);
  await expect(input(page)).toHaveValue("原会话的修改要求");
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("320×400长名称结果和键盘比较可用，关闭返回原比较入口", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page, { width: 320 });
  state.messages = state.messages.map((message) => ({
    ...message,
    context: {
      executionResult: {
        ...state.result,
        images: state.result.images.map((image) => ({
          ...image,
          title: "秋冬通勤长款外套双层翻领与手工面料细节参考".repeat(3),
        })),
      },
    },
  }));
  await state.open();
  await page.setViewportSize({ width: 320, height: 400 });
  const compare = gallery(page).getByRole("button", {
    name: "比较本次结果",
    exact: true,
  });
  await compare.focus();
  await page.keyboard.press("Enter");
  await expect(viewer(page)).toBeVisible();
  await expect(
    viewer(page).getByRole("button", { name: "关闭结果预览", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await viewer(page)
    .getByRole("button", { name: "关闭结果预览", exact: true })
    .click();
  await expect(compare).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("缩略图加载失败能重试，不把失败显示成生成失败", async ({ page }) => {
  const state = await assistantResultsFixture(page);
  state.failThumbnails = true;
  await state.open();
  await expect(
    gallery(page).getByText("缩略图暂不可用", { exact: true }),
  ).toHaveCount(2);
  state.failThumbnails = false;
  await gallery(page)
    .getByRole("button", { name: "重试缩略图：藏蓝通勤外套", exact: true })
    .click();
  await expect(
    gallery(page).getByRole("img", { name: "藏蓝通勤外套", exact: true }),
  ).toBeVisible();
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("比较后选择对比图继续修改，焦点落在输入框且引用准确", async ({ page }) => {
  const state = await assistantResultsFixture(page);
  await state.open();
  await input(page).fill("只调整选中的袖口");
  await gallery(page)
    .getByRole("button", { name: "比较本次结果", exact: true })
    .click();
  await viewer(page)
    .getByRole("button", { name: "继续编辑对比图", exact: true })
    .click();
  await viewer(page)
    .getByRole("button", { name: "引用后继续修改", exact: true })
    .click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await expect(
    page
      .getByLabel("正在讨论", { exact: true })
      .locator('[data-assistant-reference-id="result-node-2"]'),
  ).toBeVisible();
  await expect(input(page)).toHaveValue("只调整选中的袖口");
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("320px长会话名不挤走四个操作，键盘仍能打开要求和设置", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page, { width: 320 });
  await page.route(
    `**/api/projects/${PROJECT}/agent-conversations?*`,
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "visual-chat",
              projectId: PROJECT,
              title: "秋冬通勤服装设计与面料细节要求".repeat(10),
              mode: "workflow",
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await state.open();
  for (const name of ["历史对话", "新建对话", "助手设置", "返回画布"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(43.9);
    expect(box?.height).toBeGreaterThanOrEqual(43.9);
  }
  const requirements = page.getByRole("button", {
    name: "设计要求",
    exact: true,
  });
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await requirements.focus();
  await requirements.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "设计要求与偏好", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "助手设置", exact: true })).toBeFocused();
  const settings = page.getByRole("button", { name: "助手设置", exact: true });
  await settings.focus();
  await settings.press("ArrowDown");
  await expect(
    page.getByRole("group", { name: "助手设置选项", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});
