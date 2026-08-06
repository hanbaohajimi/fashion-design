import { expect, test } from "@playwright/test";

test("从 Hero 建系列、锁定色板、扩展到 3 个 Look 并查看参考相似度", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const createdAt = "2026-07-28T10:00:00.000Z";
  let lookCount = 1;
  let paletteLocked = false;
  let signatureDetails: readonly string[] = [];
  let sourceGarmentType: {
    readonly code: string;
    readonly label: string;
  } | null = {
    code: "jacket",
    label: "夹克",
  };
  let collectionCreated = false;
  let collectionListAvailable = false;
  let consistencyAvailable = false;
  const ignoredAssets = new Set<string>();
  const dna = () => ({
    extractionStatus: "ready",
    fabrics: ["哑光皮革", "欧根纱"],
    locks: {
      fabrics: false,
      moodWords: false,
      palette: paletteLocked,
      silhouettes: false,
    },
    moodWords: ["克制", "未来感"],
    palette: [
      { hex: "#20262B", name: "深石墨" },
      { hex: "#E6D8C6", name: "暖象牙" },
    ],
    referenceFileIds: [],
    signatureDetails,
    silhouettes: ["茧型", "低腰直筒"],
    updatedAt: createdAt,
  });
  const collection = () => ({
    createdAt,
    dna: dna(),
    hero: {
      assetId: "asset-hero",
      thumbnailUrl: "https://assets.example/collection-look-1.png",
      url: "https://assets.example/collection-look-1.png",
    },
    id: "collection-e2e",
    name: "系列 · HERO",
    projectId: "e2e-collection",
    sourceGarmentType,
    updatedAt: createdAt,
  });
  await page.route("**/api/projects/e2e-collection", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt,
        id: "e2e-collection",
        name: "E2E 系列项目",
        updatedAt: createdAt,
      },
    }),
  );
  await page.route(
    "**/api/collections?projectId=e2e-collection",
    async (route) => {
      if (!collectionListAvailable) {
        await route.fulfill({
          status: 503,
          json: { message: "模拟系列列表暂时不可用" },
        });
        return;
      }
      await route.fulfill({ json: collectionCreated ? [collection()] : [] });
    },
  );
  const consistency = () => {
    const looks = [
      {
        analysisStatus: "ready",
        assetId: "asset-hero",
        isHero: true,
        ordinal: 1,
        similarityScore: lookCount === 1 ? null : lookCount === 2 ? 0.96 : 0.44,
        thumbnailUrl: "https://assets.example/collection-look-1.png",
        url: "https://assets.example/collection-look-1.png",
        variationAxis: null,
        warningIgnored: false,
      },
      {
        analysisStatus: "ready",
        assetId: "asset-look-2",
        isHero: false,
        ordinal: 2,
        similarityScore: lookCount < 2 ? null : lookCount === 2 ? 0.96 : 0.52,
        thumbnailUrl: "https://assets.example/collection-look-2.png",
        url: "https://assets.example/collection-look-2.png",
        variationAxis: "detail",
        warningIgnored: ignoredAssets.has("asset-look-2"),
      },
      {
        analysisStatus: "ready",
        assetId: "asset-look-3",
        isHero: false,
        ordinal: 3,
        similarityScore: 0.44,
        thumbnailUrl: "https://assets.example/collection-look-3.png",
        url: "https://assets.example/collection-look-3.png",
        variationAxis: "detail",
        warningIgnored: ignoredAssets.has("asset-look-3"),
      },
    ].slice(0, lookCount);
    const similarities = [
      {
        leftAssetId: "asset-hero",
        rightAssetId: "asset-look-2",
        score: 0.96,
      },
      {
        leftAssetId: "asset-hero",
        rightAssetId: "asset-look-3",
        score: 0.44,
      },
      {
        leftAssetId: "asset-look-2",
        rightAssetId: "asset-look-3",
        score: 0.52,
      },
    ].filter(
      (pair) =>
        looks.some((look) => look.assetId === pair.leftAssetId) &&
        looks.some((look) => look.assetId === pair.rightAssetId),
    );
    return { looks, referenceLabel: "参考相似度", similarities };
  };

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 12, used: 88 },
        user: {
          authId: "auth-collection",
          avatar: null,
          createdAt,
          deletedAt: null,
          email: "collection@example.com",
          id: "user-collection",
          name: "Collection Atelier",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-collection/board", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? {
              batchId: "e2e-board-save",
              revision: 1,
              savedAt: "2026-07-27T08:00:02.000Z",
            }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    "**/api/projects/e2e-collection/agent-conversations*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              archivedAt: null,
              createdAt,
              id: "conversation-collection",
              messageCount: 0,
              projectId: "e2e-collection",
              title: "新的设计对话",
              updatedAt: createdAt,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.route(
    "**/api/agent-conversations/conversation-collection/messages*",
    async (route) => {
      if (route.request().method() !== "POST") {
        return route.fulfill({ json: { items: [], nextCursor: null } });
      }
      const body = route.request().postDataJSON() as {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      };
      const userMessage = {
        clientRequestId: body.clientRequestId,
        content: body.content,
        context: { fileAssetIds: [], shapeIds: body.shapeIds },
        createdAt,
        error: null,
        generationTaskId: null,
        id: "user-collection",
        replyToId: null,
        role: "user",
        status: "completed",
        updatedAt: createdAt,
      };
      const assistantMessage = {
        ...userMessage,
        clientRequestId: null,
        content: "已生成系列 Hero。",
        generationTaskId: "task-hero",
        id: "assistant-collection",
        replyToId: userMessage.id,
        role: "assistant",
      };
      return route.fulfill({
        json: { assistantMessage, taskId: "task-hero", userMessage },
        status: 201,
      });
    },
  );
  await page.route(/\/api\/generations$/u, (route) =>
    route.fulfill({ status: 202, json: { task_id: "task-hero" } }),
  );
  await page.route("**/api/generations/task-hero/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: generation\n" +
        `data: ${JSON.stringify({
          status: "succeeded",
          taskId: "task-hero",
          timestamp: createdAt,
        })}\n\n`,
    }),
  );
  await page.route("**/api/generations/task-hero", (route) =>
    route.fulfill({
      json: {
        createdAt,
        error: null,
        id: "task-hero",
        request: {
          cfg: 3.5,
          height: 1024,
          projectId: "e2e-collection",
          prompt: "作为系列 Hero 的克制廓形",
          shapeIds: [],
          steps: 28,
          taskType: "t2i",
          width: 768,
        },
        output: {
          images: [
            {
              assetId: "asset-hero",
              height: 1024,
              url: "https://assets.example/collection-look-1.png",
              width: 768,
            },
          ],
        },
        status: "succeeded",
        updatedAt: createdAt,
      },
    }),
  );
  await page.route(/\/api\/generations\/task-look-\d+$/u, (route) =>
    route.fulfill({
      json: {
        createdAt,
        error: null,
        id: new URL(route.request().url()).pathname.split("/").at(-1),
        output: {},
        status: "succeeded",
        updatedAt: createdAt,
      },
    }),
  );
  await page.route("**/api/collections", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    collectionCreated = true;
    await route.fulfill({ status: 201, json: collection() });
  });
  await page.route(
    "**/api/collections/collection-e2e/consistency",
    async (route) => {
      if (!consistencyAvailable) {
        await route.fulfill({
          status: 503,
          json: { message: "模拟一致性暂时不可用" },
        });
        return;
      }
      await route.fulfill({ json: consistency() });
    },
  );
  await page.route("**/api/collections/collection-e2e/dna", async (route) => {
    const body = route.request().postDataJSON() as {
      readonly locks?: { readonly palette?: boolean };
      readonly signatureDetails?: readonly string[];
    };
    paletteLocked = body.locks?.palette ?? paletteLocked;
    signatureDetails = body.signatureDetails ?? signatureDetails;
    await route.fulfill({ json: dna() });
  });
  await page.route("**/api/collections/collection-e2e/looks", (route) => {
    lookCount = Math.min(3, lookCount + 1);
    return route.fulfill({
      status: 202,
      json: { task_id: `task-look-${lookCount}` },
    });
  });
  await page.route(
    "**/api/collections/collection-e2e/looks/*/keep",
    async (route) => {
      const assetId = new URL(route.request().url()).pathname.split("/").at(-2);
      if (assetId) ignoredAssets.add(assetId);
      const look = consistency().looks.find((item) => item.assetId === assetId);
      await route.fulfill({ json: look });
    },
  );
  await page.route("**/api/collections/collection-e2e", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        readonly sourceGarmentType?: typeof sourceGarmentType;
      };
      sourceGarmentType = body.sourceGarmentType ?? null;
    }
    await route.fulfill({ json: collection() });
  });
  await page.route("**/api/exports/capabilities", (route) =>
    route.fulfill({
      json: {
        downloadLinkHours: 24,
        freeMaxEdge: 1600,
        highResolutionAllowed: false,
        plan: "free",
        watermark: true,
      },
    }),
  );
  await page.route("**/api/exports/export-pdf-e2e", (route) =>
    route.fulfill({
      json: {
        completedAt: createdAt,
        createdAt,
        downloadUrl: "https://download.example/lookbook.pdf?signature=e2e",
        error: null,
        expiresAt: "2026-07-29T10:00:00.000Z",
        fileName: "series-lookbook.pdf",
        format: "pdf",
        id: "export-pdf-e2e",
        maxEdge: 1600,
        mimeType: "application/pdf",
        quality: "standard",
        retryAllowed: false,
        sizeBytes: 524288,
        status: "succeeded",
        watermark: true,
      },
    }),
  );
  await page.route("**/api/exports", (route) =>
    route.fulfill({
      status: 202,
      json: {
        completedAt: null,
        createdAt,
        error: null,
        expiresAt: null,
        fileName: null,
        format: "pdf",
        id: "export-pdf-e2e",
        maxEdge: 1600,
        mimeType: "application/pdf",
        quality: "standard",
        sizeBytes: null,
        status: "queued",
        watermark: true,
      },
    }),
  );
  await page.route("https://assets.example/collection-look-*.png", (route) => {
    const lookNumber =
      route
        .request()
        .url()
        .match(/look-(\d)/u)?.[1] ?? "1";
    const colors = {
      "1": ["#d8c8b5", "#2d3433"],
      "2": ["#d2c3ad", "#3a4240"],
      "3": ["#b6c2b0", "#783f31"],
    } as const;
    const [background, garment] =
      colors[lookNumber as keyof typeof colors] ?? colors["1"];
    return route.fulfill({
      contentType: "image/svg+xml",
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">' +
        `<rect width="768" height="1024" fill="${background}"/>` +
        `<path d="M230 160h308l78 720H152z" fill="${garment}"/>` +
        "</svg>",
    });
  });

  await page.goto("/e2e-collection");
  await page.getByRole("button", { name: "打开系列工作台" }).click();
  const retryCollections = page.getByRole("button", { name: "重试" });
  await expect(retryCollections).toBeVisible({ timeout: 10_000 });
  collectionListAvailable = true;
  await retryCollections.click();
  await expect(page.getByText("暂无系列", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭系列入口" }).click();

  await page.getByRole("button", { name: "便签" }).click();
  await page.getByRole("button", { name: "展开设计助手" }).click();
  await page
    .getByRole("textbox", { name: "编辑描述" })
    .fill("作为系列 Hero 的克制廓形");
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await page.getByRole("button", { name: "打开候选详情" }).click();
  await page.getByRole("button", { name: "设为 Hero → 建系列" }).click();

  const collectionDrawer = page.getByRole("dialog", { name: "系列 DNA" });
  await expect(page.getByText("Hero 已锁定为系列原点")).toBeVisible();
  await expect(collectionDrawer).toBeFocused();
  const retryConsistency = collectionDrawer.getByRole("button", {
    name: "重新读取一致性",
  });
  await expect(retryConsistency).toBeVisible();
  consistencyAvailable = true;
  await retryConsistency.click();
  await expect(retryConsistency).toBeHidden();
  const sourceTypeSelect = collectionDrawer.getByRole("combobox", {
    name: "服装类型",
  });
  await expect(sourceTypeSelect).toHaveValue("jacket");
  await sourceTypeSelect.selectOption("custom");
  const customSourceType =
    collectionDrawer.getByPlaceholder("输入团队使用的服装类型");
  await customSourceType.fill("斗篷式上装");
  await customSourceType.press("Tab");
  await expect.poll(() => sourceGarmentType?.label).toBe("斗篷式上装");
  await collectionDrawer
    .getByRole("combobox", { name: "服装类型" })
    .selectOption("jacket");
  await expect.poll(() => sourceGarmentType?.code).toBe("jacket");

  const signatureDetailsEditor = collectionDrawer.getByLabel(
    "需要跨品类保留的细节，以逗号或换行分隔",
  );
  await signatureDetailsEditor.fill("模块化口袋，弧形分割线，金属扣件");
  await expect
    .poll(() => signatureDetails.join("，"))
    .toBe("模块化口袋，弧形分割线，金属扣件");
  const paletteSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "色板" }) });
  await paletteSection.getByRole("button", { name: "锁定" }).click();
  await expect(
    paletteSection.getByRole("button", { name: "解锁" }),
  ).toBeVisible();
  await expect(page.getByLabel("系列 DNA").getByText("已保存")).toBeVisible();

  await page.getByRole("button", { name: "Look 扩展" }).click();
  await expect(page.getByLabel("系列款数")).toHaveValue("8");
  const seriesBrief = collectionDrawer.getByLabel("系列开发目标");
  await seriesBrief.fill("早秋城市通勤，面向需要轻量叠穿的创意从业者");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem(
          "fashion:series-plan:v1:collection-e2e",
        );
        return raw
          ? (JSON.parse(raw) as { readonly brief?: string }).brief
          : null;
      }),
    )
    .toBe("早秋城市通勤，面向需要轻量叠穿的创意从业者");
  await expect(
    collectionDrawer.getByLabel("品类结构分析"),
  ).toContainText("8 款品类结构");
  await expect(
    collectionDrawer.getByText("品类结构覆盖完整"),
  ).toBeVisible();
  await expect(
    collectionDrawer
      .locator("article")
      .filter({ hasText: "系列原点" })
      .getByText("夹克", { exact: true }),
  ).toBeVisible();
  await expect(
    collectionDrawer.getByRole("button", { name: "生成此款" }),
  ).toHaveCount(7);
  await collectionDrawer.getByLabel("选择 上装 01").uncheck();
  await expect(
    collectionDrawer.getByRole("button", { name: "生成选中 6 款" }),
  ).toBeVisible();
  await collectionDrawer.getByRole("button", { name: "添加槽位" }).click();
  await expect(
    collectionDrawer.getByRole("button", { name: "生成此款" }),
  ).toHaveCount(8);
  await collectionDrawer
    .getByRole("button", { name: /^删除/u })
    .last()
    .click();
  await expect(
    collectionDrawer.getByRole("button", { name: "生成此款" }),
  ).toHaveCount(7);
  const firstSlotType = collectionDrawer
    .getByRole("combobox", { name: "服装类型" })
    .first();
  await firstSlotType.selectOption("custom");
  const customSlotType = collectionDrawer.getByPlaceholder("输入服装类型");
  await customSlotType.fill("可拆卸披肩");
  await page.getByLabel("系列款数").fill("12");
  await expect(
    collectionDrawer.getByRole("button", { name: "生成此款" }),
  ).toHaveCount(11);
  await page.getByLabel("系列款数").fill("2");
  await expect(
    collectionDrawer.getByRole("button", { name: "生成此款" }),
  ).toHaveCount(1);
  await expect(customSlotType).toHaveValue("可拆卸披肩");
  await page.getByLabel("系列款数").fill("8");
  await expect(seriesBrief).toHaveValue(
    "早秋城市通勤，面向需要轻量叠穿的创意从业者",
  );
  await page.screenshot({ path: "output/playwright/series-plan-desktop.png" });
  const desktopViewport = page.viewportSize() ?? { height: 720, width: 1280 };
  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "output/playwright/series-plan-mobile.png" });
  await page.setViewportSize(desktopViewport);
  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  await page.getByRole("button", { name: "打开系列 DNA" }).click();
  await page.getByRole("button", { name: "Look 扩展" }).click();
  await expect(collectionDrawer.getByLabel("系列开发目标")).toHaveValue(
    "早秋城市通勤，面向需要轻量叠穿的创意从业者",
  );
  await page.getByRole("button", { name: "单 Look 扩展" }).click();
  await page.getByText("细节", { exact: true }).click();
  await page.getByRole("button", { name: /沿「细节」扩展 Look/u }).click();
  await expect(page.getByText("2 LOOKS")).toBeVisible();
  await expect(page.getByText("与 Look1 高度相似")).toBeVisible();

  await page.getByRole("button", { name: /沿「细节」扩展 Look/u }).click();
  await expect(page.getByText("3 LOOKS")).toBeVisible();
  const thirdLook = page.locator("article").filter({ hasText: "LOOK 3" });
  await expect(thirdLook.getByText("偏离系列参考区间")).toBeVisible();
  await thirdLook.getByRole("button", { name: "忽略提示并强制保留" }).click();
  await expect(thirdLook.getByText("已忽略提示并保留")).toBeVisible();

  await page.getByRole("button", { name: "一致性", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "系列 Look 参考相似度矩阵" }),
  ).toBeVisible();
  await expect(page.getByText("参考相似度", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0.44" }).first()).toBeVisible();

  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  const reopenCollection = page.getByRole("button", {
    name: "打开系列 DNA",
  });
  await expect(reopenCollection).toBeFocused();
  await reopenCollection.click();
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "色板" }) })
      .getByRole("button", { name: "解锁" }),
  ).toBeVisible();

  const exportTrigger = page.getByRole("button", { name: "导出 PDF" });
  await exportTrigger.click();
  const exportDialog = page.getByRole("dialog", { name: "导出成果" });
  await expect(exportDialog).toBeFocused();
  await expect(page.getByText("Free 版本带水印。")).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "开始导出" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "关闭导出窗口" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(exportDialog).toBeHidden();
  await expect(exportTrigger).toBeFocused();

  await exportTrigger.click();
  await expect(page.getByText("Free 版本带水印。")).toBeVisible();
  await page.getByRole("button", { name: "开始导出" }).click();
  await expect(page.getByRole("link", { name: "下载 PDF" })).toHaveAttribute(
    "href",
    "https://download.example/lookbook.pdf?signature=e2e",
  );
  await page.getByRole("button", { name: "关闭导出窗口" }).click();
  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  await page.getByRole("button", { name: "关闭候选详情" }).click();
  await page.getByRole("button", { name: "关闭设计助手" }).click();
  await page.getByRole("button", { name: "打开系列工作台" }).click();
  const collectionEntry = page.getByRole("button", {
    name: "打开系列 系列 · HERO",
  });
  await expect(collectionEntry).toContainText("夹克");
  await expect(collectionEntry).toContainText("DNA 已就绪");
  await page.screenshot({
    path: "output/playwright/series-library-desktop.png",
  });
  const libraryDesktopViewport = page.viewportSize() ?? {
    height: 720,
    width: 1280,
  };
  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await expect(collectionEntry).toBeVisible();
  await page.screenshot({
    path: "output/playwright/series-library-mobile.png",
  });
  await page.setViewportSize(libraryDesktopViewport);
  await collectionEntry.click();
  await expect(page.getByText("Hero 已锁定为系列原点")).toBeVisible();
});
