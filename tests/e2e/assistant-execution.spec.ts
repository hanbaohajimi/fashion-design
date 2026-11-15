import { expect, test, type Page } from "@playwright/test";
import type { WorkflowMessageView } from "../../apps/web/src/modules/board/agent/agent-api";
import { assistantExecutionFixture } from "./assistant-execution-fixture";
const status = (page: Page) =>
  page.getByRole("region", { name: "本次执行进度", exact: true });
const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
for (const width of [1440, 320])
  test(`${width}px真实排队与处理中数量变化，正文和输入实例保持`, async ({
    page,
  }) => {
    const state = await assistantExecutionFixture(page, { width });
    await state.open();
    await input(page).fill("稍后调整袖口");
    const element = await input(page).elementHandle();
    await page.getByText("查看过程", { exact: true }).click();
    await expect(page.locator("[data-assistant-task]")).toContainText("排队 2 项");
    state.progress.status = "running";
    state.progress.counts.queued = 1;
    state.progress.counts.running = 1;
    state.update();
    await expect(page.locator("[data-assistant-task]")).toContainText("处理中 1 项");
    await expect(input(page)).toHaveValue("稍后调整袖口");
    expect(await element?.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    expect(state.executionRequests).toEqual([]);
    expect(state.cancelRequests).toEqual([]);
    expect(state.errors).toEqual([]);
  });
test("停止先请求核对，终态读取后才显示取消，不提交新的执行", async ({
  page,
}) => {
  const state = await assistantExecutionFixture(page);
  await state.open();
  let release!: () => void;
  state.holdMessages = new Promise((resolve) => {
    release = resolve;
  });
  await status(page)
    .getByRole("button", { name: /^停止 \d+ 项图片任务$/, exact: true })
    .click();
  await expect(status(page)).toContainText("已请求停止，正在核对");
  expect(state.cancelRequests.sort()).toEqual(["task-1", "task-2"]);
  await expect(status(page)).toContainText("生成任务排队中");
  state.finish("canceled");
  state.holdMessages = null;
  release();
  await expect(page.locator('[data-task-state="canceled"] [data-task-summary]')).toContainText("生成已停止");
  await expect(
    status(page).getByRole("button", {
      name: /^停止 \d+ 项图片任务$/,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("部分停止失败明确提示，重新读取后保留剩余任务状态", async ({ page }) => {
  const state = await assistantExecutionFixture(page);
  await state.open();
  state.failCancel = true;
  await status(page)
    .getByRole("button", { name: /^停止 \d+ 项图片任务$/, exact: true })
    .click();
  await expect(status(page).getByRole("alert")).toContainText("尚未全部确认");
  await status(page)
    .getByRole("button", { name: "重新读取状态", exact: true })
    .click();
  await page.getByText("查看过程", { exact: true }).click();
  await expect(page.locator("[data-assistant-task]")).toContainText("已取消 1 项");
  await expect(page.locator("[data-assistant-task]")).toContainText("排队 1 项");
  expect(state.cancelRequests).toHaveLength(2);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("状态读取失败保留旧记录，不把断线显示成业务失败", async ({ page }) => {
  const state = await assistantExecutionFixture(page);
  await state.open();
  state.failMessages = true;
  await expect(
    page.getByText("执行状态暂不可用", { exact: false }),
  ).toBeVisible();
  await expect(status(page)).toContainText("生成任务排队中");
  await expect(status(page)).not.toContainText("执行失败");
  state.failMessages = false;
  state.finish("completed");
  await page.getByRole("button", { name: "重试同步", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(1);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("历史确认只显示固定内容和本次结果，忽略工具当前参数", async ({ page }) => {
  const state = await assistantExecutionFixture(page, { legacy: true });
  state.finish("completed", 2, false);
  await state.open();
  const card = page.getByRole("region", { name: "方案确认", exact: true });
  await card.getByText("查看已确认内容", { exact: true }).click();
  await expect(card).toContainText("保留立领与藏蓝色");
  await expect(card).not.toContainText("后来红色夹克");
  await expect(
    card.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: /重试生成|继续生成/ }),
  ).toHaveCount(0);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("确认后的版本变化保留旧记录，无核实关联不借用当前成功状态", async ({
  page,
}) => {
  const state = await assistantExecutionFixture(page, { legacy: true });
  state.binding.binding = "changed";
  state.update();
  await state.open();
  const card = page.getByRole("region", { name: "方案确认", exact: true });
  await expect(card).toContainText("已有后续修改");
  await expect(
    card.getByRole("button", { name: /重试生成|继续生成/ }),
  ).toHaveCount(0);
  const message = state.messages[0];
  if (!message?.proposal) throw new Error("缺少确认");
  state.messages[0] = {
    ...message,
    proposal: {
      ...message.proposal,
      execution: {
        version: 1,
        binding: "unrecorded",
        nodeVersionId: null,
        canExecute: false,
        progress: null,
        result: null,
      },
    },
  };
  await page.reload();
  await expect(card).toContainText("历史执行未核实");
  await expect(
    card.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(0);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("同一执行已有结果回执时旧确认只提供定位，不重复图片", async ({ page }) => {
  const state = await assistantExecutionFixture(page, { legacy: true });
  state.finish("completed", 2);
  await state.open();
  await expect(
    page.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "查看本次结果", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "本次图片结果", exact: true })
      .getByRole("img")
      .first(),
  ).toBeInViewport();
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("任务详情打开现有任务中心，只读记录不提供停止按钮", async ({ page }) => {
  const state = await assistantExecutionFixture(page, { canEdit: false });
  await state.open();
  await expect(
    status(page).getByRole("button", {
      name: /^停止 \d+ 项图片任务$/,
      exact: true,
    }),
  ).toHaveCount(0);
  await status(page).locator("summary").click();
  await status(page)
    .getByRole("button", { name: "查看任务详情", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "项目任务", exact: true }),
  ).toBeVisible();
  expect(state.cancelRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("损坏的旧结果摘要保留可读聊天，不虚构图片或重新执行", async ({ page }) => {
  const state = await assistantExecutionFixture(page);
  const message = state.messages[0];
  if (!message) throw new Error("缺少执行消息");
  state.messages.push({
    ...message,
    id: "damaged-old-result",
    origin: "execution_result",
    executionId: "old-execution",
    content: "这是旧执行的历史记录。",
    context: {
      executionResult: { version: 0, images: "damaged" },
    } as unknown as WorkflowMessageView["context"],
  });
  await state.open();
  await expect(page.getByText("这是旧执行的历史记录。", { exact: true })).toBeVisible();
  await expect(status(page)).toContainText("排队 2 项");
  await expect(
    page.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(0);
  await input(page).fill("继续保留我的设计草稿");
  await expect(input(page)).toHaveValue("继续保留我的设计草稿");
  expect(state.executionRequests).toEqual([]);
  expect(state.cancelRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});
