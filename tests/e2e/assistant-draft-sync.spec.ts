import { expect, test, type Page } from "@playwright/test";
import {
  emptyCanvasCreationDraft,
  type CanvasCreation,
  type UpdateCanvasCreationInput,
} from "../../packages/shared/src/canvas-creations";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

test.setTimeout(60_000);
const targetId = "00000000-0000-4000-a000-000000000901";
async function setup(page: Page, width = 1440) {
  const base = await prepareZhiya(page, {
    realClock: true,
    count: 2,
    viewport: { width, height: 900 },
  });
  const state = {
    item: {
      id: targetId,
      projectId: PROJECT,
      title: "当前创作节点",
      module: "image",
      revision: 0,
      draft: {
        ...emptyCanvasCreationDraft(),
        prompt: "旧要求",
        inputs: [{ id: "ref-one", nodeId: "material-0", assetId: "look-0" }],
      },
      position: { x: 0, y: 0 },
      currentResult: null,
      currentResultNodeId: null,
      runs: [],
      resource: null,
      removed: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as CanvasCreation,
    updates: [] as UpdateCanvasCreationInput[],
    events: [] as string[],
    messages: [] as {
      input: Record<string, unknown>;
      draft: CanvasCreation["draft"];
    }[],
    runs: 0,
    loseResponse: false,
    conflict: false,
    gate: null as Promise<void> | null,
  };
  const receipts = new Map<string, CanvasCreation>();
  await page.route(
    `**/api/projects/${PROJECT}/canvas/creations**`,
    async (route) => {
      const request = route.request();
      if (request.method() === "GET")
        return route.fulfill({ json: { items: [state.item], canEdit: true } });
      if (request.url().endsWith("/runs")) {
        state.runs++;
        return route.fulfill({ status: 500, json: { message: "不应生成" } });
      }
      if (request.method() !== "PATCH") throw new Error("同步草稿不应创建节点");
      const input = request.postDataJSON() as UpdateCanvasCreationInput;
      state.updates.push(input);
      state.events.push("saving");
      if (state.gate) await state.gate;
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: { message: "创作要求已在其他窗口更新" },
        });
      let saved = receipts.get(input.mutationId);
      if (!saved) {
        if (input.expectedRevision !== state.item.revision)
          return route.fulfill({ status: 409, json: { message: "版本冲突" } });
        saved = {
          ...state.item,
          draft: input.draft ?? state.item.draft,
          revision: state.item.revision + 1,
        };
        state.item = saved;
        receipts.set(input.mutationId, saved);
      }
      state.events.push("saved");
      if (state.loseResponse) {
        state.loseResponse = false;
        return route.fulfill({
          status: 503,
          json: { message: "保存回执暂未确认" },
        });
      }
      return route.fulfill({ json: saved });
    },
  );
  const messages: unknown[] = [];
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) => route.fulfill({ json: { items: messages, nextCursor: null } }),
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/workflow-messages",
    (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      state.events.push("chat");
      state.messages.push({ input, draft: structuredClone(state.item.draft) });
      const userMessage = {
        id: `user-${state.messages.length}`,
        conversationId: "visual-chat",
        role: "user",
        status: "completed",
        content: input.content,
        clientRequestId: input.clientRequestId,
        context: input,
        createdAt: NOW,
        updatedAt: NOW,
      };
      const assistantMessage = {
        id: `assistant-${state.messages.length}`,
        conversationId: "visual-chat",
        role: "assistant",
        status: "completed",
        content: "已读取当前要求和引用，尚未生成。",
        replyToId: userMessage.id,
        context: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      messages.push(userMessage, assistantMessage);
      return route.fulfill({ json: { userMessage, assistantMessage } });
    },
  );
  await loadZhiya(page);
  await page.getByRole("button", { name: "描述画面", exact: true }).click();
  const composer = page.getByRole("region", { name: "图片创作框" });
  await expect(composer).toBeVisible();
  const field = composer.getByRole("textbox", { name: "本次创作要求" });
  await field.fill("绿色短夹克，保留立领");
  await composer.getByRole("button", { name: "画布参考", exact: true }).click();
  await composer.getByRole("option", { name: /通勤外套 2/ }).click();
  await expect(composer.locator("[data-creation-reference]")).toHaveCount(2);
  expect(state.updates).toHaveLength(0);
  if (width < 700)
    await page.getByRole("button", { name: "项目助手", exact: true }).click();
  else await openZhiya(page);
  const chat = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await chat.fill("先检查当前节点的要求与引用，不要生成");
  return {
    ...base,
    state,
    composer,
    field,
    chat,
    send: page.getByRole("button", { name: "发送需求", exact: true }),
  };
}

for (const width of [1440, 390])
  test(`${width}px发送前保存当前要求和引用，聊天只读取且不会生成`, async ({
    page,
  }) => {
    const view = await setup(page, width);
    await view.send.click();
    await expect.poll(() => view.state.messages.length).toBe(1);
    expect(view.state.events).toEqual(["saving", "saved", "chat"]);
    expect(view.state.messages[0]?.input).toMatchObject({
      focusCreationId: targetId,
      focusCreationRevision: 1,
      referencedNodeIds: [],
    });
    expect(view.state.messages[0]?.draft).toMatchObject({
      prompt: "绿色短夹克，保留立领",
      inputs: [{ nodeId: "material-0" }, { nodeId: "material-1" }],
    });
    await page.screenshot({
      path: `output/assistant-context-sync/synced-${width}.png`,
    });
    expect(view.state.runs).toBe(0);
    expect(view.errors).toEqual([]);
  });

test("保存回执丢失时保留两个草稿，重试复用保存编号后再发送", async ({
  page,
}) => {
  const view = await setup(page);
  view.state.loseResponse = true;
  await view.send.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "保存回执暂未确认" }),
  ).toBeVisible();
  expect(view.state.messages).toHaveLength(0);
  await expect(view.chat).toHaveValue("先检查当前节点的要求与引用，不要生成");
  await expect(view.field).toHaveValue("绿色短夹克，保留立领");
  await view.send.click();
  await expect.poll(() => view.state.messages.length).toBe(1);
  expect(view.state.updates).toHaveLength(2);
  expect(view.state.updates[1]?.mutationId).toBe(
    view.state.updates[0]?.mutationId,
  );
  expect(view.state.item.revision).toBe(1);
  expect(view.state.runs).toBe(0);
});

test("保存期间的后续输入保留，下一次发送才同步新文字", async ({ page }) => {
  const view = await setup(page);
  let release = () => {};
  view.state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await view.send.click();
  await expect.poll(() => view.state.updates.length).toBe(1);
  await view.field.fill("保存期间补充的新要求");
  release();
  view.state.gate = null;
  await expect.poll(() => view.state.messages.length).toBe(1);
  expect(view.state.messages[0]?.draft.prompt).toBe("绿色短夹克，保留立领");
  await expect(view.field).toHaveValue("保存期间补充的新要求");
  await view.chat.fill("再读取最新要求，不要生成");
  await view.send.click();
  await expect.poll(() => view.state.messages.length).toBe(2);
  expect(view.state.messages[1]?.draft.prompt).toBe("保存期间补充的新要求");
  expect(view.state.runs).toBe(0);
});

test("服务端版本冲突阻止发送且保留要求和引用", async ({ page }) => {
  const view = await setup(page);
  view.state.conflict = true;
  await view.send.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "其他窗口更新" }),
  ).toBeVisible();
  expect(view.state.messages).toHaveLength(0);
  expect(view.state.runs).toBe(0);
  await expect(view.field).toHaveValue("绿色短夹克，保留立领");
  await expect(view.composer.locator("[data-creation-reference]")).toHaveCount(
    2,
  );
});
