import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { LibraryAsset } from "@fashion/shared";
import { seedVisualApp, settleImages, PROJECT, NOW } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { openCanvasFunction, returnCanvasHome } from "./canvas-function-navigation";

const output = "output/home-assets-redesign";
test("第二页评级保留已加载分页、滚动和请求期间键盘焦点", async ({ page }) => {
  const fixture = await seed(page, { pageSize: 4 });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/assets");
  await expect(page.locator("[data-asset-id]")).toHaveCount(4);
  await page.getByRole("button", { name: "加载更多资产" }).click();
  await expect(page.locator("[data-asset-id]")).toHaveCount(8);
  const card = page.locator('[data-asset-id="asset:look-5"]');
  const trigger = card.getByRole("button", { name: /^评级 / });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  const scroll = await page.evaluate(() => scrollY);
  const release = fixture.delayNextRating();
  try {
    await trigger.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeFocused();
    await expect(page.locator("[data-asset-id]")).toHaveCount(8);
  } finally {
    release();
  }
  await expect(trigger).not.toHaveAttribute("aria-busy", "true");
  await expect(trigger).toContainText("5 星");
  await expect(trigger).toBeFocused();
  await expect(page.locator("[data-asset-id]")).toHaveCount(8);
  expect(
    Math.abs((await page.evaluate(() => scrollY)) - scroll),
  ).toBeLessThanOrEqual(2);
});

test("评级使最后一项离开筛选时焦点返回搜索框", async ({ page }) => {
  await seed(page);
  await page.goto("/assets?rating=4");
  await expect(page.locator("[data-asset-id]")).toHaveCount(1);
  const trigger = page.getByRole("button", {
    name: "评级 藏蓝通勤外套",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "没有符合条件的资产" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索资产" })).toBeFocused();
});
test("独立画布离开前保存，失败停留，普通选择不自动引用", async ({ page }) => {
  await seed(page);
  const fixture = await seedCanvas(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT}`);
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  await expect(image).toBeVisible();
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("画布图片尚未就绪");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.getByLabel("正在讨论", { exact: true })).not.toContainText(
    "藏蓝通勤外套",
  );
  fixture.setFailSaves(true);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 70,
    bounds.y + bounds.height / 2 + 40,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect.poll(fixture.writes).toBeGreaterThan(0);
  await returnCanvasHome(page);
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  fixture.setFailSaves(false);
  await returnCanvasHome(page);
  await expect(page).toHaveURL(/\/$/);
  expect(fixture.writes()).toBeGreaterThan(1);
});
async function seedCanvas(page: Page) {
  let failSaves = false;
  let writes = 0;
  let document = {
    projectId: PROJECT,
    mode: "canvas",
    revision: 0,
    formatVersion: 1,
    initializedFrom: "workflow",
    canEdit: true,
    snapshot: {},
    bindings: [
      {
        shapeId: "shape:canvas-candidate",
        nodeId: "candidate",
        removed: false,
      },
      { shapeId: "shape:canvas-brief", nodeId: "brief", removed: false },
    ],
  };
  await page.route(`**/api/projects/${PROJECT}/canvas**`, (route) => {
    if (route.request().method() === "PATCH") {
      writes++;
      if (failSaves)
        return route.fulfill({
          status: 503,
          json: { message: "模拟保存失败" },
        });
      const data = route.request().postDataJSON();
      document = {
        ...document,
        revision: document.revision + 1,
        snapshot: data.snapshot,
        bindings: data.bindings.map(
          (binding: { shapeId: string; nodeId: string }) => ({
            ...binding,
            removed: false,
          }),
        ),
      };
    }
    return route.fulfill({ json: document });
  });
  return {
    setFailSaves: (value: boolean) => {
      failSaves = value;
    },
    writes: () => writes,
  };
}
async function seed(page: Page, options: { pageSize?: number } = {}) {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  const assets: LibraryAsset[] = Array.from({ length: 8 }, (_, index) => ({
    id: `asset:look-${index}`,
    domain: "asset",
    resourceId: `look-${index}`,
    kind: index === 6 ? "audio" : index === 7 ? "document" : "image",
    source: index === 4 ? "uploaded" : index === 7 ? "exported" : "generated",
    title:
      [
        "藏蓝通勤外套",
        "羊毛廓形探索",
        "秋冬系列视觉提案",
        "柔软针织实验",
        "面料肌理参考",
        "长名称服装方案用于检查卡片截断以及不同窗口下的排版",
        "秀场配乐",
        "秋冬技术包.pdf",
      ][index] ?? "设计资产",
    createdAt: NOW,
    projects: [{ id: PROJECT, name: "秋冬通勤服装设计", archived: false }],
    archived: false,
    status: index === 7 ? "expired" : "ready",
    rating: index === 0 ? 4 : null,
    mimeType: index === 7 ? "application/pdf" : "image/svg+xml",
    width: 600,
    height: 800,
    durationMs: null,
    sizeBytes: 204800,
    expiresAt: null,
    previewUrl: index < 6 ? "/visual-garment.svg" : null,
    contentUrl: index < 6 ? "/visual-garment.svg" : null,
    sourceHref: `/${PROJECT}/studio?tab=styles&assetId=look-${index}`,
  }));
  let ratingFailure = false;
  let ratingGate: Promise<void> | null = null;
  await page.route("**/api/assets**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/rating")) {
      if (ratingGate) {
        const gate = ratingGate;
        ratingGate = null;
        await gate;
      }
      if (ratingFailure) {
        ratingFailure = false;
        return route.fulfill({
          status: 503,
          json: { message: "评级暂时无法保存，请重试。" },
        });
      }
      const asset = assets.find(
        (item) => item.resourceId === url.pathname.split("/").at(-2),
      );
      const rating = route.request().postDataJSON().rating as number | null;
      if (asset) asset.rating = rating;
      return route.fulfill({ json: { rating } });
    }
    const p = url.searchParams;
    const filtered = assets.filter(
      (asset) =>
        (!p.get("source") || p.get("source") === asset.source) &&
        (!p.get("rating") ||
          (p.get("rating") === "unrated"
            ? asset.rating === null
            : String(asset.rating) === p.get("rating"))) &&
        (!p.get("q") || asset.title.includes(p.get("q") ?? "")),
    );
    const counts = {
      all: filtered.length,
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
    };
    filtered.forEach((asset) => counts[asset.kind]++);
    const items = filtered.filter(
      (asset) => !p.get("kind") || p.get("kind") === asset.kind,
    );
    if (p.get("sort")?.startsWith("rating"))
      items.sort((a, b) =>
        a.rating === null
          ? 1
          : b.rating === null
            ? -1
            : p.get("sort") === "rating-asc"
              ? a.rating - b.rating
              : b.rating - a.rating,
      );
    const start = Number(p.get("cursor") ?? 0);
    const end = start + (options.pageSize ?? items.length);
    return route.fulfill({
      json: {
        items: items.slice(start, end),
        counts,
        nextCursor: end < items.length ? String(end) : null,
      },
    });
  });
  return {
    assets,
    failNextRating: () => {
      ratingFailure = true;
    },
    delayNextRating: () => {
      let release = () => {};
      ratingGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

test("首页一键创建的失败重试复用编号，画布独立", async ({
  page,
}) => {
  await seed(page);
  const keys: string[] = [];
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: "暂时无法创建，请重试。" },
      });
    return route.fulfill({
      json: {
        id: PROJECT,
        name: "未命名项目",
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(0);
  await page
    .getByRole("button", { name: /新建项目创作/ })
    .first()
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "暂时无法创建" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试创建" }).click();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe("");
  await expect(page.locator("[data-archive-navigation]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "展开工作区目录" }),
  ).toHaveCount(0);
  await returnCanvasHome(page);
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看全部" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "项目", exact: true }),
  ).toBeVisible();
});

test("完整功能可达，发现归入资料，选择项目进入指定工作区", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "工作区导航", exact: true });
  await expect(
    nav.getByRole("link", { name: "首页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    nav.getByRole("link", { name: "项目", exact: true }),
  ).toHaveAttribute("href", "/projects");
  const discoverGroup = nav
    .locator("div")
    .filter({ has: page.getByRole("link", { name: "发现", exact: true }) })
    .last();
  await expect(discoverGroup).toContainText("灵感与资料");
  await expect(nav.getByRole("link", { name: "衣橱", exact: true })).toHaveAttribute("href", "/wardrobe");
  await expect(nav.getByRole("button")).toHaveCount(0);
  await seedCanvas(page);
  await page.getByRole("link", { name: /秋冬通勤服装设计/ }).click();
  await openCanvasFunction(page, "技术包");
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  await expect(page.getByRole("dialog", { name: "技术包", exact: true })).toBeVisible();
  await expect(page.getByLabel("技术包名称", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回画布", exact: true })).toBeVisible();
});

test("个人评级保存、错误回滚、筛选地址及预览焦点恢复", async ({ page }) => {
  const fixture = await seed(page);
  await page.goto("/assets");
  const first = page.locator('[data-asset-id="asset:look-0"]');
  await expect(
    page.getByRole("heading", { name: "资产库", exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "评级 藏蓝通勤外套" }).click();
  await page.getByRole("option", { name: "5 星", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "评级 藏蓝通勤外套" }),
  ).toContainText("5 星");
  await expect(
    page.getByRole("status").filter({ hasText: "已保存 5 星评级" }),
  ).toBeVisible();
  fixture.failNextRating();
  await first.getByRole("button", { name: "评级 藏蓝通勤外套" }).click();
  await page.getByRole("option", { name: "2 星", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "评级暂时无法保存",
  );
  await expect(
    first.getByRole("button", { name: "评级 藏蓝通勤外套" }),
  ).toContainText("5 星");
  await page.getByRole("button", { name: "评级筛选", exact: true }).click();
  await page.getByRole("option", { name: "5 星", exact: true }).click();
  await expect(page).toHaveURL(/rating=5/);
  await expect(page.locator("[data-asset-id]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-asset-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "预览 藏蓝通勤外套" }).click();
  const preview = page.getByRole("dialog", { name: "资产预览 · 藏蓝通勤外套" });
  await expect(
    preview.getByRole("img", { name: "藏蓝通勤外套" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "预览 藏蓝通勤外套" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "评级筛选", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-asset-id]")).toHaveCount(8);
});

for (const width of [1920, 1440, 1366, 390])
  test(`布局与截图 ${width}：首页、资产、菜单与独立画布`, async ({ page }) => {
    test.setTimeout(120000);
    await seed(page);
    await page.setViewportSize({
      width,
      height: width === 1366 ? 768 : width < 768 ? 844 : 1000,
    });
    await mkdir(output, { recursive: true });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
    await settleImages(page);
    await page.screenshot({
      path: `${output}/home-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/assets");
    await expect(page.locator("[data-asset-id]")).toHaveCount(8);
    await settleImages(page);
    await page.screenshot({
      path: `${output}/assets-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "评级筛选", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "5 星", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/rating-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "预览 藏蓝通勤外套" }).click();
    await expect(
      page.getByRole("dialog", { name: "资产预览 · 藏蓝通勤外套" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/preview-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await seedCanvas(page);
    await page.goto(`/${PROJECT}`);
    await expect(page.getByRole("button", { name: "项目菜单", exact: true })).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "工具条", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-archive-navigation]")).toHaveCount(0);
    await expect(page.locator("[data-workspace-chrome]")).toHaveAttribute(
      "data-nav-reserved",
      "false",
    );
    await expect(page.getByLabel("无限白板", { exact: true })).toBeVisible();
    await settleImages(page);
    await page.screenshot({
      path: `${output}/canvas-${width}.png`,
      animations: "disabled",
    });
  });

test("资产加载错误与筛选空状态分别呈现", async ({ page }) => {
  await seed(page);
  await page.route("**/api/assets?**", (route) =>
    route.fulfill({ status: 503, json: { message: "临时故障" } }),
  );
  await page.goto("/assets");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "资产读取失败",
  );
  await expect(
    page.getByRole("heading", { name: "还没有设计资产" }),
  ).toHaveCount(0);
  await page.unroute("**/api/assets?**");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator("[data-asset-id]")).toHaveCount(8);
  await page.getByRole("searchbox", { name: "搜索资产" }).fill("不存在的方案");
  await expect(
    page.getByRole("heading", { name: "没有符合条件的资产" }),
  ).toBeVisible();
});

test("旧创建链接、画布重命名与返回项目列表仍可使用", async ({ page }) => {
  await seed(page);
  await page.goto("/?new=1");
  await expect(page).toHaveURL(/\/projects\?new=1$/);
  await expect(
    page.getByRole("dialog", { name: "给新系列一个名字" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/projects$/);
  await page.route(`**/api/projects/${PROJECT}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return route.fulfill({
      json: {
        id: PROJECT,
        name: route.request().postDataJSON().name,
        archived: false,
        assetCount: 3,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });
  await seedCanvas(page);
  await page.goto(`/${PROJECT}`);
  await openCanvasFunction(page, "重命名项目");
  const dialog = page.getByRole("dialog", { name: "重命名项目", exact: true });
  await dialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("新秋冬系列");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "项目菜单", exact: true }),
  ).toContainText("新秋冬系列");
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "全部项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("滑动菜单保留键盘控制、完整选项和减弱动态", async ({ page }) => {
  await seed(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/assets");
  const trigger = page.getByRole("button", { name: "评级筛选", exact: true });
  await trigger.click();
  const list = page.getByRole("listbox", { name: "评级筛选", exact: true });
  const last = list.getByRole("option", { name: "5 星", exact: true });
  await expect(last).toBeInViewport();
  await last.hover();
  await expect(last).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Home");
  await expect(list).toHaveAttribute("data-input-mode", "keyboard");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.press("ArrowDown");
  await expect(list).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/rating=5/);
  await expect(list).toHaveCount(0);
});
