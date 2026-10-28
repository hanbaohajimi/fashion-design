import { expect, test } from "@playwright/test";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";

test.beforeEach(async ({ page }) => {
  await seedReturningFeatureGuideUser(page, ["trend-user"]);
});

test("趋势档案保留真实主题并把原记录与色卡加入工作流，刷新重试不重复写图", async ({
  page,
}) => {
  const now = "2026-10-14T08:00:00.000Z";
  const graph = {
    projectId: "workflow-trends",
    revision: 0,
    layoutRevision: 0,
    nodes: [] as Record<string, unknown>[],
    edges: [],
    legacyAvailable: true,
  };
  let patchCount = 0;
  let legacyWrites = 0;
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, used: 0, remaining: 100 },
        user: {
          id: "trend-user",
          authId: "trend-auth",
          name: "Trend reader",
          email: "trends@example.com",
          createdAt: now,
          avatar: null,
          deletedAt: null,
        },
      },
    }),
  );
  await page.route("**/api/trends?*", (route) =>
    route.fulfill({
      json: {
        page: 1,
        pageSize: 60,
        total: 1,
        hasMore: false,
        items: [
          {
            id: "trend-navy",
            category: "color",
            platform: "vogue",
            title: "通勤藏蓝色",
            summary: "低饱和藏蓝色与温暖中性色搭配，用于秋冬通勤系列。",
            coverImageUrl: null,
            sourceUrl: "https://example.com/verified-trend",
            publishedAt: now,
            curatedAt: now,
            status: "published",
            tags: ["通勤", "秋冬"],
            extracted: {
              keyColors: ["#253B54", "#D8CCBA"],
              keywords: ["藏蓝色"],
              silhouettes: [],
              fabricMentions: [],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({
      json: {
        id: "digest",
        period: "2026-W42",
        theme: "秋冬通勤色彩",
        overview: "基于已采集来源整理，供设计师进一步核对。",
        itemIds: ["trend-navy"],
        createdAt: now,
      },
    }),
  );
  await page.route("**/api/projects/workflow-trends/workflow/sync", (route) =>
    route.fulfill({ json: graph }),
  );
  await page.route(/\/api\/projects\/workflow-trends\/workflow$/u, (route) => {
    const input = route.request().postDataJSON() as {
      mode: string;
      baseRevision: number;
      operations: { type: string; node: Record<string, unknown> }[];
    };
    expect(input.mode).toBe("semantic");
    expect(input.baseRevision).toBe(graph.revision);
    patchCount += 1;
    for (const operation of input.operations) {
      expect(operation.type).toBe("add_node");
      graph.nodes.push({
        ...operation.node,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      });
    }
    graph.revision += 1;
    return route.fulfill({ json: graph });
  });
  await page.route("**/api/boards/*/import-trend", (route) => {
    legacyWrites += 1;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/trends?from=board&boardId=workflow-trends");
  await expect(
    page.getByRole("heading", { name: "趋势档案", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "秋冬通勤色彩", exact: true })).toBeHidden();
  await page.getByText("本周趋势综述", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "秋冬通勤色彩", exact: true })).toBeVisible();
  await page.getByText("本周趋势综述", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "趋势筛选" })
      .getByRole("button", { name: "色彩", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加入工作流" }).click();
  await expect(page.getByRole("status")).toContainText("原始来源已保留");
  expect(graph.nodes).toHaveLength(3);
  expect(
    graph.nodes.find((node) => node.type === "trend")?.payload,
  ).toMatchObject({
    trendItemId: "trend-navy",
    sourceUrl: "https://example.com/verified-trend",
    keyColors: ["#253B54", "#D8CCBA"],
  });
  expect(graph.nodes.filter((node) => node.type === "swatch")).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "加入工作流" }).click();
  await expect(page.getByRole("status")).toContainText("该趋势已在此工作流中");
  expect(patchCount).toBe(1);
  expect(legacyWrites).toBe(0);
  await expect(
    page.getByRole("link", { name: "打开设计工作流" }),
  ).toHaveAttribute("href", "/workflow-trends");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "output/playwright/workflow-trend-library-verified.png",
    fullPage: true,
  });
});
