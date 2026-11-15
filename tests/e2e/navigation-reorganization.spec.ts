import { mkdir } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import {
  openCanvasFunction,
  returnCanvasHome,
} from "./canvas-function-navigation";

const SECOND = "spring-project";
const project = (id: string) => ({
  id,
  name: id === PROJECT ? "秋冬通勤服装设计" : "春夏轻盈系列",
  archived: false,
  assetCount: 0,
  coverAssetId: null,
  coverUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
});
async function setup(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 0,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/projects?**", (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    return route.fulfill({
      json: {
        items: [project(second ? SECOND : PROJECT)],
        page: second ? 2 : 1,
        pageSize: 1,
        hasMore: !second,
        total: 2,
        stats: { activeProjects: 2, totalAssets: 0, coverRate: 0 },
      },
    });
  });
  await page.route(`**/api/projects/${SECOND}`, (route) =>
    route.fulfill({ json: project(SECOND) }),
  );
  await page.route(/\/api\/projects\/[^/]+\/studio$/, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(/\/api\/projects\/[^/]+\/wardrobe$/, (route) =>
    route.fulfill({
      json: {
        projectId: new URL(route.request().url()).pathname.split("/")[3],
        canEdit: true,
        items: [],
        outfits: [],
        preparations: [],
        tryOns: [],
        capabilities: {
          enabled: true,
          preparationEnabled: true,
          staticTryOnEnabled: true,
          realtimeOutfitEnabled: true,
          realtimeMultiItemVerified: true,
          realtimeCategories: ["top"],
        },
      },
    }),
  );
  return state;
}

for (const width of [1440, 390]) {
  test(`${width}px首页保留六个快捷入口，目录精简且没有新建按钮`, async ({
    page,
  }) => {
    await setup(page, width);
    await page.goto("/");
    const shortcuts = page.getByRole("region", { name: "创作快捷入口" });
    await expect(shortcuts.getByRole("button")).toHaveCount(6);
    await expect(
      shortcuts.getByRole("button", { name: "衣橱", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /新建项目创作/ }).first(),
    ).toBeVisible();
    if (width < 1200)
      await page.getByRole("button", { name: "展开工作区目录" }).click();
    const nav = page.getByRole("navigation", {
      name: "工作区导航",
      exact: true,
    });
    await expect(nav.getByRole("link")).toHaveText([
      "首页",
      "项目",
      "资产库",
      "衣橱",
      "面料库",
      "发现",
    ]);
    await expect(
      page.getByRole("button", { name: "快速新建项目" }),
    ).toHaveCount(0);
    await expect(nav.getByRole("button")).toHaveCount(0);
    await mkdir("output/navigation-reorganization", { recursive: true });
    await page.screenshot({
      path: `output/navigation-reorganization/navigation-${width}.png`,
    });
    if (width < 1200) await page.keyboard.press("Escape");
    await page.screenshot({
      path: `output/navigation-reorganization/home-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`${width}px画布标题四项菜单、工具迁移与返回主页`, async ({ page }) => {
    const state = await setup(page, width);
    await loadZhiya(page);
    await expect(page.locator("[data-canvas-chrome] > *")).toHaveCount(1);
    await expect(page.locator("[data-project-tasks]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "返回首页", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "项目菜单", exact: true }).click();
    await expect(
      page
        .getByRole("group", { name: "项目菜单选项", exact: true })
        .getByRole("button"),
    ).toHaveText(["回到主页", "全部项目", "创建新项目", "删除项目"]);
    await mkdir("output/navigation-reorganization", { recursive: true });
    await page.screenshot({
      path: `output/navigation-reorganization/canvas-menu-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "全部功能模块", exact: true })
      .click();
    const catalog = page.getByRole("dialog", {
      name: "全部功能模块",
      exact: true,
    });
    for (const name of [
      "衣橱",
      "实时试穿",
      "服装秀",
      "技术包",
      "样衣反馈",
      "团队评审",
      "品牌资料",
      "生成文件",
      "重命名项目",
      "项目任务",
      "导出画布 PNG",
      "画布操作说明",
    ]) {
      await expect(
        catalog.getByRole("button", { name, exact: true }),
      ).toHaveCount(1);
    }
    await catalog.getByRole("searchbox").fill("项目");
    await page.screenshot({
      path: `output/navigation-reorganization/functions-${width}.png`,
    });
    await catalog
      .getByRole("button", { name: "关闭全部功能", exact: true })
      .click();
    await openCanvasFunction(page, "技术包");
    await expect(page.getByLabel("技术包名称", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
    await page.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "技术包", exact: true })).toBeHidden();
    await expect(
      page.getByRole("button", { name: "全部功能模块", exact: true }),
    ).toBeVisible();
    await openCanvasFunction(page, "项目任务");
    await expect(
      page.getByRole("dialog", { name: "项目任务", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await returnCanvasHome(page);
    await expect(page).toHaveURL(/\/$/);
    expect(state.errors).toEqual([]);
  });

  test(`${width}px衣橱默认最近项目、完整项目选择和刷新恢复`, async ({
    page,
  }) => {
    await setup(page, width);
    await page.addInitScript(
      ({ id, now }) =>
        localStorage.setItem(
          "fashion:creative-visit:visual-designer",
          JSON.stringify({ projectId: id, path: `/${id}`, visitedAt: now }),
        ),
      { id: SECOND, now: NOW },
    );
    await page.goto("/wardrobe");
    const selector = page.getByRole("button", {
      name: "衣橱项目",
      exact: true,
    });
    await expect(selector).toContainText("春夏轻盈系列");
    await selector.click();
    await expect(
      page.getByRole("option", { name: "秋冬通勤服装设计", exact: true }),
    ).toBeVisible();
    await mkdir("output/navigation-reorganization", { recursive: true });
    await page.screenshot({
      path: `output/navigation-reorganization/wardrobe-selector-${width}.png`,
    });
    await page
      .getByRole("option", { name: "秋冬通勤服装设计", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/wardrobe\\?projectId=${PROJECT}$`),
    );
    await expect(selector).toContainText("秋冬通勤服装设计");
    await page.reload();
    await expect(selector).toContainText("秋冬通勤服装设计");
    await page.screenshot({
      path: `output/navigation-reorganization/wardrobe-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("衣橱切换项目保护未保存搭配，取消后保持原项目与输入", async ({ page }) => {
  await setup(page);
  await page.goto(`/wardrobe?projectId=${PROJECT}`);
  await page
    .getByRole("textbox", { name: "搭配名称", exact: true })
    .fill("尚未保存的冬季搭配");
  await page.getByRole("button", { name: "衣橱项目", exact: true }).click();
  await page.getByRole("option", { name: "春夏轻盈系列", exact: true }).click();
  const guard = page.getByRole("dialog", {
    name: "保留未保存的修改",
    exact: true,
  });
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toHaveValue("尚未保存的冬季搭配");
  await expect(page).toHaveURL(new RegExp(`projectId=${PROJECT}$`));
  await page.getByRole("button", { name: "衣橱项目", exact: true }).click();
  await page.getByRole("option", { name: "春夏轻盈系列", exact: true }).click();
  await guard.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`projectId=${SECOND}$`));
  await expect(
    page.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).not.toHaveValue("尚未保存的冬季搭配");
});

test("衣橱读取失败不显示其他项目内容；失效最近项目回退", async ({ page }) => {
  await setup(page);
  let fail = true;
  await page.route(`**/api/projects/${SECOND}`, (route) =>
    fail
      ? route.fulfill({ status: 404, json: { message: "项目不存在" } })
      : route.fulfill({ json: project(SECOND) }),
  );
  await page.addInitScript(
    ({ id, now }) =>
      localStorage.setItem(
        "fashion:creative-visit:visual-designer",
        JSON.stringify({ projectId: id, path: `/${id}`, visitedAt: now }),
      ),
    { id: SECOND, now: NOW },
  );
  await page.goto("/wardrobe");
  await expect(
    page.getByRole("button", { name: "衣橱项目", exact: true }),
  ).toContainText("秋冬通勤服装设计");
  await page.goto(`/wardrobe?projectId=${SECOND}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "衣橱未能打开",
  );
  await expect(
    page.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toBeVisible();
});

test("标题菜单删除必须确认，失败留在原画布，成功回到首页", async ({ page }) => {
  await setup(page);
  let deletes = 0;
  await page.route(`**/api/projects/${PROJECT}`, (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deletes++;
    return deletes === 1
      ? route.fulfill({ status: 503, json: { message: "删除服务暂不可用" } })
      : route.fulfill({ status: 204 });
  });
  await loadZhiya(page);
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
  await expect(dialog).toBeVisible();
  expect(deletes).toBe(0);
  await dialog.getByRole("button", { name: "保留项目" }).click();
  expect(deletes).toBe(0);
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("删除服务暂不可用");
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(deletes).toBe(2);
});

test("非所有者不能从标题菜单删除项目", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studioFixture({ role: "EDITOR" }) }),
  );
  await loadZhiya(page);
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(
    page.getByText("只有项目所有者可以删除项目。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认删除" })).toBeDisabled();
});

test("标题菜单创建失败可重试，复用请求编号后进入新画布", async ({ page }) => {
  await setup(page);
  const keys: string[] = [];
  await page.route("**/api/projects", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    return keys.length === 1
      ? route.fulfill({ status: 503, json: { message: "暂时无法创建" } })
      : route.fulfill({ json: project(SECOND) });
  });
  await loadZhiya(page);
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "创建新项目", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "暂时无法创建" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  await page.getByRole("button", { name: "重试创建", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${SECOND}$`));
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe("");
  expect(keys[0]).toBe(keys[1]);
});

test("衣橱无项目显示创建入口，只读项目禁止准备与编辑搭配", async ({ page }) => {
  await setup(page);
  await page.route("**/api/projects?**", (route) =>
    route.fulfill({
      json: {
        items: [],
        page: 1,
        pageSize: 50,
        hasMore: false,
        total: 0,
        stats: { activeProjects: 0, totalAssets: 0, coverRate: 0 },
      },
    }),
  );
  await page.goto("/wardrobe");
  await expect(
    page.getByRole("heading", { name: "从第一个项目开始整理衣橱" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建项目", exact: true }),
  ).toBeVisible();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: studioFixture({
        role: "VIEWER",
        capabilities: { edit: false, review: false, manageMembers: false },
      }),
    }),
  );
  await page.goto(`/wardrobe?projectId=${PROJECT}`);
  await expect(
    page.getByRole("button", { name: "准备单品", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "返回画布", exact: true }),
  ).toBeEnabled();
});
