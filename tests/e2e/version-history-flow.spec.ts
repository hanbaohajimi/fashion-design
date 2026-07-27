import { expect, test } from "@playwright/test";

test("Lightbox 版本时间线可恢复旧版并再次恢复到原版本", async ({
  page,
}) => {
  const restores: Array<{
    readonly currentAssetId: string;
    readonly targetAssetId: string;
  }> = [];
  const createdAt = "2026-07-27T08:00:00.000Z";
  const asset = (
    id: string,
    operation: "generated" | "restore" | "variation",
    url: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    archivedAt: null,
    createdAt,
    height: 1024,
    id,
    operation,
    parentAssetId: null,
    projectId: "e2e-history",
    restoredFromAssetId: null,
    seed: 417,
    thumbnailUrl: url,
    url,
    width: 768,
    ...overrides,
  });
  const root = asset(
    "asset-root",
    "generated",
    "https://assets.example/root.png",
  );
  const current = asset(
    "asset-current",
    "variation",
    "https://assets.example/current.png",
    { parentAssetId: "asset-root" },
  );

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 18, used: 82 },
        user: {
          authId: "auth-history",
          avatar: null,
          createdAt,
          deletedAt: null,
          email: "archive@example.com",
          id: "user-history",
          name: "Archive Atelier",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-history/board", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? { ok: true }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations", (route) =>
    route.fulfill({ status: 202, json: { task_id: "task-history" } }),
  );
  await page.route("**/api/generations/task-history/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "event: generation\n" +
        `data: ${JSON.stringify({
          status: "succeeded",
          taskId: "task-history",
          timestamp: createdAt,
        })}\n\n`,
    }),
  );
  await page.route("**/api/generations/task-history", (route) =>
    route.fulfill({
      json: {
        createdAt,
        error: null,
        id: "task-history",
        output: {
          images: [
            {
              assetId: "asset-current",
              height: 1024,
              url: current.url,
              width: 768,
            },
          ],
          seed: 417,
        },
        status: "succeeded",
        updatedAt: createdAt,
      },
    }),
  );
  await page.route(
    /\/api\/design-assets\/([^/]+)\/versions/u,
    async (route) => {
      const activeId = new URL(route.request().url()).pathname.split("/").at(-2);
      const restoredOne = asset(
        "asset-restore-1",
        "restore",
        root.url,
        {
          parentAssetId: "asset-current",
          restoredFromAssetId: "asset-root",
        },
      );
      const restoredTwo = asset(
        "asset-restore-2",
        "restore",
        current.url,
        {
          parentAssetId: "asset-restore-1",
          restoredFromAssetId: "asset-current",
        },
      );
      const items =
        activeId === "asset-restore-2"
          ? [restoredTwo, restoredOne, current, root]
          : activeId === "asset-restore-1"
            ? [restoredOne, current, root]
            : [current, root];
      await route.fulfill({ json: { items, nextCursor: null } });
    },
  );
  await page.route(
    /\/api\/design-assets\/([^/]+)\/restore$/u,
    async (route) => {
      const targetAssetId = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      const body = route.request().postDataJSON() as {
        readonly currentAssetId: string;
      };
      restores.push({
        currentAssetId: body.currentAssetId,
        targetAssetId: targetAssetId ?? "",
      });
      await route.fulfill({
        json:
          targetAssetId === "asset-root"
            ? asset("asset-restore-1", "restore", root.url, {
                parentAssetId: "asset-current",
                restoredFromAssetId: "asset-root",
              })
            : asset("asset-restore-2", "restore", current.url, {
                parentAssetId: "asset-restore-1",
                restoredFromAssetId: "asset-current",
              }),
      });
    },
  );
  await page.route("https://assets.example/*.png", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">' +
        `<rect width="768" height="1024" fill="${route.request().url().includes("root") ? "#b6a180" : "#c9bba4"}"/>` +
        '<path d="M230 170h308l74 700H156z" fill="#3b463f"/>' +
        "</svg>",
    }),
  );

  await page.goto("/e2e-history");
  await page.getByRole("button", { name: "便签" }).click();
  await page
    .getByRole("textbox", { name: "生成描述" })
    .fill("带明确肩线的短款夹克");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await page.getByRole("button", { name: "打开候选详情" }).click();
  await page.getByRole("button", { name: "版本" }).click();

  await expect(page.getByRole("heading", { name: "资产版本时间线" })).toBeVisible();
  await expect(page.getByText("初次生成")).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "初次生成" })
    .getByRole("button", { name: "恢复此版" })
    .click();
  await expect
    .poll(() => restores)
    .toContainEqual({
      currentAssetId: "asset-current",
      targetAssetId: "asset-root",
    });

  await expect(page.getByText("版本恢复").first()).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "设计变体" })
    .getByRole("button", { name: "恢复此版" })
    .click();
  await expect
    .poll(() => restores)
    .toContainEqual({
      currentAssetId: "asset-restore-1",
      targetAssetId: "asset-current",
    });

  await page.getByRole("button", { name: "预览" }).click();
  await expect(
    page.getByRole("img", { name: "候选设计大图" }),
  ).toHaveAttribute("src", "https://assets.example/current.png");
});
