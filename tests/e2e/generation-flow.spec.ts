import { expect, test } from "@playwright/test";

test("项目库可以安全退出并返回登录页", async ({ page }) => {
  let logoutRequestCount = 0;

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 88, used: 12 },
        user: {
          authId: "auth-logout",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "logout@example.com",
          id: "user-logout",
          name: "Logout Atelier",
        },
      },
    }),
  );
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({
      json: { items: [], nextCursor: null, total: 0 },
    }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequestCount += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByText("logout@example.com")).toBeVisible();

  const workspaceNavigation = page.getByRole("navigation", {
    name: "工作区导航",
  });
  await expect(
    workspaceNavigation.getByRole("link", { name: "项目库" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    workspaceNavigation.getByRole("link", { name: "趋势档案" }),
  ).toHaveAttribute("href", "/trends");
  await expect(
    workspaceNavigation.getByRole("link", { name: "面料库" }),
  ).toHaveAttribute("href", "/fabrics");

  await expect(
    page.getByRole("heading", { name: "从第一个系列开始" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await expect(
    page.getByRole("dialog", { name: "给新系列一个名字" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const projectSearch = page.getByRole("searchbox", { name: "搜索项目" });
  await page.keyboard.press("Control+K");
  await expect(projectSearch).toBeFocused();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "退出登录" }).click();

  await expect.poll(() => logoutRequestCount).toBe(1);
  await expect(page).toHaveURL(/\/login$/u);
});

test("登录邮件发送后可更换邮箱并重发到已确认地址", async ({ page }) => {
  const recipients: string[] = [];

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON() as {
      readonly action: string;
      readonly email?: string;
    };
    if (body.action === "send" && body.email) {
      recipients.push(body.email);
    }
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/login");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  const emailInput = page.getByRole("textbox", { name: "邮箱地址" });
  await emailInput.fill("first@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();

  await expect(page.getByRole("status")).toContainText("first@example.com");
  await expect(emailInput).toBeDisabled();
  await page.getByRole("button", { name: "换个邮箱" }).click();
  await expect(emailInput).toBeFocused();
  await emailInput.fill("second@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("second@example.com");

  await page.getByRole("button", { name: "重新发送" }).click();
  await expect
    .poll(() => recipients)
    .toEqual(["first@example.com", "second@example.com", "second@example.com"]);
});

test("面料档案支持快捷搜索并可快速清空关键词", async ({ page }) => {
  const requestedSearches: string[] = [];

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 88, used: 12 },
        user: {
          authId: "auth-fabric-search",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "fabric-search@example.com",
          id: "user-fabric-search",
          name: "Fabric Search",
        },
      },
    }),
  );
  await page.route("**/api/fabrics?*", (route) => {
    requestedSearches.push(
      new URL(route.request().url()).searchParams.get("search") ?? "",
    );
    return route.fulfill({
      json: { items: [], limit: 48, page: 1, total: 0, totalPages: 1 },
    });
  });

  await page.goto("/fabrics");
  const search = page.getByRole("searchbox", { name: "搜索面料" });
  await page.keyboard.press("Control+K");
  await expect(search).toBeFocused();
  await search.fill("  亚麻  ");
  await expect.poll(() => requestedSearches).toContain("亚麻");
  await expect(page.getByText("没有匹配“亚麻”的面料。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
});

test("新建项目成功后立即进入对应白板", async ({ page }) => {
  const now = "2026-08-05T00:00:00.000Z";
  const project = {
    archived: false,
    assetCount: 0,
    coverAssetId: null,
    coverUrl: null,
    createdAt: now,
    id: "created-project",
    name: "真实流程胶囊系列",
    updatedAt: now,
  };
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 100, used: 0 },
        user: {
          authId: "auth-project-create",
          avatar: null,
          createdAt: now,
          deletedAt: null,
          email: "project-create@example.com",
          id: "user-project-create",
          name: "Project Creator",
        },
      },
    }),
  );
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, total: 0 } }),
  );
  await page.route(/\/api\/projects$/u, (route) =>
    route.fulfill({ json: project, status: 201 }),
  );
  await page.route("**/api/projects/created-project", (route) =>
    route.fulfill({ json: project }),
  );
  await page.route("**/api/projects/created-project/board", (route) =>
    route.fulfill({ json: { elements: [], revision: 0, snapshot: null } }),
  );
  await page.route("**/api/collections?projectId=created-project", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    "**/api/projects/created-project/agent-conversations*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              archivedAt: null,
              createdAt: now,
              id: "created-project-conversation",
              messageCount: 0,
              projectId: project.id,
              title: "新的设计对话",
              updatedAt: now,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.route("**/api/agent-conversations/*/messages*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill(project.name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();

  await expect(page).toHaveURL(/\/created-project$/u);
  await expect(page.getByText(project.name)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "白板三步上手" }),
  ).toBeVisible();
});

test("趋势主题筛选使用接口返回的真实分类", async ({ page }) => {
  const now = "2026-08-05T00:00:00.000Z";
  const trend = (id: string, category: string, title: string) => ({
    category,
    coverImageUrl: null,
    curatedAt: now,
    extracted: null,
    id,
    platform: "vogue",
    publishedAt: now,
    sourceUrl: `https://example.com/${id}`,
    status: "published",
    summary: `${title}摘要`,
    tags: [category],
    title,
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 100, used: 0 },
        user: {
          authId: "auth-trends",
          avatar: null,
          createdAt: now,
          deletedAt: null,
          email: "trends@example.com",
          id: "user-trends",
          name: "Trend Reader",
        },
      },
    }),
  );
  await page.route("**/api/trends?*", (route) =>
    route.fulfill({
      json: {
        items: [
          trend("color-1", "color", "低饱和红"),
          trend("styling-1", "styling", "层叠造型"),
          trend("material-1", "material", "轻量科技面料"),
        ],
        page: 1,
        pageSize: 60,
        total: 3,
      },
    }),
  );
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({
      json: {
        createdAt: now,
        id: "digest-1",
        itemIds: [],
        overview: "本周趋势摘要",
        period: "2026-W32",
        theme: "轻量层叠",
      },
    }),
  );

  await page.goto("/trends");
  const filters = page.getByRole("region", { name: "趋势筛选" });
  await expect(filters.getByRole("button", { name: "色彩" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "造型" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "材质" })).toBeVisible();
  await filters.getByRole("button", { name: "色彩" }).click();
  await expect(page.getByText("低饱和红", { exact: true })).toBeVisible();
  await expect(page.getByText("层叠造型", { exact: true })).toHaveCount(0);
});

test("本地图片拖入白板后关闭投放遮罩并进入自定义上传流程", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 9, used: 91 },
        user: {
          authId: "auth-drop",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "drop@example.com",
          id: "user-drop",
          name: "Drop E2E",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-drop", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-drop",
        name: "E2E 拖放项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-drop", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/projects/e2e-drop/board", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? {
              batchId: "e2e-drop-save",
              revision: 1,
              savedAt: "2026-08-03T00:00:00.000Z",
            }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/files/sign-upload", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "E2E 主动终止实际上传" },
    }),
  );

  await page.goto("/e2e-drop");
  await expect(page.getByText("E2E 拖放项目")).toBeVisible();

  const dispatchFileDrag = (eventType: "dragenter" | "drop") =>
    page.evaluate((type) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "reference.png", {
          type: "image/png",
        }),
      );
      const x = Math.round(window.innerWidth / 2);
      const y = Math.round(window.innerHeight / 2);
      const target = document.elementFromPoint(x, y) ?? document.body;
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer,
        }),
      );
    }, eventType);

  await dispatchFileDrag("dragenter");
  await expect(page.getByText("DROP / IMAGE", { exact: true })).toBeVisible();

  await dispatchFileDrag("drop");
  await expect(page.getByText("DROP / IMAGE", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "图片上传状态" }),
  ).toContainText("reference.png");
  await expect(page.getByText("reference.png", { exact: true })).toHaveCount(1);
});

test("面料库支持点击和拖放上传，并可添加到白板", async ({ page }) => {
  const userFabrics: Array<Record<string, unknown>> = [];
  let uploadCount = 0;

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 9, used: 91 },
        user: {
          authId: "auth-fabric",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "fabric@example.com",
          id: "user-fabric",
          name: "Fabric E2E",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-fabric", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-fabric",
        name: "E2E 面料项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-fabric", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/projects/e2e-fabric/board", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? {
              batchId: "e2e-fabric-save",
              revision: 1,
              savedAt: "2026-08-03T00:00:00.000Z",
            }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/fabrics?*", (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    const items = scope === "user" ? userFabrics : [];
    return route.fulfill({
      json: { items, limit: 48, page: 1, total: items.length, totalPages: 1 },
    });
  });
  await page.route(/\/api\/fabrics$/u, async (route) => {
    uploadCount += 1;
    const created = {
      attributes: {
        composition: { 混合纤维: 100 },
        weight: 180,
        weave: "plain",
      },
      canManage: true,
      category: "blend",
      createdAt: "2026-08-03T00:00:00.000Z",
      id: `fabric-upload-${uploadCount}`,
      mainFileId: `file-upload-${uploadCount}`,
      mainImageUrl: `/api/fabrics/fabric-upload-${uploadCount}/image`,
      name: uploadCount === 1 ? "click-fabric" : "drop-fabric",
      scope: "user",
      subCategory: null,
      tags: [uploadCount === 1 ? "click-fabric" : "drop-fabric"],
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    userFabrics.unshift(created);
    await route.fulfill({ json: created, status: 201 });
  });

  await page.goto("/e2e-fabric");
  await page.getByRole("button", { name: "打开面料库" }).click();
  const drawer = page.getByRole("complementary", { name: "面料抽屉" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(() => drawer.evaluate((target) => getComputedStyle(target).boxShadow))
    .toBe("none");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await drawer.getByRole("button", { name: /添加面料/u }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from([137, 80, 78, 71]),
    mimeType: "image/png",
    name: "click-fabric.png",
  });
  await drawer.getByRole("textbox", { name: "标签" }).fill("click-fabric");
  await drawer.getByRole("button", { name: "保存到面料库" }).click();
  await expect.poll(() => uploadCount).toBe(1);
  await expect(drawer.getByRole("button", { name: "我的" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const clickFabricCard = drawer.getByRole("article", {
    name: "click-fabric，拖拽到白板",
  });
  await expect(clickFabricCard.getByText("#click-fabric")).toBeVisible();
  await expect
    .poll(() =>
      clickFabricCard.evaluate((target) => getComputedStyle(target).boxShadow),
    )
    .toBe("none");

  const manageFabricButton = clickFabricCard.getByRole("button", {
    name: "管理 / 删除",
  });
  await manageFabricButton.click();
  const fabricDialog = page.getByRole("dialog", { name: "管理或删除面料" });
  const closeFabricDialog = fabricDialog.getByRole("button", { name: "关闭" });
  await expect(closeFabricDialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    fabricDialog.getByRole("button", { name: "删除" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(fabricDialog).toHaveCount(0);
  await expect(manageFabricButton).toBeFocused();

  const uploadPanel = drawer.getByRole("region", { name: "上传面料" });
  await uploadPanel.evaluate((target) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "drop-fabric.png", {
        type: "image/png",
      }),
    );
    target.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
  });
  await drawer.getByRole("textbox", { name: "标签" }).fill("drop-fabric");
  await drawer.getByRole("button", { name: "保存到面料库" }).click();
  await expect.poll(() => uploadCount).toBe(2);
  await expect(
    drawer
      .getByRole("article", { name: "drop-fabric，拖拽到白板" })
      .getByText("#drop-fabric"),
  ).toBeVisible();

  await clickFabricCard.getByRole("button", { name: "添加到白板" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('img[alt="click-fabric"]')).toHaveCount(1);
});

test("框选约束后生成结果自动落为带 assetId 的白板图片", async ({ page }) => {
  let persistedAssetId: string | undefined;
  let persistedRole: string | undefined;
  let persistedSnapshot: unknown = null;
  let generationIdempotencyKey: string | undefined;
  let generationRequestCount = 0;
  let candidateDisposition: string | undefined;
  const task = {
    id: "task-e2e-1",
    taskType: "t2i",
    status: "succeeded",
    request: {
      cfg: 3.5,
      height: 1024,
      projectId: "e2e-project",
      prompt: "保留便签约束的利落廓形外套",
      shapeIds: [],
      steps: 28,
      taskType: "t2i",
      width: 1024,
    },
    output: {
      images: [
        {
          assetId: "asset-e2e-1",
          url: "https://assets.example/generated-look.png",
          width: 768,
          height: 1024,
        },
      ],
    },
    error: null,
    createdAt: "2026-07-27T08:00:00.000Z",
    updatedAt: "2026-07-27T08:00:01.000Z",
  };
  const taskWithDisposition = () => ({
    ...task,
    output: {
      ...task.output,
      candidateDispositions: candidateDisposition
        ? { "0": candidateDisposition }
        : {},
    },
  });

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        credits: { limit: 100, remaining: 9, used: 91 },
        user: {
          authId: "auth-e2e",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "atelier@example.com",
          id: "user-e2e",
          name: "Atelier E2E",
        },
      }),
    });
  });
  await page.route("**/api/projects/e2e-project", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-project",
        name: "E2E 生成项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-project", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    "**/api/projects/e2e-project/agent-conversations?limit=50",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              archivedAt: null,
              createdAt: "2026-07-27T08:00:00.000Z",
              id: "conversation-e2e-project",
              messageCount: 0,
              projectId: "e2e-project",
              title: "新的设计对话",
              updatedAt: "2026-07-27T08:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.route(
    "**/api/agent-conversations/conversation-e2e-project/messages?limit=50",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    "**/api/agent-conversations/conversation-e2e-project/messages",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      };
      const userMessage = {
        clientRequestId: body.clientRequestId,
        content: body.content,
        context: { fileAssetIds: [], shapeIds: body.shapeIds },
        createdAt: "2026-07-27T08:00:03.000Z",
        error: null,
        generationTaskId: null,
        id: "user-e2e-generation",
        replyToId: null,
        role: "user",
        status: "completed",
        updatedAt: "2026-07-27T08:00:03.000Z",
      };
      const assistantMessage = {
        ...userMessage,
        clientRequestId: null,
        content: "已按选中约束生成候选。",
        generationTaskId: "task-e2e-1",
        id: "assistant-e2e-generation",
        replyToId: userMessage.id,
        role: "assistant",
      };
      await route.fulfill({
        json: { assistantMessage, taskId: "task-e2e-1", userMessage },
        status: 201,
      });
    },
  );
  await page.route("**/api/projects/e2e-project/board", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as {
        readonly snapshot?: unknown;
        readonly patches?: readonly {
          readonly record?: {
            readonly props?: {
              readonly assetId?: string;
              readonly role?: string;
            };
          };
        }[];
      };
      persistedAssetId = payload.patches
        ?.map((patch) => patch.record?.props?.assetId)
        .find(Boolean);
      persistedRole = payload.patches
        ?.map((patch) => patch.record?.props?.role)
        .find(Boolean);
      persistedSnapshot = payload.snapshot ?? null;
      await route.fulfill({
        json: {
          batchId: "e2e-board-save",
          revision: 1,
          savedAt: "2026-07-27T08:00:02.000Z",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        elements: [],
        revision: persistedSnapshot ? 1 : 0,
        snapshot: persistedSnapshot,
      },
    });
  });
  await page.route(
    "**/api/projects/e2e-project/board-elements/roles",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/generations?*", async (route) => {
    await route.fulfill({
      json: {
        items: generationRequestCount > 0 ? [taskWithDisposition()] : [],
        nextCursor: null,
      },
    });
  });
  await page.route(/\/api\/generations$/u, async (route) => {
    generationRequestCount += 1;
    generationIdempotencyKey = route.request().headers()["idempotency-key"];
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 202,
      json: { task_id: "task-e2e-1" },
    });
  });
  await page.route("**/api/generations/task-e2e-1/events", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: generation\n" +
        `data: ${JSON.stringify({
          taskId: task.id,
          status: task.status,
          timestamp: task.updatedAt,
        })}\n\n`,
    });
  });
  await page.route(
    "**/api/generations/task-e2e-1/candidates/0",
    async (route) => {
      candidateDisposition = (
        route.request().postDataJSON() as { readonly disposition?: string }
      ).disposition;
      await route.fulfill({ json: taskWithDisposition() });
    },
  );
  await page.route("**/api/generations/task-e2e-1", async (route) => {
    await route.fulfill({ json: taskWithDisposition() });
  });
  await page.route(
    "https://assets.example/generated-look.png",
    async (route) => {
      await route.fulfill({
        contentType: "image/svg+xml",
        body:
          '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">' +
          '<rect width="768" height="1024" fill="#c9b9a2"/>' +
          '<path d="M260 210h248l76 620H184z" fill="#3e463f"/>' +
          "</svg>",
      });
    },
  );

  await page.goto("/e2e-project");
  await expect(page.getByText("E2E 生成项目")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "白板三步上手" }),
  ).toContainText("上传参考");
  const toolRail = page.getByRole("complementary", { name: "工具条" });
  const sketchButton = toolRail.getByRole("button", {
    name: "新建廓形草图",
  });
  await expect(sketchButton).toBeVisible();
  await expect(
    toolRail.getByRole("button", { name: "橡皮擦工具" }),
  ).toHaveCount(0);
  await sketchButton.click();
  const sketchToolRail = page.getByRole("complementary", {
    name: "草绘工具条",
  });
  await expect(
    sketchToolRail.getByRole("button", { name: "局部橡皮" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await sketchToolRail.getByRole("button", { name: "退出" }).click();
  await expect(toolRail).toBeVisible();
  const arrowTool = toolRail.getByRole("button", { name: "箭头工具" });
  await expect(arrowTool).toBeVisible();
  await page.keyboard.press("Shift+L");
  await expect(arrowTool).toHaveAttribute("aria-pressed", "true");
  await expect(toolRail.getByRole("button", { name: "矩形工具" })).toHaveCount(
    0,
  );
  await expect(toolRail.getByRole("button", { name: "添加Frame" })).toHaveCount(
    0,
  );
  await expect(
    toolRail.getByRole("button", { name: "固定素材" }),
  ).toBeVisible();
  await expect(page.locator(".tlui-main-toolbar")).toHaveCount(0);
  const inspirationNoteButton = toolRail.getByRole("button", {
    name: "添加灵感便签",
  });
  await expect(inspirationNoteButton).toBeVisible();

  await inspirationNoteButton.click();
  await expect(page.getByTestId("style.panel")).toHaveCount(0);
  const labelDesignPanel = page.locator('[data-label-design-panel="true"]');
  await expect(labelDesignPanel).toHaveCount(0);
  await page.getByRole("button", { name: "编辑标签：灵感" }).click();
  await expect(labelDesignPanel).toBeVisible();
  const styleRole = page.getByRole("radio", { name: /风格参考/u });
  const noteRole = page.getByRole("radio", { name: /灵感/u });
  await expect(noteRole).toHaveAttribute("aria-checked", "true");
  await styleRole.focus();
  await page.keyboard.press("End");
  await expect(noteRole).toBeFocused();
  await expect(noteRole).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(labelDesignPanel).toHaveCount(0);
  await page.mouse.move(470, 220);
  await page.mouse.down();
  await page.mouse.move(810, 500, { steps: 12 });
  await page.mouse.up();
  await expect(labelDesignPanel).toHaveCount(0);
  await page.getByRole("button", { name: "展开设计助手" }).click();
  const promptInput = page.getByRole("textbox", { name: "编辑描述" });
  const generateButton = page.getByRole("button", {
    name: "发送",
    exact: true,
  });
  const agentPanel = page.getByRole("complementary", {
    name: "设计助手",
  });
  await promptInput.fill("保留便签约束的利落廓形外套");
  await expect(generateButton).toBeEnabled();
  await generateButton.click();
  await expect(agentPanel).toContainText("已按选中约束生成候选。");

  await expect(
    page.getByRole("complementary", { name: "生成任务托盘" }),
  ).toHaveCount(0);
  await expect(
    agentPanel.getByRole("region", { name: "本轮生成候选" }),
  ).toBeVisible();
  await expect(agentPanel).toContainText("成图已放到画布");
  await expect(
    agentPanel.locator('img[src="https://assets.example/generated-look.png"]'),
  ).toHaveCount(1);

  await expect(
    page.locator('img[src="https://assets.example/generated-look.png"]'),
  ).not.toHaveCount(0);
  await expect
    .poll(() => persistedAssetId, { timeout: 5_000 })
    .toBe("asset-e2e-1");
  await expect.poll(() => persistedRole).toBe("garment_ref");
  await expect.poll(() => candidateDisposition).toBe("adopted");

  await page.getByRole("button", { name: "打开历史" }).click();
  const generationHistory = page.getByRole("region", { name: "历史记录" });
  await generationHistory.getByRole("tab", { name: "生成" }).click();
  await expect(
    generationHistory.locator(
      'img[src="https://assets.example/generated-look.png"]',
    ),
  ).toHaveCount(1);
  await generationHistory.getByRole("button", { name: "返回对话" }).click();

  await page.getByRole("button", { name: "导出", exact: true }).click();
  const exportOptions = page.getByRole("region", { name: "导出选项" });
  await expect(exportOptions).toContainText("将画布中的全部 2 个元素导出");
  await expect(
    exportOptions.getByRole("button", { name: "下载整个画布" }),
  ).toBeEnabled();

  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "生成任务托盘" }),
  ).toHaveCount(0);
  await expect(
    page.locator('img[src="https://assets.example/generated-look.png"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开历史" }).click();
  const restoredHistory = page.getByRole("region", { name: "历史记录" });
  await restoredHistory.getByRole("tab", { name: "生成" }).click();
  await expect(
    restoredHistory.locator(
      'img[src="https://assets.example/generated-look.png"]',
    ),
  ).toHaveCount(0);
});
