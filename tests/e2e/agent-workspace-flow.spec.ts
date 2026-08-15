import { expect, test, type Page } from "@playwright/test";

const PROJECT_ID = "e2e-agent-workspace";
const NOW = "2026-08-05T06:00:00.000Z";

test.setTimeout(60_000);

test("长备注自动扩展便签且不出现内部滚动", async ({ page }) => {
  const conversations = [conversation("conversation-note", "便签测试")];
  await mockWorkspace(page, {
    conversations,
    messages: new Map([["conversation-note", []]]),
    onCreateConversation: () =>
      conversation("conversation-new", "新的设计对话"),
    onSend: async () => {
      throw new Error("本用例不应发送 Agent 消息");
    },
  });

  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(`/${PROJECT_ID}`);

  const toolDock = page.getByRole("complementary", { name: "工具条" });
  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();

  const noteEditor = page.getByRole("textbox", { name: "备注内容" });
  const initialHeight = (await noteEditor.boundingBox())?.height ?? 0;
  await noteEditor.fill(
    "全身正面平视视角，一位身材纤细、气场干练的短发亚裔女模特，身穿短款雕塑感通勤夹克。" +
      "模特双臂自然下垂，双手轻插裤袋，以凸显短款利落的腰线和衣身的立体建筑感折痕。" +
      "纯白无影棚拍摄，柔光箱均匀布光，高清晰度，商业服装摄影，超写实。",
  );

  await expect
    .poll(async () => (await noteEditor.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialHeight);
  await expect
    .poll(async () =>
      noteEditor.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      noteEditor.evaluate((element) => getComputedStyle(element).overflowY),
    )
    .toBe("hidden");
});

test("白板悬浮工作区与 Chat Agent 在桌面和窄屏保持完整交互", async ({
  page,
}) => {
  const conversations = [conversation("conversation-1", "新的设计对话")];
  const initialUserMessage = message({
    clientRequestId: "request-existing",
    content: "生成一组强调面料垂坠感的风衣方案",
    id: "user-existing",
    role: "user",
  });
  const initialAssistantMessage = message({
    content: "已完成本轮风衣候选，请直接在这里筛选方案。",
    generationTaskId: "task-existing",
    id: "assistant-existing",
    replyToId: initialUserMessage.id,
    role: "assistant",
  });
  const messages = new Map<string, unknown[]>([
    ["conversation-1", [initialUserMessage, initialAssistantMessage]],
  ]);
  let conversationSequence = 1;
  let sendCount = 0;
  let sentShapeIds: readonly string[] = [];

  await mockWorkspace(page, {
    conversations,
    generationTasks: [generationTask("task-existing")],
    messages,
    onCreateConversation: () => {
      conversationSequence += 1;
      const created = conversation(
        `conversation-${conversationSequence}`,
        "新的设计对话",
      );
      conversations.unshift(created);
      messages.set(created.id, []);
      return created;
    },
    onSend: async (conversationId, body) => {
      sendCount += 1;
      sentShapeIds = body.shapeIds;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const userMessage = message({
        clientRequestId: body.clientRequestId,
        content: body.content,
        context: { fileAssetIds: [], shapeIds: body.shapeIds },
        id: `user-${sendCount}`,
        role: "user",
      });
      const assistantMessage = message({
        content: "已整理为三个可执行的廓形与面料方向。",
        id: `assistant-${sendCount}`,
        replyToId: userMessage.id,
        role: "assistant",
      });
      messages.set(conversationId, [userMessage, assistantMessage]);
      conversations[0] = {
        ...conversations[0],
        messageCount: 2,
        title: body.content.slice(0, 24),
        updatedAt: NOW,
      };
      return { assistantMessage, taskId: null, userMessage };
    },
  });

  await page.setViewportSize({ height: 1080, width: 1920 });
  await page.goto(`/${PROJECT_ID}`);

  const agent = page.getByRole("complementary", { name: "设计助手" });
  const toolDock = page.getByRole("complementary", { name: "工具条" });
  await expect(agent).toBeVisible();
  await expect(toolDock).toBeVisible();
  await expect(page.getByText("AGENT 工作区验收项目")).toBeVisible();
  await expect(page.locator(".tlui-main-toolbar")).toHaveCount(0);
  await expect(page.locator('[class*="generationBar"]')).toHaveCount(0);
  const toolOrder = await toolDock
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  const swatchToolIndex = toolOrder.indexOf("添加色卡");
  expect(toolOrder[swatchToolIndex]).toBe("添加色卡");
  expect(["红色图钉固定工具", "固定素材", "请先选择素材"]).toContain(
    toolOrder[swatchToolIndex + 1],
  );

  const linkedReply = agent.locator("article").filter({
    hasText: "已完成本轮风衣候选，请直接在这里筛选方案。",
  });
  const linkedCandidates = linkedReply.getByRole("region", {
    name: "本轮生成候选",
  });
  await expect(linkedCandidates).toBeVisible();
  await expect(
    linkedCandidates.getByRole("img", { name: "候选设计" }),
  ).toHaveCount(2);
  await linkedCandidates
    .getByRole("button", { name: "查看全部 3 个候选" })
    .click();
  await expect(
    linkedCandidates.getByRole("img", { name: "候选设计" }),
  ).toHaveCount(3);
  await expect(agent.getByText("全部候选", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "打开历史" }).click();
  await expect(page.getByRole("region", { name: "历史记录" })).toBeVisible();
  await page.getByRole("tab", { name: "生成" }).click();
  await expect(
    page
      .getByRole("region", { name: "历史记录" })
      .getByRole("img", { name: "候选设计" }),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "返回对话" }).click();
  await linkedCandidates
    .getByRole("button", { name: "更多候选操作" })
    .first()
    .click();
  await linkedCandidates.getByRole("button", { name: "丢弃" }).first().click();
  await expect(
    linkedCandidates.getByRole("img", { name: "候选设计" }),
  ).toHaveCount(2);

  const desktopAgentBox = await agent.boundingBox();
  const desktopDockBox = await toolDock.boundingBox();
  expect(desktopAgentBox?.width).toBeGreaterThanOrEqual(395);
  expect(desktopAgentBox?.x).toBeGreaterThan(1500);
  expect(desktopDockBox?.y).toBeGreaterThan(970);

  await page.getByRole("button", { name: "AGENT 工作区验收项目" }).click();
  const projectNavigation = page.getByRole("navigation", { name: "项目导航" });
  await expect(
    projectNavigation.getByRole("link", { name: "返回项目库" }),
  ).toBeVisible();
  await expect(projectNavigation).not.toContainText("画布元素");

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  const context = page.getByLabel("已附加内容");
  await expect(context).toContainText("灵感");
  await expect(context.locator("img")).toHaveCount(0);
  const attachmentChip = context.getByRole("button", {
    name: "灵感，设计备注",
  });
  expect(
    await context.evaluate((element) => getComputedStyle(element).flexWrap),
  ).toBe("wrap");
  const contextBox = await context.boundingBox();
  const inputBox = await page
    .getByRole("textbox", { name: "编辑描述" })
    .boundingBox();
  expect(inputBox?.height).toBeGreaterThanOrEqual(44);
  expect(inputBox?.y).toBeGreaterThanOrEqual(
    (contextBox?.y ?? 0) + (contextBox?.height ?? 0) - 1,
  );
  await attachmentChip.hover();
  const attachmentPreview = page.getByRole("tooltip");
  await expect(attachmentPreview).toBeVisible();
  await expect(attachmentPreview).toContainText("灵感");
  await attachmentPreview.hover();
  await page.waitForTimeout(150);
  await expect(attachmentPreview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(attachmentPreview).toHaveCount(0);
  await context.getByRole("button", { name: "移除 灵感" }).click();
  await expect(context).toHaveCount(0);

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  await expect(page.getByLabel("已附加内容")).toContainText("灵感");
  await page.mouse.click(620, 260);
  await expect(page.getByLabel("已附加内容")).toContainText("灵感");

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "新的设计对话",
  );

  const composer = page.getByRole("textbox", { name: "编辑描述" });
  await composer.fill("请分析这个廓形并给出三个面料方向");
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toBeEnabled();
  await composer.press("Enter");
  await composer.press("Enter");
  await expect.poll(() => sendCount).toBe(1);
  await expect(agent).toContainText("已整理为三个可执行的廓形与面料方向。");
  expect(sentShapeIds).toHaveLength(1);
  await expect(composer).toHaveValue("");
  await expect(page.getByLabel("已附加内容")).toHaveCount(0);

  await page.getByRole("button", { name: "管理当前会话" }).click();
  await page.getByRole("button", { name: "重命名会话" }).click();
  await page.getByRole("textbox", { name: "会话标题" }).fill("面料方向讨论");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "面料方向讨论",
  );

  await page.getByRole("button", { name: "管理当前会话" }).click();
  await page.getByRole("button", { name: "归档会话" }).click();
  await page.getByRole("button", { name: "再次点击确认归档" }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "新的设计对话",
  );

  await page.getByRole("button", { name: "折叠设计助手" }).click();
  const collapsed = page.getByRole("complementary", {
    name: "设计助手（已折叠）",
  });
  await expect(collapsed).toBeVisible();
  expect((await collapsed.boundingBox())?.width).toBeLessThanOrEqual(50);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("fashion-board-agent-collapsed"),
      ),
    )
    .toBe("1");

  await page.reload();
  await expect(collapsed).toBeVisible();
  await page.getByRole("button", { name: "展开设计助手" }).click();
  await expect(agent).toBeVisible();
  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  const inspector = page.locator('[data-label-design-panel="true"]');
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "编辑标签：灵感" }).click();
  await expect(inspector).toBeVisible();
  await expect(
    inspector.getByRole("radio", { name: "风格参考" }),
  ).toBeVisible();
  await expect(inspector.getByRole("radio", { name: "参考衣" })).toBeVisible();

  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 768, width: 1024 },
    { height: 1024, width: 768 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(agent).toBeVisible();
    await expect(toolDock).toBeVisible();
    const agentBox = await agent.boundingBox();
    const dockBox = await toolDock.boundingBox();
    expect(Math.round((agentBox?.x ?? 0) + (agentBox?.width ?? 0))).toBe(
      viewport.width,
    );
    expect((agentBox?.width ?? 0) <= viewport.width).toBe(true);
    expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height - 10,
    );
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox).not.toBeNull();
    expect((inspectorBox?.x ?? 0) >= 0).toBe(true);
    expect(
      (inspectorBox?.x ?? 0) + (inspectorBox?.width ?? 0),
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      (inspectorBox?.y ?? 0) + (inspectorBox?.height ?? 0),
    ).toBeLessThanOrEqual(viewport.height - 76);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
  await expect(
    page.getByRole("button", { name: "关闭设计助手" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "折叠设计助手" }).click();
  await expect(collapsed).toBeVisible();
});

async function mockWorkspace(
  page: Page,
  options: {
    readonly conversations: Array<ReturnType<typeof conversation>>;
    readonly generationTasks?: readonly unknown[];
    readonly messages: Map<string, unknown[]>;
    readonly onCreateConversation: () => ReturnType<typeof conversation>;
    readonly onSend: (
      conversationId: string,
      body: {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      },
    ) => Promise<unknown>;
  },
) {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 600, remaining: 527, used: 73 },
        user: {
          authId: "auth-agent-e2e",
          avatar: null,
          createdAt: NOW,
          deletedAt: null,
          email: "agent-e2e@example.com",
          id: "user-agent-e2e",
          name: "Agent E2E",
        },
      },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: NOW,
        id: PROJECT_ID,
        name: "AGENT 工作区验收项目",
        updatedAt: NOW,
      },
    }),
  );
  await page.route(`**/api/collections?projectId=${PROJECT_ID}`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? { batchId: "agent-e2e-save", revision: 1, savedAt: NOW }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({
      json: { items: options.generationTasks ?? [], nextCursor: null },
    }),
  );
  await page.route("**/api/generations/*/candidates/*", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route(
    `**/api/projects/${PROJECT_ID}/agent-conversations*`,
    (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          json: options.onCreateConversation(),
          status: 201,
        });
      }
      return route.fulfill({
        json: { items: options.conversations, nextCursor: null },
      });
    },
  );
  await page.route("**/api/agent-conversations/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const conversationId = new URL(route.request().url()).pathname
      .split("/")
      .at(-1);
    const body = route.request().postDataJSON() as {
      readonly archived?: boolean;
      readonly title?: string;
    };
    const index = options.conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    );
    const current = options.conversations[index];
    if (!current) return route.fulfill({ status: 404 });
    const updated = {
      ...current,
      archivedAt: body.archived ? NOW : current.archivedAt,
      title: body.title ?? current.title,
      updatedAt: NOW,
    };
    if (body.archived) options.conversations.splice(index, 1);
    else options.conversations[index] = updated;
    return route.fulfill({ json: updated });
  });
  await page.route("**/api/agent-conversations/*/messages*", async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /agent-conversations\/([^/]+)\/messages$/u,
    );
    const conversationId = match?.[1] ?? "";
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      };
      return route.fulfill({
        json: await options.onSend(conversationId, body),
        status: 201,
      });
    }
    return route.fulfill({
      json: {
        items: options.messages.get(conversationId) ?? [],
        nextCursor: null,
      },
    });
  });
}

function conversation(id: string, title: string) {
  return {
    archivedAt: null,
    createdAt: NOW,
    id,
    messageCount: 0,
    projectId: PROJECT_ID,
    title,
    updatedAt: NOW,
  };
}

function message(input: {
  readonly clientRequestId?: string | null;
  readonly content: string;
  readonly context?: {
    readonly fileAssetIds: readonly string[];
    readonly shapeIds: readonly string[];
  } | null;
  readonly id: string;
  readonly generationTaskId?: string | null;
  readonly replyToId?: string | null;
  readonly role: "assistant" | "user";
}) {
  return {
    clientRequestId: input.clientRequestId ?? null,
    content: input.content,
    context: input.context ?? null,
    createdAt: NOW,
    error: null,
    generationTaskId: input.generationTaskId ?? null,
    id: input.id,
    replyToId: input.replyToId ?? null,
    role: input.role,
    status: "completed",
    updatedAt: NOW,
  };
}

function generationTask(id: string) {
  const image = (index: number) => ({
    assetId: `asset-${index}`,
    height: 4,
    url: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#${index}`,
    width: 3,
  });
  return {
    createdAt: NOW,
    error: null,
    id,
    output: { images: [image(1), image(2), image(3)], seed: 42 },
    request: {
      cfg: 7,
      height: 1024,
      projectId: PROJECT_ID,
      prompt: "强调面料垂坠感的风衣方案",
      shapeIds: [],
      steps: 30,
      taskType: "t2i",
      width: 768,
    },
    status: "succeeded",
    taskType: "t2i",
    updatedAt: NOW,
  };
}
