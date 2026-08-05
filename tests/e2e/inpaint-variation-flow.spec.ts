import { expect, test } from "@playwright/test";

test("Lightbox 掩码可撤销并提交 inpaint，变体使用连续 seed", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  const taskDetails = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  let sourceTaskReads = 0;
  let uploadedMaskBytes = 0;
  let rejectedInpaintOnce = false;

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 20, used: 80 },
        user: {
          authId: "auth-e2e",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "atelier@example.com",
          id: "user-e2e",
          name: "Atelier E2E",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-inpaint", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-inpaint",
        name: "E2E 局部编辑项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-inpaint", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/projects/e2e-inpaint/board", async (route) => {
    await route.fulfill(
      route.request().method() === "PATCH"
        ? {
            json: {
              batchId: "e2e-board-save",
              revision: 1,
              savedAt: "2026-07-27T08:00:02.000Z",
            },
          }
        : { json: { elements: [], revision: 0, snapshot: null } },
    );
  });
  await page.route("**/api/generations/masks/sign", async (route) => {
    const body = route.request().postDataJSON() as { readonly sha256: string };
    expect(body.sha256).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    await route.fulfill({
      json: {
        expiresAt: "2026-07-27T09:00:00.000Z",
        maskId: "mask-e2e",
        maskUrl: "https://signed.example/mask-e2e.png?read=1",
        upload: {
          headers: {
            "Content-Type": "image/png",
            "x-amz-checksum-sha256": body.sha256,
          },
          method: "PUT",
          url: "https://signed.example/mask-e2e.png?write=1",
        },
      },
    });
  });
  await page.route(
    "https://signed.example/mask-e2e.png?write=1",
    async (route) => {
      uploadedMaskBytes = route.request().postDataBuffer()?.byteLength ?? 0;
      await route.fulfill({ status: 200 });
    },
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(/\/api\/generations$/u, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const taskType = String(body.taskType);
    if (taskType === "inpaint" && !rejectedInpaintOnce) {
      rejectedInpaintOnce = true;
      await route.fulfill({
        status: 503,
        json: { message: "模拟局部重绘创建失败" },
      });
      return;
    }
    requests.push(body);
    sequence += 1;
    const id =
      taskType === "t2i" ? "task-source" : `task-${taskType}-${sequence}`;
    const imageUrl =
      taskType === "t2i"
        ? "https://assets.example/source.png"
        : taskType === "inpaint"
          ? "https://assets.example/inpaint.png"
          : `https://assets.example/variation-${sequence}.png`;
    const timestamp = new Date(
      Date.parse("2026-07-27T08:00:00.000Z") + sequence * 1000,
    ).toISOString();
    taskDetails.set(id, {
      createdAt: timestamp,
      error: null,
      id,
      output: {
        images: [{ height: 1024, url: imageUrl, width: 768 }],
        seed: typeof body.seed === "number" ? body.seed : 700,
      },
      status: "succeeded",
      updatedAt: timestamp,
    });
    await route.fulfill({ status: 202, json: { task_id: id } });
  });
  await page.route(/\/api\/generations\/[^/]+\/events$/u, async (route) => {
    const taskId = new URL(route.request().url()).pathname.split("/").at(-2);
    if (taskId === "task-source") {
      await route.abort("connectionfailed");
      return;
    }
    const detail = taskId ? taskDetails.get(taskId) : undefined;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: generation\n" +
        `data: ${JSON.stringify({
          status: "succeeded",
          taskId,
          timestamp: detail?.updatedAt,
        })}\n\n`,
    });
  });
  await page.route(/\/api\/generations\/[^/]+$/u, async (route) => {
    const taskId = new URL(route.request().url()).pathname.split("/").at(-1);
    const detail = taskDetails.get(taskId ?? "");
    if (taskId === "task-source" && detail) {
      sourceTaskReads += 1;
      const completed = sourceTaskReads >= 3;
      await route.fulfill({
        json: {
          ...detail,
          output: completed ? detail.output : null,
          status: completed ? "succeeded" : "running",
        },
      });
      return;
    }
    await route.fulfill({ json: detail });
  });
  await page.route("https://assets.example/*.png", async (route) => {
    const isInpaint = route.request().url().includes("inpaint");
    await route.fulfill({
      contentType: "image/svg+xml",
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">' +
        `<rect width="768" height="1024" fill="${isInpaint ? "#b97962" : "#c8b79f"}"/>` +
        '<path d="M240 180h288l80 680H160z" fill="#39443e"/>' +
        "</svg>",
    });
  });

  await page.goto("/e2e-inpaint");
  await page.getByLabel("选择要上传的图片").setInputFiles({
    buffer: Buffer.from("not-an-image"),
    mimeType: "text/plain",
    name: "设计说明.txt",
  });
  const uploadTray = page.getByRole("complementary", {
    name: "图片上传状态",
  });
  await expect(uploadTray).toContainText("仅支持 JPG、PNG、WebP 或 HEIC 图片");
  await uploadTray.getByRole("button", { name: "移除“设计说明.txt”" }).click();
  await expect(uploadTray).toBeHidden();

  await page.getByRole("button", { name: "便签" }).click();
  await page
    .getByRole("textbox", { name: "设计描述" })
    .fill("结构清晰的短款外套");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByText("实时连接中断 · 轮询同步")).toBeVisible({
    timeout: 12_000,
  });
  await expect(
    page.locator('img[src="https://assets.example/source.png"]'),
  ).toBeVisible();
  expect(sourceTaskReads).toBeGreaterThanOrEqual(3);

  const sourceCard = page.locator("article").filter({
    has: page.locator('img[src="https://assets.example/source.png"]'),
  });
  await page.setViewportSize({ height: 844, width: 390 });
  const [agentBox, candidateDockBox] = await Promise.all([
    page.getByRole("complementary", { name: "AI 设计助手" }).boundingBox(),
    page.getByRole("region", { name: "生成候选" }).boundingBox(),
  ]);
  if (!agentBox || !candidateDockBox) {
    throw new Error("移动端 Agent 生成记录未完整渲染");
  }
  expect(Math.round(agentBox.x + agentBox.width)).toBe(390);
  expect(candidateDockBox.x).toBeGreaterThanOrEqual(agentBox.x);
  await page.getByRole("button", { name: "折叠 AI 设计助手" }).click();
  await expect(page.getByRole("region", { name: "设计面板" })).toBeVisible();
  await page.setViewportSize({ height: 720, width: 1280 });
  await page.getByRole("button", { name: "展开 AI 设计助手" }).click();

  const openDetails = sourceCard.getByRole("button", {
    name: "打开候选详情",
  });
  await openDetails.click();
  const lightboxDialog = page.getByRole("dialog", {
    name: "候选设计详情",
  });
  await expect(lightboxDialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "生成 3 个变体" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "预览" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lightboxDialog).toBeHidden();
  await expect(openDetails).toBeFocused();

  await openDetails.click();
  await page.getByRole("button", { name: "生成 3 个变体" }).click();
  await expect
    .poll(() => requests.filter((body) => body.taskType === "i2i").length)
    .toBe(3);
  expect(
    requests
      .filter((body) => body.taskType === "i2i")
      .map((body) => body.seed)
      .sort(),
  ).toEqual([701, 702, 703]);
  await page.getByRole("button", { name: "关闭候选详情" }).click();

  await sourceCard.getByRole("button", { name: "局部改" }).click();
  await page
    .getByRole("textbox", { name: "局部重绘说明" })
    .fill("将领口改成窄驳领，保持原有面料");
  await page.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(
    page.getByText("掩码为空，请先涂抹需要重绘的区域"),
  ).toBeVisible();

  const canvas = page.getByLabel("局部重绘掩码画布");
  const addCenterRegion = page.getByRole("button", {
    name: "标记中央区域",
  });
  await addCenterRegion.focus();
  await page.keyboard.press("Enter");
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  await page.getByRole("button", { name: "清空" }).click();
  await expect(canvas).toHaveAttribute("data-stroke-count", "0");

  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await canvas.click({
    position: { x: bounds.width * 0.35, y: bounds.height * 0.35 },
  });
  await canvas.click({
    position: { x: bounds.width * 0.55, y: bounds.height * 0.5 },
  });
  await expect(canvas).toHaveAttribute("data-stroke-count", "2");
  await page.getByRole("button", { name: "撤销一笔" }).click();
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");

  await page.getByLabel("掩码画笔尺寸").fill("0.16");
  await page.mouse.move(
    bounds.x + bounds.width * 0.28,
    bounds.y + bounds.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.7,
    {
      steps: 18,
    },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "提交局部重绘" }).click();
  const candidateDialog = page.getByRole("dialog", {
    name: "候选设计详情",
  });
  await expect(candidateDialog.getByRole("alert")).toContainText(
    "模拟局部重绘创建失败",
  );
  await expect(candidateDialog).toBeVisible();
  await page.getByRole("button", { name: "提交局部重绘" }).click();

  await expect.poll(() => uploadedMaskBytes).toBeGreaterThan(100);
  await expect
    .poll(() => requests.filter((body) => body.taskType === "inpaint").length)
    .toBe(1);
  expect(requests.find((body) => body.taskType === "inpaint")).toMatchObject({
    maskImageUrl: "https://signed.example/mask-e2e.png?read=1",
    referenceImageUrl: "https://assets.example/source.png",
    taskType: "inpaint",
  });
  await expect(
    page.locator('img[src="https://assets.example/inpaint.png"]'),
  ).toBeVisible();
});
