import { expect, test } from "@playwright/test";

test("画布成衣可提交局部重绘并获得明确反馈", async ({ page }) => {
  test.setTimeout(60_000);
  const requests: Record<string, unknown>[] = [];
  const taskDetails = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  let sourceTaskReads = 0;
  let inpaintTaskReads = 0;
  let linkedInpaintTaskId: string | undefined;
  let uploadedMaskBytes = 0;
  let uploadedMaskDimensions: { height: number; width: number } | null = null;
  let rejectedInpaintOnce = false;
  let rejectedInpaintRequest: Record<string, unknown> | undefined;

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
    const body = route.request().postDataJSON() as {
      readonly checksumSha256: string;
      readonly height: number;
      readonly width: number;
    };
    expect(body.checksumSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(body).toMatchObject({ height: 1024, width: 768 });
    await route.fulfill({
      json: {
        expiresAt: "2026-07-27T09:00:00.000Z",
        maskId: "mask-e2e",
        maskUrl: "https://signed.example/mask-e2e.png?read=1",
        upload: {
          headers: {
            "Content-Type": "image/png",
            "x-amz-checksum-sha256": body.checksumSha256,
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
      const png = route.request().postDataBuffer();
      uploadedMaskBytes = png?.byteLength ?? 0;
      if (png && png.byteLength >= 24) {
        uploadedMaskDimensions = {
          height: png.readUInt32BE(20),
          width: png.readUInt32BE(16),
        };
      }
      await route.fulfill({ status: 200 });
    },
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    "**/api/projects/e2e-inpaint/agent-conversations*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              archivedAt: null,
              createdAt: "2026-07-27T08:00:00.000Z",
              id: "conversation-inpaint",
              messageCount: 0,
              projectId: "e2e-inpaint",
              title: "新的设计对话",
              updatedAt: "2026-07-27T08:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.route(
    "**/api/agent-conversations/conversation-inpaint/messages*",
    async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: { items: [], nextCursor: null } });
      const body = route.request().postDataJSON() as {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      };
      const userMessage = {
        clientRequestId: body.clientRequestId,
        content: body.content,
        context: { fileAssetIds: [], shapeIds: body.shapeIds },
        createdAt: "2026-07-27T08:00:00.000Z",
        error: null,
        generationTaskId: null,
        id: "user-inpaint",
        replyToId: null,
        role: "user",
        status: "completed",
        updatedAt: "2026-07-27T08:00:00.000Z",
      };
      const assistantMessage = {
        ...userMessage,
        clientRequestId: null,
        content: "已生成基础方案。",
        generationTaskId: "task-source",
        id: "assistant-inpaint",
        replyToId: userMessage.id,
        role: "assistant",
      };
      taskDetails.set("task-source", {
        createdAt: "2026-07-27T08:00:00.000Z",
        error: null,
        id: "task-source",
        output: {
          images: [
            {
              assetId: "asset-source",
              height: 1024,
              url: "https://assets.example/source.png",
              width: 768,
            },
          ],
        },
        request: {
          height: 1024,
          projectId: "e2e-inpaint",
          prompt: body.content,
          shapeIds: body.shapeIds,
          taskType: "t2i",
          width: 768,
        },
        status: "succeeded",
        taskType: "t2i",
        updatedAt: "2026-07-27T08:00:00.000Z",
      });
      return route.fulfill({
        json: { assistantMessage, taskId: "task-source", userMessage },
        status: 201,
      });
    },
  );
  await page.route(
    "**/api/agent-conversations/conversation-inpaint/generation-tasks/*",
    async (route) => {
      linkedInpaintTaskId = new URL(route.request().url()).pathname
        .split("/")
        .at(-1);
      const body = route.request().postDataJSON() as {
        readonly content: string;
      };
      await route.fulfill({
        json: {
          clientRequestId: null,
          content: body.content,
          context: { fileAssetIds: [], shapeIds: [] },
          createdAt: "2026-07-27T08:00:03.000Z",
          error: null,
          generationTaskId: linkedInpaintTaskId,
          id: "assistant-inpaint-result",
          replyToId: null,
          role: "assistant",
          status: "completed",
          updatedAt: "2026-07-27T08:00:03.000Z",
        },
        status: 201,
      });
    },
  );
  await page.route(/\/api\/generations$/u, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const taskType = String(body.taskType);
    if (taskType === "inpaint" && !rejectedInpaintOnce) {
      rejectedInpaintOnce = true;
      rejectedInpaintRequest = body;
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
    if (taskId?.startsWith("task-inpaint-")) {
      inpaintTaskReads += 1;
    }
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
  await page.route(/\/api\/generations\/[^/]+\/candidates\/\d+$/u, (route) =>
    route.fulfill({ json: {}, status: 200 }),
  );
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

  await page.getByRole("button", { name: "添加色卡" }).click();
  await page.getByRole("button", { name: "便签" }).click();
  await page.getByRole("button", { name: "展开设计助手" }).click();
  await page
    .getByRole("textbox", { name: "编辑描述" })
    .fill("结构清晰的短款外套");
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  const boardCanvas = page.getByTestId("canvas");
  await expect(
    boardCanvas.locator('img[src="https://assets.example/source.png"]'),
  ).toBeVisible();
  expect(sourceTaskReads).toBeGreaterThanOrEqual(3);

  await page
    .getByRole("button", { name: "折叠设计助手" })
    .evaluate((button: HTMLButtonElement) => button.click());
  const sourceImage = boardCanvas.locator(
    'img[src="https://assets.example/source.png"]',
  );
  const sourceImageBounds = await sourceImage.boundingBox();
  expect(sourceImageBounds).not.toBeNull();
  if (!sourceImageBounds) return;
  await page.mouse.click(
    sourceImageBounds.x + sourceImageBounds.width / 2,
    sourceImageBounds.y + sourceImageBounds.height / 2,
  );
  await page.getByRole("button", { name: "局部更改成衣" }).click();
  await page
    .getByRole("textbox", { name: "局部重绘说明" })
    .fill("将领口改成窄驳领，保持原有面料");
  const usePalette = page.getByRole("switch", { name: "使用色卡" });
  await expect(usePalette).toBeEnabled();
  await expect(usePalette).not.toBeChecked();
  await page.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(page.getByText("请先涂抹需要修改的区域")).toBeVisible();

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
  expect(rejectedInpaintRequest).toBeDefined();
  expect(rejectedInpaintRequest).not.toHaveProperty("palette");
  await usePalette.check();
  const paletteOption = page.getByRole("radio", { name: /色卡 01/u });
  await expect(paletteOption).toBeChecked();
  await page.getByRole("button", { name: "提交局部重绘" }).click();

  await expect.poll(() => uploadedMaskBytes).toBeGreaterThan(100);
  await expect
    .poll(() => uploadedMaskDimensions)
    .toEqual({
      height: 1024,
      width: 768,
    });
  await expect
    .poll(() => requests.filter((body) => body.taskType === "inpaint").length)
    .toBe(1);
  expect(requests.find((body) => body.taskType === "inpaint")).toMatchObject({
    height: 1024,
    maskImageUrl: "https://signed.example/mask-e2e.png?read=1",
    palette: [{ hex: "#C8AB84", name: "OAT" }],
    referenceImageUrl: "https://assets.example/source.png",
    taskType: "inpaint",
    width: 768,
  });
  await expect(
    page.getByRole("status").filter({
      hasText: "局部重绘任务已创建，正在画布中生成",
    }),
  ).toBeVisible();
  await expect.poll(() => inpaintTaskReads).toBeGreaterThan(0);
  await expect(
    boardCanvas.locator('img[src="https://assets.example/inpaint.png"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开历史" }).click();
  await page.getByRole("tab", { name: "生成" }).click();
  const generationHistory = page.getByRole("region", { name: "历史记录" });
  await expect(
    generationHistory.locator('img[src="https://assets.example/inpaint.png"]'),
  ).toBeVisible();
});
