import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  assistantShapeStamp,
  type AssistantCanvasAction,
  type AssistantCanvasEnvelope,
  type AssistantCanvasObservation,
  type AssistantCanvasProof,
} from "../../packages/shared/src/assistant-canvas-actions";
import {
  emptyCanvasCreationDraft,
  type CanvasCreation,
  type CreateCanvasCreationInput,
} from "../../packages/shared/src/canvas-creations";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

test.setTimeout(90_000);
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("缺少预期测试数据");
  return value;
}
const chat = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
type RecordShape = {
  id: string;
  typeName: string;
  type: string;
  x: number;
  y: number;
  parentId: string;
  index: string;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};
function shapeRecords(snapshot: Record<string, unknown>) {
  const document = snapshot.document as
    { store?: Record<string, RecordShape> } | undefined;
  return Object.values(
    document?.store ?? (snapshot.store as Record<string, RecordShape>) ?? {},
  ).filter((item) => item.typeName === "shape");
}
async function fixture(page: Page, width = 1440, canEdit = true) {
  await mkdir("output/assistant-canvas-actions/screenshots", {
    recursive: true,
  });
  const base = await prepareZhiya(page, {
    count: 3,
    realClock: true,
    canEdit,
    viewport: { width, height: 900 },
  });
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: [] }),
  );
  const state = {
    ...base,
    pending: null as
      | ((observation: AssistantCanvasObservation) => AssistantCanvasAction)
      | null,
    messages: [] as ReturnType<typeof message>[],
    observations: [] as AssistantCanvasObservation[],
    actions: [] as AssistantCanvasEnvelope[],
    receipts: [] as AssistantCanvasProof[],
    applies: [] as string[],
    loseReceipt: false,
    loseSend: false,
    messageGate: null as Promise<void> | null,
    requests: [] as {
      clientRequestId: string;
      canvasObservation: AssistantCanvasObservation;
    }[],
    turns: new Map<
      string,
      { userMessage: unknown; assistantMessage: unknown }
    >(),
    creations: [] as CanvasCreation[],
    generation: 0,
  };
  function message(
    id: string,
    content: string,
    context: Record<string, unknown> = {},
    role = "assistant",
  ) {
    return {
      id,
      conversationId: "visual-chat",
      role,
      status: "completed",
      content,
      context,
      referencedNodeIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
  }
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) =>
      route.fulfill({ json: { items: state.messages, nextCursor: null } }),
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/workflow-messages",
    async (route) => {
      const input = route.request().postDataJSON() as {
        content: string;
        clientRequestId: string;
        canvasObservation: AssistantCanvasObservation;
      };
      state.requests.push(input);
      const prior = state.turns.get(input.clientRequestId);
      if (prior) {
        state.pending = null;
        expect(input.canvasObservation).toEqual(
          state.requests.find(
            (item) => item.clientRequestId === input.clientRequestId,
          )?.canvasObservation,
        );
        return route.fulfill({ json: prior });
      }
      if (!state.pending || !input.canvasObservation)
        throw new Error("缺少待测试的动作或真实画布观察");
      const observation = input.canvasObservation;
      state.observations.push(observation);
      const action = state.pending(observation);
      state.pending = null;
      const envelope: AssistantCanvasEnvelope = {
        id: randomUUID(),
        messageId: `action-${state.actions.length}`,
        conversationId: "visual-chat",
        projectId: PROJECT,
        clientId: observation.clientId,
        intentEpoch: state.actions.length + 1,
        state: "pending",
        action,
        observation,
        ...("targetCreationId" in action
          ? {
              targetRevision:
                state.creations.find(
                  (item) => item.id === action.targetCreationId,
                )?.revision ?? 0,
              targetDraft: structuredClone(
                required(
                  state.creations.find(
                    (item) => item.id === action.targetCreationId,
                  ),
                ).draft,
              ),
            }
          : {}),
      };
      state.actions.push(envelope);
      const user = {
        ...message(`user-${envelope.id}`, input.content, {}, "user"),
        clientRequestId: input.clientRequestId,
      };
      const assistant = {
        ...message(
          envelope.messageId,
          "正在应用画布操作，完成后会核对保存结果。",
          { canvasAction: envelope },
        ),
        replyToId: user.id,
      };
      state.messages.push(user, assistant);
      state.turns.set(input.clientRequestId, {
        userMessage: user,
        assistantMessage: assistant,
      });
      const gate = state.messageGate;
      state.messageGate = null;
      if (gate) await gate;
      if (state.loseSend) {
        state.loseSend = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({
        json: { userMessage: user, assistantMessage: assistant },
      });
    },
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/canvas-actions/**",
    async (route) => {
      const parts = new URL(route.request().url()).pathname.split("/");
      const action = state.actions.find(
        (item) => item.messageId === parts.at(-2),
      );
      if (!action) throw new Error("缺少操作消息");
      const stored = required(
        state.messages.find((item) => item.id === action.messageId),
      );
      const body = route.request().postDataJSON() as {
        clientId: string;
        status: string;
        proof: AssistantCanvasProof;
        error?: string;
      };
      expect(body.clientId).toBe(action.clientId);
      if (parts.at(-1) === "claim") {
        action.state = "applying";
        return route.fulfill({ json: stored });
      }
      if (parts.at(-1) === "apply") {
        state.applies.push(action.id);
        const command = action.action;
        if (
          command.type === "connect_inputs" ||
          command.type === "disconnect_inputs"
        ) {
          const item = required(
            state.creations.find(
              (item) => item.id === command.targetCreationId,
            ),
          );
          item.draft = {
            ...item.draft,
            inputs:
              command.type === "connect_inputs"
                ? [
                    ...item.draft.inputs,
                    ...command.sourceShapeIds.map((id, index) => {
                      const source = required(
                        action.observation.objects.find(
                          (item) => item.id === id,
                        ),
                      );
                      return {
                        id: `assistant-input-${index}`,
                        ...(source.nodeId ? { nodeId: source.nodeId } : {}),
                        ...(source.creationId
                          ? { creationId: source.creationId }
                          : {}),
                      };
                    }),
                  ]
                : item.draft.inputs.filter(
                    (input) => !command.inputIds.includes(input.id),
                  ),
          };
          item.revision++;
          return route.fulfill({ json: { creation: item } });
        }
        const document = base.getCanvasDocument();
        let nodeId: string;
        if (command.type === "update_swatch") {
          nodeId = required(
            required(
              action.observation.objects.find(
                (item) => item.id === command.shapeId,
              ),
            ).nodeId,
          );
          const node = required(
            base.graph.nodes.find((item) => item.id === nodeId),
          );
          Object.assign(node, {
            title: command.title ?? node.title,
            payload: {
              ...node.payload,
              colors: command.colors,
              color: command.colors[0]?.hex,
            },
          });
        } else if (
          command.type === "create_swatch" ||
          command.type === "add_fabric"
        ) {
          nodeId = `assistant-material-${action.id}`;
          base.graph.nodes.push({
            ...required(base.graph.nodes[0]),
            id: nodeId,
            type: command.type === "create_swatch" ? "swatch" : "fabric",
            title:
              command.type === "create_swatch" ? command.title : "亚麻面料",
            payload:
              command.type === "create_swatch"
                ? { colors: command.colors, color: command.colors[0]?.hex }
                : {
                    fabricId: command.fabricId,
                    imageUrl: "/visual-garment.svg",
                    text: "亚麻面料",
                  },
            x: 450,
            y: 400,
          });
          base.setCanvasDocument({
            ...document,
            revision: document.revision + 1,
            bindings: [
              ...document.bindings,
              {
                shapeId: `shape:assistant-${action.id}`,
                nodeId,
                removed: false,
              },
            ],
          });
        } else throw new Error("排版和打开界面不应调用服务端素材接口");
        base.graph.revision++;
        return route.fulfill({
          json: { nodeId, graph: base.graph, canvas: base.getCanvasDocument() },
        });
      }
      state.receipts.push(body.proof);
      if (body.status === "succeeded") {
        const records = shapeRecords(base.getCanvasDocument().snapshot);
        for (const proof of body.proof.shapes)
          expect(
            assistantShapeStamp(
              records.find((record) => record.id === proof.id),
            ),
          ).toBe(proof.stamp);
        for (const id of body.proof.removedShapeIds)
          expect(records.some((record) => record.id === id)).toBe(false);
        if (state.loseReceipt) {
          state.loseReceipt = false;
          return route.fulfill({
            status: 503,
            json: { message: "回执暂未确认" },
          });
        }
      }
      action.state = body.status as "succeeded" | "failed";
      if (body.error) action.error = body.error;
      stored.content =
        body.status === "succeeded"
          ? `已完成画布操作 ${state.actions.indexOf(action) + 1}`
          : `操作失败：${body.error}`;
      return route.fulfill({ json: stored });
    },
  );
  await page.route(`**/api/projects/${PROJECT}/canvas/creations**`, (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items: state.creations, canEdit } });
    if (
      route.request().method() === "POST" &&
      new URL(route.request().url()).pathname.endsWith("/creations")
    ) {
      const input = route.request().postDataJSON() as CreateCanvasCreationInput;
      expect(state.actions.at(-1)?.action.type).toBe("open_panel");
      expect(input.id).toBe(state.actions.at(-1)?.id);
      const existing = state.creations.find((item) => item.id === input.id);
      if (existing) return route.fulfill({ json: existing });
      const item: CanvasCreation = {
        ...input,
        projectId: PROJECT,
        revision: 0,
        position: input.position ?? null,
        currentResult: null,
        currentResultNodeId: null,
        runs: [],
        resource: null,
        removed: false,
        createdAt: NOW,
        updatedAt: NOW,
      };
      state.creations.push(item);
      return route.fulfill({ json: item });
    }
    if (route.request().method() === "PATCH") {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const item = required(state.creations.find((item) => item.id === id));
      const input = route.request().postDataJSON();
      expect(input.expectedRevision).toBe(item.revision);
      item.draft = input.draft;
      item.revision++;
      return route.fulfill({ json: item });
    }
    state.generation++;
    return route.fulfill({
      status: 500,
      json: { message: "本测试禁止生成或隐式创建目标" },
    });
  });
  async function send(
    builder: (observation: AssistantCanvasObservation) => AssistantCanvasAction,
    text = "请执行当前画布操作",
  ) {
    state.pending = builder;
    await chat(page).fill(text);
    await page.getByRole("button", { name: "发送需求", exact: true }).click();
    await expect.poll(() => state.pending).toBeNull();
  }
  async function done() {
    await expect(
      page.locator(`[data-canvas-action-id="${state.actions.at(-1)?.id}"]`),
    ).toHaveAttribute("data-state", "succeeded");
  }
  const shapes = () => shapeRecords(base.getCanvasDocument().snapshot);
  return { state, send, done, shapes };
}

test("真实画布移动、显示缩放、对齐、分布、层级、组合与解组均保存后回执", async ({
  page,
}) => {
  const f = await fixture(page);
  await loadZhiya(page);
  await openZhiya(page);
  let source = "";
  await f.send((observation) => {
    source = required(
      observation.objects.find((item) => item.nodeId === "material-0"),
    ).id;
    return {
      type: "move_objects",
      shapeIds: [source],
      offset: { x: 75, y: 55 },
    };
  });
  await f.done();
  const old = required(
    required(f.state.observations[0]).objects.find(
      (item) => item.id === source,
    ),
  );
  expect(f.shapes().find((item) => item.id === source)).toMatchObject({
    x: old.bounds.x + 75,
    y: old.bounds.y + 55,
  });
  await f.send(() => ({
    type: "resize_objects",
    shapeIds: [source],
    width: 180,
    height: 240,
    keepAspectRatio: true,
  }));
  await f.done();
  expect(f.shapes().find((item) => item.id === source)?.props).toMatchObject({
    w: 180,
    h: 240,
  });
  let selected: string[] = [];
  await f.send((observation) => {
    selected = observation.objects
      .filter((item) => item.nodeId?.startsWith("material-"))
      .map((item) => item.id);
    return { type: "align_objects", shapeIds: selected, alignment: "top" };
  });
  await f.done();
  expect(
    new Set(
      f
        .shapes()
        .filter((item) => selected.includes(item.id))
        .map((item) => Math.round(item.y)),
    ).size,
  ).toBe(1);
  await f.send(() => ({
    type: "distribute_objects",
    shapeIds: selected,
    axis: "horizontal",
  }));
  await f.done();
  const sorted = f
    .shapes()
    .filter((item) => selected.includes(item.id))
    .sort((a, b) => a.x - b.x);
  expect(
    required(sorted[1]).x -
      required(sorted[0]).x -
      Number(required(sorted[0]).props.w),
  ).toBeCloseTo(
    required(sorted[2]).x -
      required(sorted[1]).x -
      Number(required(sorted[1]).props.w),
  );
  await f.send(() => ({
    type: "reorder_objects",
    shapeIds: [source],
    order: "front",
  }));
  await f.done();
  expect(
    f
      .shapes()
      .sort((a, b) => a.index.localeCompare(b.index))
      .at(-1)?.id,
  ).toBe(source);
  await f.send(() => ({
    type: "group_objects",
    shapeIds: selected.slice(0, 2),
  }));
  await f.done();
  const group = required(f.shapes().find((item) => item.type === "group"));
  expect(group).toBeTruthy();
  expect(f.shapes().filter((item) => item.parentId === group.id)).toHaveLength(
    2,
  );
  await f.send(() => ({ type: "ungroup_objects", shapeIds: [group.id] }));
  await f.done();
  expect(f.shapes().some((item) => item.id === group.id)).toBe(false);
  expect(f.shapes()).toHaveLength(3);
  expect(f.state.applies).toEqual([]);
  expect(f.state.generation).toBe(0);
  expect(f.state.errors).toEqual([]);
  await mkdir("output/assistant-canvas-actions/screenshots", {
    recursive: true,
  });
  await page.screenshot({
    path: "output/assistant-canvas-actions/screenshots/layout-receipts.png",
  });
});

test("回执丢失与刷新不会重放移动，历史只在明确继续后补确认", async ({
  page,
}) => {
  const f = await fixture(page);
  await loadZhiya(page);
  await openZhiya(page);
  f.state.loseReceipt = true;
  await f.send((observation) => ({
    type: "move_objects",
    shapeIds: [required(observation.objects[0]).id],
    offset: { x: 85, y: 0 },
  }));
  await expect(
    page.getByRole("button", { name: "继续确认画布操作", exact: true }),
  ).toBeVisible();
  const after = f.shapes();
  await page.reload();
  await expect(chat(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续确认画布操作", exact: true }),
  ).toBeVisible();
  expect(f.state.receipts).toHaveLength(1);
  await page
    .getByRole("button", { name: "继续确认画布操作", exact: true })
    .click();
  await f.done();
  expect(f.shapes()).toEqual(after);
  expect(f.state.receipts).toHaveLength(2);
  expect(f.state.generation).toBe(0);
  expect(f.state.errors).toEqual([]);
});

test("发送回执未知时平移画布仍沿用原请求和观察，操作只应用一次", async ({
  page,
}) => {
  const f = await fixture(page);
  await loadZhiya(page);
  await openZhiya(page);
  f.state.loseSend = true;
  const action = (
    observation: AssistantCanvasObservation,
  ): AssistantCanvasAction => ({
    type: "move_objects",
    shapeIds: [required(observation.objects[0]).id],
    offset: { x: 100, y: 0 },
  });
  await f.send(action);
  await expect(chat(page)).toHaveValue("请执行当前画布操作");
  await expect(
    page.getByRole("button", { name: "发送需求", exact: true }),
  ).toBeEnabled();
  await page.mouse.move(200, 180);
  await page.mouse.wheel(0, 140);
  await f.send(action);
  await f.done();
  expect(f.state.actions).toHaveLength(1);
  expect(f.state.requests).toHaveLength(2);
  expect(f.state.requests[0]?.clientRequestId).toBe(
    f.state.requests[1]?.clientRequestId,
  );
  const observed = required(f.state.observations[0]?.objects[0]);
  expect(f.shapes().find((shape) => shape.id === observed.id)?.x).toBeCloseTo(
    observed.bounds.x + 100,
  );
  expect(f.state.generation).toBe(0);
  expect(f.state.errors).toEqual([]);
});

for (const panel of [
  "functions",
  "fabrics",
  "objects",
  "image-crop",
  "color",
] as const)
  test(`助手打开${panel}的真实界面，界面出现后确认`, async ({ page }) => {
    const f = await fixture(page, panel === "functions" ? 390 : 1440);
    await loadZhiya(page);
    await openZhiya(page);
    await f.send(() => ({ type: "open_panel", panel }), `打开${panel}`);
    await expect.poll(() => f.state.actions[0]?.state).toBe("succeeded");
    await expect(
      page.locator(
        `[data-canvas-${panel === "objects" ? "objects" : "panel"}${panel === "objects" ? "" : `="${panel}"`}]`,
      ),
    ).toBeVisible();
    expect(f.state.receipts[0]?.panel).toBe(panel);
    await page.mouse.move(8, 8);
    await page.screenshot({
      path: `output/assistant-canvas-actions/screenshots/panel-${panel}.png`,
      animations: "disabled",
    });
    expect(f.state.applies).toEqual([]);
    expect(f.state.generation).toBe(0);
    expect(f.state.errors).toEqual([]);
  });

test("创建与更新多色色卡、添加已有面料，引用和真实素材绑定保持完整", async ({
  page,
}) => {
  const f = await fixture(page);
  await loadZhiya(page);
  await openZhiya(page);
  const colors = [
    { hex: "#205b43", name: "深绿" },
    { hex: "#b09a78", name: "亚麻" },
    { hex: "#ede8df", name: "暖白" },
  ];
  await f.send(() => ({ type: "create_swatch", title: "新通勤配色", colors }));
  await f.done();
  const swatch = required(
    f.shapes().find((item) => item.type === "fashion-swatch"),
  );
  expect(swatch).toBeTruthy();
  expect(
    f.state.graph.nodes.find((node) => node.id === swatch.meta.canvasNodeId)
      ?.payload.colors,
  ).toEqual(colors);
  const updated = [...colors, { hex: "#773d4a", name: "浆果" }];
  await f.send(() => ({
    type: "update_swatch",
    shapeId: swatch.id,
    title: "四色方案",
    colors: updated,
  }));
  await f.done();
  expect(
    f.shapes().filter((item) => item.type === "fashion-swatch"),
  ).toHaveLength(1);
  expect(
    f.state.graph.nodes.find((node) => node.id === swatch.meta.canvasNodeId)
      ?.payload.colors,
  ).toEqual(updated);
  await f.send(() => ({ type: "add_fabric", fabricId: "authorized-linen" }));
  await f.done();
  const fabric = required(
    f.state.graph.nodes.find((node) => node.type === "fabric"),
  );
  expect(
    f.shapes().filter((item) => item.meta.canvasNodeId === fabric.id),
  ).toHaveLength(1);
  expect(f.state.applies).toHaveLength(3);
  expect(f.state.generation).toBe(0);
  expect(f.state.errors).toEqual([]);
});

test("空目标输入连接和移除同步现有创作框，保留要求且不生成", async ({
  page,
}) => {
  const f = await fixture(page);
  const target: CanvasCreation = {
    id: randomUUID(),
    projectId: PROJECT,
    title: "下游夹克",
    module: "image",
    revision: 0,
    draft: { ...emptyCanvasCreationDraft(), prompt: "立领夹克保持原版型" },
    position: { x: 400, y: 0 },
    currentResult: null,
    currentResultNodeId: null,
    runs: [],
    resource: null,
    removed: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const upstream = {
    ...target,
    id: randomUUID(),
    title: "上游探索",
    draft: emptyCanvasCreationDraft(),
    position: { x: 50, y: 0 },
  };
  f.state.creations.push(upstream, target);
  await loadZhiya(page);
  await page
    .getByRole("group", { name: "下游夹克", exact: true })
    .getByRole("button", { name: "描述画面", exact: true })
    .click();
  const composer = page.getByRole("region", {
    name: "图片创作框",
    exact: true,
  });
  await expect(composer).toBeVisible();
  await composer
    .getByRole("textbox", { name: "本次创作要求", exact: true })
    .fill("立领夹克保持原版型");
  await openZhiya(page);
  const connect = (
    observation: AssistantCanvasObservation,
  ): AssistantCanvasAction => ({
    type: "connect_inputs",
    targetCreationId: target.id,
    sourceShapeIds: [
      required(
        observation.objects.find((item) => item.creationId === upstream.id),
      ).id,
    ],
  });
  let release = () => {};
  f.state.messageGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await f.send(connect);
  await composer
    .getByRole("textbox", { name: "本次创作要求", exact: true })
    .fill("等待回复期间的最新要求");
  release();
  await expect(page.getByText(/该目标有未保存/)).toBeVisible();
  expect(target.draft.inputs).toEqual([]);
  await expect(
    composer.getByRole("textbox", { name: "本次创作要求", exact: true }),
  ).toHaveValue("等待回复期间的最新要求");
  await f.send(connect);
  await f.done();
  expect(target.draft).toMatchObject({
    prompt: "等待回复期间的最新要求",
    inputs: [{ creationId: upstream.id }],
  });
  await expect(composer.locator("[data-creation-reference]")).toHaveCount(1);
  await composer
    .getByRole("textbox", { name: "本次创作要求", exact: true })
    .fill("连接后追加的要求");
  await f.send(() => ({
    type: "disconnect_inputs",
    targetCreationId: target.id,
    inputIds: target.draft.inputs.map((input) => input.id),
  }));
  await f.done();
  expect(target.draft.prompt).toBe("连接后追加的要求");
  expect(target.draft.inputs).toEqual([]);
  await expect(composer.locator("[data-creation-reference]")).toHaveCount(0);
  await expect(
    composer.getByRole("textbox", { name: "本次创作要求", exact: true }),
  ).toHaveValue("连接后追加的要求");
  expect(f.state.generation).toBe(0);
  expect(f.state.errors).toEqual([]);
});

test("只读画布拒绝布局修改并反馈实际失败", async ({ page }) => {
  const f = await fixture(page, 1440, false);
  await loadZhiya(page);
  await openZhiya(page);
  await f.send((observation) => ({
    type: "move_objects",
    shapeIds: [required(observation.objects[0]).id],
    offset: { x: 85, y: 0 },
  }));
  await expect(page.getByText(/当前画布没有编辑权限/)).toBeVisible();
  expect(f.state.actions[0]?.state).toBe("failed");
  expect(f.state.applies).toEqual([]);
  expect(f.state.generation).toBe(0);
});
