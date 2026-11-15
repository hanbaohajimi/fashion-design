import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { WorkflowMessageView } from "../../apps/web/src/modules/board/agent/agent-api";
import type { CreationActivity } from "../../packages/shared/src/canvas-creations";
import type { WorkflowExecutionProgress } from "../../packages/shared/src/workflow-execution-progress";
import { assistantResultsFixture } from "./assistant-results-fixture";
import { NOW } from "../visual/fixtures";

const output = "output/assistant-task-transcript";
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "设计助手", exact: true });
const activity = (
  event: CreationActivity["event"],
  runId = "run-1",
): CreationActivity => ({
  creationId: "image-1",
  runId,
  event,
  title: "雾蓝通勤",
  prompt: "生成一张雾蓝通勤风衣效果图",
  inputNodeIds: [],
  resultNodeId: null,
});
const progress = (
  status: WorkflowExecutionProgress["status"],
): WorkflowExecutionProgress => ({
  version: 1,
  executionId: "result-batch-1",
  toolNodeId: "generation-tool",
  title: "雾蓝通勤",
  operation: "image",
  status,
  updatedAt: NOW,
  counts: {
    total: 1,
    completed: status === "completed" ? 1 : 0,
    queued: status === "queued" ? 1 : 0,
    running: status === "running" ? 1 : 0,
    preparing: 0,
    failed: 0,
    canceled: 0,
  },
  cancelTaskIds: ["task-1"],
});
function rows(receipt: WorkflowMessageView) {
  const plain = {
    ...receipt,
    executionId: null,
    origin: "user" as const,
    context: {},
  };
  return {
    user: {
      ...plain,
      id: "request-1",
      role: "user" as const,
      content: "生成一张雾蓝通勤风衣效果图，保留完整服装轮廓，放到画布。",
    },
    dispatch: {
      ...plain,
      id: "dispatch-1",
      kind: "reply" as const,
      replyToId: "request-1",
      executionId: "result-batch-1",
      content: "正在创建图片生成任务",
      context: { executionProgress: progress("queued") },
    },
    submitted: {
      ...plain,
      id: "submitted-1",
      origin: "creative_activity" as const,
      executionId: "result-batch-1",
      content: "提交创作图片节点 1",
      context: {
        creationActivity: activity("submitted"),
        executionProgress: progress("queued"),
      },
    },
    saved: {
      ...plain,
      id: "manual-save",
      origin: "creative_activity" as const,
      content: "已保存文本「旧的手动说明」",
      context: {
        creationActivity: {
          ...activity("module_saved", "manual-1"),
          creationId: "text-1",
          title: "文本节点 1",
          resultNodeId: "text-result",
        },
      },
    },
    completed: {
      ...receipt,
      context: { ...receipt.context, creationActivity: activity("completed") },
    },
  };
}

for (const width of [1440, 390, 320])
  test(`${width}px一次生图原位更新为预览，保存记录不打断，查看画布保留草稿`, async ({
    page,
  }) => {
    const state = await assistantResultsFixture(page, { width, images: 1 });
    const messages = rows(state.messages[0]!);
    state.messages = [
      messages.user,
      messages.dispatch,
      messages.submitted,
      messages.saved,
    ];
    await state.open();
    await expect(panel(page).locator("[data-assistant-task]")).toHaveCount(1);
    await expect(
      panel(page).getByText("生成任务排队中…", { exact: true }),
    ).toBeVisible();
    await expect(
      panel(page).getByText(messages.saved.content, { exact: true }),
    ).toHaveCount(0);
    const taskElement = await panel(page)
      .locator("[data-assistant-task]")
      .elementHandle();
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await input.fill("下一步保留轮廓，稍后调整袖口");
    const inputElement = await input.elementHandle();
    state.messages = [...state.messages, messages.completed];
    await page.evaluate(() =>
      window.dispatchEvent(new Event("fashion-workflow:refresh")),
    );
    const task = panel(page).locator('[data-task-state="completed"]');
    await expect(task).toBeVisible();
    await expect(panel(page).locator("[data-assistant-task]")).toHaveCount(1);
    await expect(task.getByRole("img")).toHaveCount(1);
    await expect(task.locator("[data-task-summary]")).toHaveText(
      "已生成 1 张「雾蓝通勤」设计图。",
    );
    await expect(task.locator("[data-execution-progress]")).toHaveCount(0);
    expect(await taskElement?.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    expect(await inputElement?.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    const image = task.getByRole("img");
    const box = await image.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(240);
    expect(box!.height).toBeLessThanOrEqual(300);
    expect(
      await image.evaluate((element) => getComputedStyle(element).objectFit),
    ).toBe("contain");
    await mkdir(output, { recursive: true });
    await task.locator("[data-task-summary]").scrollIntoViewIfNeeded();
    await panel(page).screenshot({
      path: `${output}/result-${width}.png`,
      animations: "disabled",
    });
    expect(
      await panel(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await task.getByRole("button", { name: "查看画布", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "图片工作区", exact: true }),
    ).toHaveCount(0);
    if (width < 768) {
      await expect(panel(page)).toBeHidden();
      await page.getByRole("button", { name: "返回节点", exact: true }).click();
    }
    await expect(input).toHaveValue("下一步保留轮廓，稍后调整袖口");
    expect(state.sends).toEqual([]);
    expect(state.errors).toEqual([]);
  });

test("旧保存历史仍可查阅，刷新不恢复重复的提交和完成消息", async ({ page }) => {
  const state = await assistantResultsFixture(page, { images: 1 });
  const messages = rows(state.messages[0]!);
  state.messages = [
    messages.user,
    messages.dispatch,
    messages.submitted,
    messages.saved,
    messages.completed,
  ];
  await state.open();
  await panel(page)
    .getByRole("button", { name: "助手设置", exact: true })
    .click();
  await page.getByRole("button", { name: "画布操作记录", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "画布操作记录",
    exact: true,
  });
  await expect(
    history.getByText(messages.saved.content, { exact: true }),
  ).toBeVisible();
  await history.getByRole("button", { name: "关闭记录", exact: true }).click();
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator("[data-assistant-task]")).toHaveCount(1);
  await expect(panel(page).getByRole("img")).toHaveCount(1);
  await expect(
    panel(page).getByText(messages.saved.content, { exact: true }),
  ).toHaveCount(0);
  expect(state.messages).toHaveLength(5);
  expect(state.errors).toEqual([]);
});

test("同一目标的两次执行分别显示，迟到提交不会把完成状态退回等待", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page, { images: 1 });
  const messages = rows(state.messages[0]!);
  const second = {
    ...messages.completed,
    id: "completed-2",
    executionId: "result-batch-2",
    context: {
      creationActivity: activity("completed", "run-2"),
      executionResult: { ...state.result, executionId: "result-batch-2" },
    },
  };
  state.messages = [
    messages.user,
    messages.submitted,
    second,
    messages.completed,
  ];
  await state.open();
  await expect(panel(page).locator("[data-assistant-task]")).toHaveCount(2);
  state.messages = [
    ...state.messages,
    {
      ...messages.submitted,
      id: "late-submitted",
      updatedAt: new Date().toISOString(),
    },
  ];
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fashion-workflow:refresh")),
  );
  await expect(
    panel(page).locator('[data-task-state="completed"]'),
  ).toHaveCount(2);
  await expect(panel(page).getByRole("img")).toHaveCount(2);
  expect(state.errors).toEqual([]);
});

test("部分失败突出异常并保留图片，失败事件不会显示创作成功", async ({
  page,
}) => {
  const state = await assistantResultsFixture(page, {
    status: "partial_failed",
    images: 1,
  });
  const messages = rows(state.messages[0]!);
  state.messages = [messages.submitted, messages.completed];
  await state.open();
  await expect(
    panel(page).locator('[data-task-state="partial_failed"]'),
  ).toContainText("其余操作未完成");
  await expect(panel(page).getByRole("img")).toHaveCount(1);
  await expect(
    panel(page).getByRole("button", { name: "查看任务详情", exact: true }),
  ).toBeVisible();
  state.messages = [
    {
      ...messages.completed,
      context: {
        ...messages.completed.context,
        executionResult: { ...state.result, status: "failed", images: [] },
      },
      updatedAt: new Date().toISOString(),
    },
  ];
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('[data-task-state="failed"]')).toContainText(
    "这次生成未完成",
  );
  await expect(panel(page).getByRole("img")).toHaveCount(0);
  await expect(
    panel(page).getByText("创作已完成", { exact: true }),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("历史自动图片名显示为生成图，原资产和原始名称保留", async ({ page }) => {
  const state = await assistantResultsFixture(page, { images: 1 });
  state.result.images[0]!.title = "候选 A";
  state.messages[0]!.context!.executionResult = structuredClone(state.result);
  state.setGraph({
    ...state.getGraph(),
    nodes: state
      .getGraph()
      .nodes.map((node) =>
        node.id === "result-node-1" ? { ...node, title: "候选 A" } : node,
      ),
  });
  await state.open();
  await expect(
    panel(page).getByRole("button", {
      name: "查看大图：生成图 A",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "描述设计需求", exact: true }).fill("查看生成图 A，先不要修改。");
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  const sent = state.sends[0] as unknown as { canvasObservation: { objects: { nodeId: string | null; title: string }[] } };
  expect(sent.canvasObservation.objects.find(object => object.nodeId === "result-node-1")?.title).toBe("生成图 A");
  expect(state.result.images[0]!.title).toBe("候选 A");
  expect(
    state.getGraph().nodes.find((node) => node.id === "result-node-1")?.title,
  ).toBe("候选 A");
  expect(state.errors).toEqual([]);
});
