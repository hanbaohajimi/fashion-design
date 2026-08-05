import { expect, test, type Page } from "@playwright/test";

const PROJECT_ID = "e2e-agent-workspace";
const NOW = "2026-08-05T06:00:00.000Z";

test.setTimeout(60_000);

test("白板悬浮工作区与 Chat Agent 在桌面和窄屏保持完整交互", async ({
  page,
}) => {
  const conversations = [conversation("conversation-1", "新的设计对话")];
  const messages = new Map<string, unknown[]>([["conversation-1", []]]);
  let conversationSequence = 1;
  let sendCount = 0;
  let sentShapeIds: readonly string[] = [];

  await mockWorkspace(page, {
    conversations,
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

  const agent = page.getByRole("complementary", { name: "AI 设计助手" });
  const toolDock = page.getByRole("complementary", { name: "工具条" });
  await expect(agent).toBeVisible();
  await expect(toolDock).toBeVisible();
  await expect(page.getByText("AGENT 工作区验收项目")).toBeVisible();
  await expect(page.locator(".tlui-main-toolbar")).toHaveCount(0);

  const desktopAgentBox = await agent.boundingBox();
  const desktopDockBox = await toolDock.boundingBox();
  expect(desktopAgentBox?.width).toBeGreaterThanOrEqual(395);
  expect(desktopAgentBox?.x).toBeGreaterThan(1500);
  expect(desktopDockBox?.y).toBeGreaterThan(970);

  await page
    .getByRole("button", { name: /PROJECT AGENT 工作区验收项目/u })
    .click();
  await expect(page.getByRole("region", { name: "项目概览" })).toContainText(
    "画布元素",
  );

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  const context = page.getByLabel("发送上下文");
  await expect(context).toContainText("灵感便签");
  await context.getByRole("button", { name: "移除 灵感便签" }).click();
  await expect(context).toHaveCount(0);

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  await expect(page.getByLabel("发送上下文")).toContainText("灵感便签");

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page.getByLabel("切换 Agent 会话")).toBeVisible();

  const composer = page.getByRole("textbox", {
    name: "告诉 Agent 你想完成什么",
  });
  await composer.fill("请分析这个廓形并给出三个面料方向");
  await composer.press("Enter");
  await composer.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "理解需求" }),
  ).toBeVisible();
  await expect.poll(() => sendCount).toBe(1);
  await expect(agent).toContainText("已整理为三个可执行的廓形与面料方向。");
  expect(sentShapeIds).toHaveLength(1);

  await page.getByRole("button", { name: "折叠 AI 设计助手" }).click();
  const collapsed = page.getByRole("complementary", {
    name: "AI 设计助手（已折叠）",
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
  await page.getByRole("button", { name: "展开 AI 设计助手" }).click();
  await expect(agent).toBeVisible();

  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 768, width: 1024 },
    { height: 1024, width: 768 },
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
  }
});

async function mockWorkspace(
  page: Page,
  options: {
    readonly conversations: Array<ReturnType<typeof conversation>>;
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
    route.fulfill({ json: { items: [], nextCursor: null } }),
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
  readonly replyToId?: string | null;
  readonly role: "assistant" | "user";
}) {
  return {
    clientRequestId: input.clientRequestId ?? null,
    content: input.content,
    context: input.context ?? null,
    createdAt: NOW,
    error: null,
    generationTaskId: null,
    id: input.id,
    replyToId: input.replyToId ?? null,
    role: input.role,
    status: "completed",
    updatedAt: NOW,
  };
}
