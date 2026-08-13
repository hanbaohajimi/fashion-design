import { expect, test } from "@playwright/test";

test("打开系列、定义 DNA 并按服装类型多次生成", async ({ page }) => {
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
  let collectionCreated = true;
  let consistencyAvailable = false;
  const lookRequests: Array<{
    readonly garmentType: { readonly code: string; readonly label: string };
    readonly slotKey: string;
    readonly variationAxis: string;
  }> = [];
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
  await page.route("**/api/collections?projectId=e2e-collection", (route) =>
    route.fulfill({ json: collectionCreated ? [collection()] : [] }),
  );
  const consistency = () => {
    const looks = [
      {
        analysisStatus: "ready",
        assetId: "asset-hero",
        garmentType: sourceGarmentType,
        isHero: true,
        ordinal: 1,
        similarityScore: lookCount === 1 ? null : lookCount === 2 ? 0.96 : 0.44,
        slotKey: null,
        thumbnailUrl: "https://assets.example/collection-look-1.png",
        url: "https://assets.example/collection-look-1.png",
        variationAxis: null,
        warningIgnored: false,
      },
      {
        analysisStatus: "ready",
        assetId: "asset-look-2",
        garmentType: lookRequests[0]?.garmentType ?? null,
        isHero: false,
        ordinal: 2,
        similarityScore: lookCount < 2 ? null : lookCount === 2 ? 0.96 : 0.52,
        slotKey: lookRequests[0]?.slotKey ?? null,
        thumbnailUrl: "https://assets.example/collection-look-2.png",
        url: "https://assets.example/collection-look-2.png",
        variationAxis: "detail",
        warningIgnored: ignoredAssets.has("asset-look-2"),
      },
      {
        analysisStatus: "ready",
        assetId: "asset-look-3",
        garmentType: lookRequests[1]?.garmentType ?? null,
        isHero: false,
        ordinal: 3,
        similarityScore: 0.44,
        slotKey: lookRequests[1]?.slotKey ?? null,
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
    (() => {
      const taskId = new URL(route.request().url()).pathname.split("/").at(-1);
      const lookNumber = taskId?.split("-").at(-1) ?? "2";
      return route.fulfill({
        json: {
          createdAt,
          error: null,
          id: taskId,
          output: {
            images: [
              {
                assetId: `asset-look-${lookNumber}`,
                height: 1024,
                url: `https://assets.example/collection-look-${lookNumber}.png`,
                width: 768,
              },
            ],
          },
          request: {
            cfg: 7,
            height: 1024,
            projectId: "e2e-collection",
            prompt: `系列 Look ${lookNumber}`,
            shapeIds: [],
            steps: 28,
            taskType: "i2i",
            width: 768,
          },
          status: "succeeded",
          taskType: "i2i",
          updatedAt: createdAt,
        },
      });
    })(),
  );
  await page.route(
    /\/api\/generations\/task-look-\d+\/candidates\/0$/u,
    (route) => {
      const taskId = new URL(route.request().url()).pathname.split("/").at(-3);
      const lookNumber = taskId?.split("-").at(-1) ?? "2";
      return route.fulfill({
        json: {
          createdAt,
          error: null,
          id: taskId,
          output: {
            candidateDispositions: { "0": "adopted" },
            images: [
              {
                assetId: `asset-look-${lookNumber}`,
                height: 1024,
                url: `https://assets.example/collection-look-${lookNumber}.png`,
                width: 768,
              },
            ],
          },
          request: {
            cfg: 7,
            height: 1024,
            projectId: "e2e-collection",
            prompt: `系列 Look ${lookNumber}`,
            shapeIds: [],
            steps: 28,
            taskType: "i2i",
            width: 768,
          },
          status: "succeeded",
          taskType: "i2i",
          updatedAt: createdAt,
        },
      });
    },
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
  await page.route("**/api/collections/collection-e2e/looks", async (route) => {
    const body = route.request().postDataJSON() as {
      readonly garmentType: { readonly code: string; readonly label: string };
      readonly slotKey: string;
      readonly variationAxis: string;
    };
    lookRequests.push(body);
    lookCount = Math.min(3, lookCount + 1);
    await route.fulfill({
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
  await page.getByRole("button", { name: "打开系列 系列 · HERO" }).click();

  const collectionDrawer = page.getByRole("dialog", { name: "系列 DNA" });
  await expect(page.getByText("系列原点", { exact: true })).toBeVisible();
  await expect(collectionDrawer).toBeFocused();
  consistencyAvailable = true;
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
  const retrySeriesState = collectionDrawer.getByRole("button", {
    name: "重新读取系列状态",
  });
  await retrySeriesState.click();
  await expect(retrySeriesState).toBeHidden();
  const garmentTypeSelect = collectionDrawer.getByRole("combobox", {
    name: "服装类型",
  });
  const generateLook = collectionDrawer.getByRole("button", {
    name: "生成",
    exact: true,
  });
  await expect(garmentTypeSelect).toHaveCount(1);
  await garmentTypeSelect.selectOption("dress");
  await generateLook.click();
  await expect.poll(() => lookRequests).toHaveLength(1);
  expect(lookRequests[0]).toMatchObject({
    garmentType: { code: "dress", label: "连衣裙" },
    variationAxis: "garmentType",
  });
  expect(lookRequests[0]?.slotKey).toMatch(/^manual-/u);
  await expect(
    collectionDrawer.locator("figcaption").getByText("连衣裙", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(
      'img[src="https://assets.example/collection-look-2.png"]',
    ),
  ).toHaveCount(2);

  await garmentTypeSelect.selectOption("coat");
  await generateLook.click();
  await expect.poll(() => lookRequests).toHaveLength(2);
  expect(lookRequests[1]).toMatchObject({
    garmentType: { code: "coat", label: "大衣" },
    variationAxis: "garmentType",
  });
  expect(lookRequests[1]?.slotKey).toMatch(/^manual-/u);
  expect(lookRequests[1]?.slotKey).not.toBe(lookRequests[0]?.slotKey);
  await expect(
    collectionDrawer.locator("figcaption").getByText("大衣", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(
      'img[src="https://assets.example/collection-look-3.png"]',
    ),
  ).toHaveCount(2);

  for (const removedText of [
    "系列款数",
    "系列开发目标",
    "款式名称",
    "设计方向",
    "选择全部待生成款",
    "添加款式",
    "生成此款",
  ]) {
    await expect(
      collectionDrawer.getByText(removedText, { exact: true }),
    ).toHaveCount(0);
  }
  await page.screenshot({
    path: "output/playwright/look-generator-desktop.png",
  });
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
  await page.screenshot({
    path: "output/playwright/look-generator-mobile.png",
  });
  await expect(
    collectionDrawer.getByRole("combobox", { name: "服装类型" }),
  ).toHaveCount(1);
  await expect(
    collectionDrawer.getByRole("button", { name: "单 Look 扩展" }),
  ).toHaveCount(0);
  await expect(
    collectionDrawer.getByRole("button", { name: "一致性", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize(desktopViewport);
});
