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

test("框选约束后生成候选并采纳为带 assetId 的白板图片", async ({ page }) => {
  let persistedAssetId: string | undefined;
  let generationIdempotencyKey: string | undefined;
  let generationRequestCount = 0;
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
  await page.route("**/api/projects/e2e-project/board", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as {
        readonly patches?: readonly {
          readonly record?: { readonly props?: { readonly assetId?: string } };
        }[];
      };
      persistedAssetId = payload.patches
        ?.map((patch) => patch.record?.props?.assetId)
        .find(Boolean);
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
      json: { elements: [], revision: 0, snapshot: null },
    });
  });
  await page.route(
    "**/api/projects/e2e-project/board-elements/roles",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/generations?*", async (route) => {
    await route.fulfill({
      json: {
        items: generationRequestCount > 0 ? [task] : [],
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
  await page.route("**/api/generations/task-e2e-1", async (route) => {
    await route.fulfill({ json: task });
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
  await expect(page.getByText("剩余 9")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "白板三步上手" }),
  ).toContainText("上传参考");
  await expect(page.getByRole("button", { name: "便签" })).toBeVisible();

  await page.getByRole("button", { name: "便签" }).click();
  const styleRole = page.getByRole("radio", { name: /风格参考/u });
  const fabricRole = page.getByRole("radio", { name: /面料参考/u });
  await styleRole.focus();
  await page.keyboard.press("ArrowRight");
  await expect(fabricRole).toBeFocused();
  await expect(fabricRole).toHaveAttribute("aria-checked", "true");
  const noteRole = page.getByRole("radio", { name: /备注/u });
  await page.keyboard.press("End");
  await expect(noteRole).toBeFocused();
  await expect(noteRole).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "生成浮条" })).toBeHidden();
  await page.mouse.move(470, 220);
  await page.mouse.down();
  await page.mouse.move(810, 500, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("region", { name: "生成浮条" })).toBeVisible();
  await expect(page.getByLabel("当前生成约束")).toContainText("备注 1");

  const generationBar = page.getByRole("region", { name: "生成浮条" });
  const promptInput = generationBar.getByRole("textbox", { name: "生成描述" });
  const generateButton = generationBar.locator("button").first();
  await promptInput.fill("保留便签约束的利落廓形外套");
  await generateButton.click();
  await expect(generateButton).toBeDisabled();
  await promptInput.press("Enter");
  await expect.poll(() => generationRequestCount).toBe(1);
  expect(generationIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);

  await expect(
    page.getByRole("complementary", { name: "生成任务托盘" }),
  ).toContainText("已完成");
  await expect(page.getByRole("region", { name: "生成候选" })).toBeVisible();
  await page.getByRole("button", { name: "采纳" }).click();

  await expect(
    page.locator('img[src="https://assets.example/generated-look.png"]'),
  ).toHaveCount(1);
  await expect
    .poll(() => persistedAssetId, { timeout: 5_000 })
    .toBe("task-e2e-1:0");

  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "生成任务托盘" }),
  ).toContainText("已完成");
  await expect(
    page.locator('img[src="https://assets.example/generated-look.png"]'),
  ).toBeVisible();
});
