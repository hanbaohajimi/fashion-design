import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { contrastFailures, controlFontFailures } from "./review-accessibility";

const user = {
  id: "experience-user",
  email: "designer@example.com",
  name: "设计师",
};

async function mockWorkspace(page: Page, status = "running") {
  const now = new Date().toISOString();
  const graph = {
    projectId: "experience",
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      {
        id: "brief",
        kind: "asset",
        type: "brief",
        title: "设计需求",
        payload: { text: "藏蓝色宽松风衣" },
        x: 40,
        y: 100,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "generate",
        kind: "tool",
        type: "generate_design",
        title: "方案生成",
        payload: { params: { prompt: "生成藏蓝风衣效果图" } },
        x: 400,
        y: 100,
        status,
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [
      {
        id: "input",
        sourceNodeId: "brief",
        targetNodeId: "generate",
        sourcePort: "out",
        targetPort: "constraint",
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me")
      return route.fulfill({
        json: { user, credits: { limit: 100, used: 0, remaining: 100 } },
      });
    if (path === "/api/projects/experience")
      return route.fulfill({
        json: {
          id: "experience",
          name: "城市漫步 · 春夏设计",
          archived: false,
          assetCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
    if (path === "/api/projects/experience/studio")
      return route.fulfill({
        json: {
          role: "OWNER",
          capabilities: { edit: true, review: true, manageMembers: true },
          styles: [],
          brandProfiles: [],
          slots: [],
          techPacks: [],
          samples: [],
          comments: [],
          reviews: [],
          patterns: [],
          presentationSets: [],
          members: [],
          collections: [],
          assets: [],
        },
      });
    if (path.endsWith("/workflow") || path.endsWith("/workflow/sync"))
      return route.fulfill({ json: graph });
    if (path.endsWith("/tools"))
      return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    if (path.endsWith("/agent-conversations"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.endsWith("/fabrics"))
      return route.fulfill({
        json: { items: [], total: 0, page: 1, totalPages: 0 },
      });
    return route.fulfill({ status: 404, json: { message: "未模拟此接口" } });
  });
  return graph;
}

test("趋势读取等待认证完成，空档案与空周报在页面切换后正常恢复", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const authentication = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/me", async (route) => {
    await authentication;
    await route.fulfill({
      json: { user, credits: { limit: 100, used: 0, remaining: 100 } },
    });
  });
  await page.route("**/api/trends?*", (route) => {
    requests++;
    return route.fulfill({
      json: { items: [], page: 1, pageSize: 60, total: 0, hasMore: false },
    });
  });
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/fabrics?*", (route) =>
    route.fulfill({ json: { items: [], page: 1, total: 0, totalPages: 0 } }),
  );
  try {
    await page.goto("/trends");
    await page.waitForTimeout(150);
    expect(requests).toBe(0);
  } finally {
    release?.();
  }
  await expect(
    page.getByText("尚无已采集档案", { exact: false }),
  ).toBeVisible();
  await page.getByText("本周趋势综述", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本周综述尚未生成" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "面料库", exact: true }).click();
  await expect(
    page.getByText("面料档案还是空的", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "趋势档案", exact: true }).click();
  await expect(
    page.getByText("尚无已采集档案", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/Cannot read|TypeError/)).toHaveCount(0);
});

test("技术错误显示中文恢复指引，保留重试入口", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: { user, credits: { limit: 100, used: 0, remaining: 100 } },
    }),
  );
  await page.route("**/api/trends?*", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Cannot read properties of undefined (reading '6')" },
    }),
  );
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/trends");
  await expect(
    page.getByRole("alert").filter({ hasText: "趋势暂时无法加载" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新加载档案" }),
  ).toBeVisible();
  await expect(page.getByText(/Cannot read|TypeError/)).toHaveCount(0);
});

test("认证暂时不可用时显示恢复入口，不把失败显示为空档案", async ({ page }) => {
  let available = false;
  await page.route("**/api/me", (route) =>
    route.fulfill(
      available
        ? { json: { user, credits: { limit: 100, used: 0, remaining: 100 } } }
        : { status: 503, json: { message: "认证服务暂时不可用" } },
    ),
  );
  await page.route("**/api/trends?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, hasMore: false } }),
  );
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/trends");
  await expect(
    page.getByRole("alert").filter({ hasText: "认证服务暂时不可用" }),
  ).toBeVisible();
  await expect(page.getByText("尚无已采集档案", { exact: false })).toHaveCount(
    0,
  );
  available = true;
  await page.getByRole("button", { name: "重新加载档案" }).click();
  await expect(
    page.getByText("尚无已采集档案", { exact: false }),
  ).toBeVisible();
});

test("工作室分组保留旧链接、未保存保护与手机功能入口", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/experience/studio?tab=tasks");
  await expect(
    page.getByRole("textbox", { name: "本次任务", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("textbox", { name: "本次任务", exact: true })
    .fill("尚未保存的风衣要求");
  await page.getByRole("button", { name: "开发交付", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "本次任务", exact: true }),
  ).toHaveValue("尚未保存的风衣要求");
  await page.getByRole("button", { name: "开发交付", exact: true }).click();
  await guard.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(page).toHaveURL(/tab=planning/);
  await expect(
    page.getByRole("tab", { name: "系列规划", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "系列规划", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("当前功能", { exact: true }).selectOption("tech");
  await expect(page).toHaveURL(/tab=tech/);
  await expect(
    page.getByRole("heading", { name: "技术包", exact: true }),
  ).toBeVisible();
});

test("面料规格默认收起，应用后显示条件摘要，空结果可重置", async ({ page }) => {
  await mockWorkspace(page);
  const mediaRequests: string[] = [];
  page.on("request", (request) => { if (/painting-loaders|p5\.brush|p5\.min/u.test(request.url())) mediaRequests.push(request.url()); });
  await page.goto("/fabrics");
  await expect(page.getByText("面料档案还是空的", { exact: false })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "成分", exact: true })).toBeHidden();
  await page.getByText("规格筛选", { exact: true }).click();
  await page.getByRole("textbox", { name: "成分", exact: true }).fill("棉");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  const summary = page.locator("summary").filter({ hasText: "规格筛选 · 成分：棉" });
  await expect(summary).toBeVisible();
  await expect(page.getByText("没有符合当前规格的面料", { exact: false })).toBeVisible();
  await summary.click();
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByText("面料档案还是空的", { exact: false })).toBeVisible();
  expect(mediaRequests).toEqual([]);
});

test("工作室首屏在各尺寸可直接输入且无横向溢出", async ({ page }) => {
  await mockWorkspace(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/experience/studio");
  await expect(
    page.getByRole("heading", { name: "草图变效果图", exact: true }),
  ).toBeVisible();
  await mkdir("output/playwright/frontend-experience", { recursive: true });
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 683, height: 384 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await contrastFailures(page)).toEqual([]);
    expect(await controlFontFailures(page)).toEqual([]);
    await page.screenshot({
      path: `output/playwright/frontend-experience/studio-${viewport.width}.png`,
      fullPage: true,
    });
  }
});

test("绘画只在查看长任务时播放，暂停不改变任务，完成立即释放媒体", async ({
  page,
}) => {
  const graph = await mockWorkspace(page);
  const media: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/painting-loaders/")) media.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/experience");
  const node = page.locator('[data-type="generate_design"]').first();
  await expect(node).toBeVisible();
  expect(media).toEqual([]);
  await node.dblclick();
  await expect(
    page.getByRole("region", { name: "任务状态", exact: true }),
  ).toBeVisible();
  expect(media).toEqual([]);
  await expect(page.locator("video")).toHaveCount(1, { timeout: 8000 });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate(
          (element: HTMLVideoElement) =>
            element.readyState >= 2 && element.currentTime > 0,
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "暂停动画" }).click();
  expect(graph.nodes[1]?.status).toBe("running");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((element: HTMLVideoElement) => element.paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "播放动画" }).click();
  await page.screenshot({
    path: "output/playwright/frontend-experience/painting-task.png",
  });
  const running = graph.nodes[1];
  if (running) running.status = "completed";
  graph.revision++;
  await expect(node).toContainText("已完成", { timeout: 8000 });
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "确认并执行", exact: true }),
  ).toHaveCount(0);
});

test("减少动画与媒体故障均保留任务状态，未知节点不显示完成", async ({
  page,
}) => {
  await mockWorkspace(page, "unrecognized");
  await page.goto("/experience");
  await expect(
    page.locator('[data-type="generate_design"]').first(),
  ).toContainText("正在确认状态");
  await expect(
    page.locator('[data-type="generate_design"]').first(),
  ).not.toContainText("已完成");
  await mockWorkspace(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.locator('[data-type="generate_design"]').first().dblclick();
  await expect(page.getByRole("button", { name: "关于等待动画" })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.locator("video")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("video")).toHaveCount(1);
  await page
    .locator("video")
    .evaluate((video) => video.dispatchEvent(new Event("error")));
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "任务状态", exact: true })
      .getByRole("status"),
  ).toContainText("处理中");
});
