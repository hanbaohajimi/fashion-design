import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PROJECT, NOW } from "../visual/fixtures";
import { seedWardrobe } from "./wardrobe-fixture";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { workspaceFixture } from "../visual/workspace-fixture";
import { openCanvasFunction } from "./canvas-function-navigation";
import { seedCollectionWorkbench } from "./collection-workbench-fixture";
import { elementBox, emptyActivity, hit, loadZhiya, openZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.setTimeout(90_000);
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async () => { await mkdir("output/playwright/workspace-chrome", { recursive: true }); });

test("画布完全释放导航占位，开合保留视野与聊天草稿，菜单操作可达", async ({ page }) => {
  const state = await prepareZhiya(page);
  const data = workspaceFixture();
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: data }));
  await seedCollectionWorkbench(page, PROJECT, data);
  await loadZhiya(page);
  const workspace = page.getByLabel("无限白板", { exact: true });
  const art = page.getByRole("group", { name: "通勤外套 1", exact: true });
  await art.evaluate(async node => {
    const animations: Animation[] = [];
    for (let current: Element | null = node; current; current = current.parentElement)
      animations.push(...current.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)));
    await Promise.allSettled(animations.map(animation => animation.finished));
  });
  const relative = async () => {
    const b = await elementBox(workspace), a = await elementBox(art);
    return { x: a.x + a.width / 2 - b.x - b.width / 2, y: a.y + a.height / 2 - b.y - b.height / 2, width: a.width };
  };
  expect((await elementBox(workspace)).x).toBeLessThan(2);
  expect((await elementBox(workspace)).y).toBeLessThan(2);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开设计助手", exact: true })).toHaveCount(0);
  await expect(zhiya(page).locator(".pp-label")).toBeHidden();
  await page.screenshot({ path: "output/playwright/workspace-chrome/canvas-collapsed.png" });
  const baseline = await relative();
  await expect(page.getByRole("button", { name: "展开工作区目录", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "全部功能模块", exact: true });
  await expect(catalog.getByRole("button", { name: "导出画布 PNG", exact: true })).toBeVisible();
  await openCanvasFunction(page, "系列工作台");
  await expect(page.getByRole("dialog", { name: "系列工作台", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "系列工作台", exact: true }).getByRole("button", { name: "返回画布", exact: true }).click();
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("保留这份中文设计草稿");
  const identity = await input.elementHandle();
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 5));
  await openCanvasFunction(page, "系列工作台");
  await page.getByRole("dialog", { name: "系列工作台", exact: true }).getByRole("button", { name: "返回画布", exact: true }).click();
  const returned = await relative();
  expect(Math.abs(returned.x - baseline.x)).toBeLessThan(3);
  expect(Math.abs(returned.y - baseline.y)).toBeLessThan(3);
  expect(Math.abs(returned.width - baseline.width)).toBeLessThan(1);
  expect(await identity?.evaluate(node => node.isConnected)).toBe(true);
  await expect(input).toHaveValue("保留这份中文设计草稿");
  expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("项目任务抽屉展示运行概览与最近活动", async ({ page }) => {
  const state = await prepareZhiya(page, {
    realClock: true,
    activity: {
      ...emptyActivity(),
      preparing: 2,
      queued: 1,
      executing: 1,
      awaitingUser: 2,
      waiting: { input: 1, confirmation: 1, resume: 0 },
      recent: [{ id: "agent:recent", domain: "agent", outcome: "completed", updatedAt: "2026-11-08T12:00:00Z" }],
    },
  });
  await loadZhiya(page);
  const trigger = page.getByRole("button", { name: /^项目任务/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "项目任务", exact: true });
  const overview = dialog.getByRole("region", { name: "项目运行概览", exact: true });
  await expect(overview).toContainText("5 项工作正在推进或等待你的决定");
  await expect(overview).toContainText("准备中");
  await expect(overview).toContainText("补充输入 1");
  await overview.locator("summary").click();
  await expect(overview).toContainText("设计运行");
  await expect(overview).toContainText("已完成");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("资料和画布分别记忆，表单草稿、离开保护、图片聚焦和断网提示保留", async ({ page }) => {
  await prepareZhiya(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  const rail = page.getByRole("complementary", { name: "工作区目录", exact: true });
  await expect(rail).toBeVisible();
  const input = page.getByLabel("技术包名称", { exact: true });
  await expect(input).toHaveValue("褶线夹克技术资料");
  await input.fill("待继续完善的技术包");
  await page.getByRole("button", { name: "收起工作区目录", exact: true }).click();
  await expect(input).toHaveValue("待继续完善的技术包");
  await expect(page.locator("[data-archive-navigation]")).toHaveCSS("visibility", "hidden");
  await page.screenshot({ path: "output/playwright/workspace-chrome/studio-collapsed.png" });
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status", { name: "网络已断开，已加载的内容仍可查看" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  await rail.getByRole("link", { name: "面料库", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(input).toHaveValue("待继续完善的技术包");
  await rail.getByRole("link", { name: "设计工作台", exact: true }).click();
  await guard.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(workspaceCanvas(page)).toBeVisible();
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  await expect(rail).toBeVisible();
  const art = await elementBox(page.getByRole("group", { name: "通勤外套 1", exact: true }));
  await page.mouse.dblclick(art.x + art.width / 2, art.y + art.height / 2);
  await expect(page.getByRole("button", { name: "关闭图片工作区", exact: true })).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(page.locator("[data-canvas-chrome]")).toBeHidden();
  await page.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  await expect(rail).toBeVisible();
  await page.reload();
  await expect(rail).toBeVisible();
});

function workspaceCanvas(page: import("@playwright/test").Page) { return page.getByLabel("无限白板", { exact: true }); }

test("创作目录偏好跨项目沿用，账号切换隔离，资料类保留独立默认值", async ({ page }) => {
  await prepareZhiya(page);
  await seedReturningFeatureGuideUser(page, ["another-designer"]);
  let account = "visual-designer";
  await page.route("**/api/me", route => route.fulfill({ json: { user: { id: account, email: "designer@example.com", name: "设计师" }, credits: { limit: 600, used: 0, remaining: 600 } } }));
  await page.route("**/api/projects/second", route => route.fulfill({ json: { id: "second", name: "针织系列探索", archived: false, assetCount: 3, coverAssetId: null, coverUrl: null, createdAt: NOW, updatedAt: NOW } }));
  await loadZhiya(page);
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "工作区目录", exact: true });
  await loadZhiya(page, "/second");
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "收起工作区目录", exact: true }).click();
  await loadZhiya(page);
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  account = "another-designer";
  await page.reload();
  await expect(zhiya(page)).toBeVisible();
  await expect(rail).toBeHidden();
  await page.goto("/fabrics");
  await expect(rail).toBeVisible();
});

for (const width of [320, 1440]) test(`商品展示三种模式与长项目名在 ${width}px 保持主操作可达`, async ({ page }) => {
  await seedWardrobe(page);
  await page.setViewportSize({ width, height: 900 });
  await page.route(`**/api/projects/${PROJECT}`, route => route.fulfill({ json: { id: PROJECT, name: "秋冬通勤服装设计与可持续针织系列的长项目名称", archived: false, assetCount: 3, coverAssetId: null, coverUrl: null, createdAt: NOW, updatedAt: NOW } }));
  for (const [mode, title] of [["sets", "夹克商品展示"], ["wardrobe", "衣架与搭配"], ["realtime", "实时试穿"]]) {
    await page.goto(`/${PROJECT}/studio?tab=presentation&mode=${mode}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const modes = page.getByRole("group", { name: "商品展示模式", exact: true });
    await expect(modes).toBeVisible();
    if (width === 320) {
      const directory = await elementBox(page.getByRole("button", { name: "展开工作区目录", exact: true }));
      const options = await elementBox(modes);
      expect(options.x >= directory.x + directory.width || options.y >= directory.y + directory.height).toBe(true);
    }
    await page.getByRole("button", { name: "项目菜单", exact: true }).click();
    await expect(page.getByRole("button", { name: "创作进展", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^项目任务/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/workspace-chrome/presentation-${mode}-${width}.png` });
  }
});

test("小屏账号入口重播指引后关闭目录，并正确介绍毛绒角色", async ({ page }) => {
  const state = await prepareZhiya(page, { viewport: { width: 320, height: 760 } });
  await loadZhiya(page);
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  await page.getByRole("button", { name: "designer@example.com", exact: true }).click();
  await page.getByRole("button", { name: "功能指引", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "界面功能指引", exact: true });
  await expect(guide).toBeVisible();
  await expect(page.getByRole("dialog", { name: "工作区目录", exact: true })).toBeHidden();
  for (let i = 0; i < 8; i++) {
    if (await guide.getByRole("heading", { name: "和设计助手讨论想法", exact: true }).isVisible()) break;
    await guide.getByRole("button", { name: "下一步", exact: true }).click();
  }
  await expect(guide).toContainText("点击画布中的织芽");
  const highlight = await elementBox(guide.locator("[data-feature-guide-highlight]"));
  const target = await elementBox(hit(page));
  expect(Math.abs(highlight.x + highlight.width / 2 - target.x - target.width / 2)).toBeLessThan(2);
  await guide.getByRole("button", { name: "跳过", exact: true }).click();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("320 px 的目录抽屉、功能切换、账号菜单与助手返回画布", async ({ page }) => {
  await prepareZhiya(page, { viewport: { width: 320, height: 760 } });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
  await loadZhiya(page);
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "工作区目录", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "款式与交付", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  await page.getByRole("tab", { name: "技术包", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue("褶线夹克技术资料");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/workspace-chrome/studio-mobile.png" });
  await page.getByRole("button", { name: "展开工作区目录", exact: true }).click();
  await drawer.getByRole("button", { name: "designer@example.com", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // A repeated Escape during the inner sheet's exit must not close its parent.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "designer@example.com", exact: true })).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "designer@example.com", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "展开工作区目录", exact: true })).toBeFocused();
  await loadZhiya(page);
  await hit(page).click({ position: { x: 36, y: 58 } });
  const close = page.getByRole("button", { name: "收起设计助手", exact: true });
  await expect(close).toHaveText("返回画布");
  await close.click();
  await expect(workspaceCanvas(page)).toBeVisible();
});

test("织芽关键话语、悬停暂停、等待优先及新结果去重", async ({ page }) => {
  test.setTimeout(120_000);
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  const speech = zhiya(page).locator(".pp-speech");
  await expect(speech).toBeHidden();
  state.activity = { ...emptyActivity(), preparing: 1 };
  await expect(speech).toHaveText("让我理一理思路。", { timeout: 25_000 });
  await expect(speech).toBeVisible();
  await zhiya(page).locator(".pp-label").hover();
  await page.screenshot({ path: "output/playwright/workspace-chrome/zhiya-thinking.png" });
  await page.waitForTimeout(4300);
  await expect(speech).toBeVisible();
  await page.mouse.move(500, 250);
  await expect(speech).toBeHidden({ timeout: 5500 });
  await expect(zhiya(page).locator(".pp-caption")).toHaveText("思考中");
  state.activity = { ...emptyActivity(), awaitingUser: 1, waiting: { confirmation: 1, input: 0, resume: 0 } };
  await expect(speech).toHaveText("这一步，想听听你的选择。");
  await page.screenshot({ path: "output/playwright/workspace-chrome/zhiya-waiting.png" });
  state.activity = { ...state.activity, recent: [{ id: "generation:other", domain: "generation", outcome: "completed", updatedAt: "2026-11-09T00:01:00Z" }] };
  const queries = state.queries.length;
  await expect.poll(() => state.queries.length, { timeout: 25_000 }).toBeGreaterThan(queries);
  await expect(zhiya(page)).toHaveAttribute("data-scene", "needs_attention");
  await expect(speech).toHaveText("这一步，想听听你的选择。");
  state.activity = { ...emptyActivity(), recent: [{ id: "generation:finished", domain: "generation", outcome: "completed", updatedAt: "2026-11-09T00:02:00Z" }] };
  await expect(speech).toHaveText("做好啦，来看看这一版。", { timeout: 25_000 });
  await page.screenshot({ path: "output/playwright/workspace-chrome/zhiya-complete.png" });
  await expect(speech).toBeHidden({ timeout: 7500 });
  const next = state.queries.length;
  await expect.poll(() => state.queries.length, { timeout: 25_000 }).toBeGreaterThan(next);
  await expect(speech).toBeHidden();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("320 px 顶部角色的气泡自动换边，键盘聚焦保留话语，点击仍打开同一聊天", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, viewport: { width: 320, height: 760 }, activity: { ...emptyActivity(), executing: 1 } });
  await page.addInitScript(() => {
    localStorage.setItem("fashion:zhiya:visual-designer:atelier-visual", JSON.stringify({ x: .95, y: .08 }));
  });
  await loadZhiya(page);
  await expect(zhiya(page)).toHaveAttribute("data-scene", "working");
  state.activity = { ...emptyActivity(), awaitingUser: 1, waiting: { input: 1, confirmation: 0, resume: 0 } };
  const speech = zhiya(page).locator(".pp-speech");
  const label = zhiya(page).locator(".pp-label");
  await expect(speech).toHaveText("还差一点资料，想请你补充。");
  await expect(zhiya(page).locator(".pp-label-anchor")).toHaveAttribute("data-side", "below");
  const b = await elementBox(label);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(320);
  expect(b.width).toBeLessThanOrEqual(224);
  expect(b.y + b.height).toBeLessThan((await elementBox(page.getByRole("complementary", { name: "工具条", exact: true }))).y - 8);
  await label.focus();
  await page.waitForTimeout(6300);
  await expect(speech).toBeVisible();
  await page.screenshot({ path: "output/playwright/workspace-chrome/zhiya-edge-mobile.png" });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "描述设计需求", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(speech).toBeHidden();
  await expect(hit(page)).toBeFocused();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const interaction of ["悬停", "键盘聚焦"]) test(`话语退出期间${interaction}仍保留内容，新状态打断旧话语且继续按时收起`, async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, activity: { ...emptyActivity(), executing: 1 } });
  await loadZhiya(page);
  const speech = zhiya(page).locator(".pp-speech");
  const label = zhiya(page).locator(".pp-label");
  // Hold the native exit animation mid-flight to exercise the race deterministically.
  await speech.evaluate(node => {
    const animate = node.animate.bind(node);
    node.animate = (keyframes, options) => {
      const animation = animate(keyframes, options);
      if (typeof options === "object" && options.duration === 120) {
        animation.pause();
        animation.currentTime = 60;
        node.animate = animate;
      }
      return animation;
    };
  });
  state.activity = { ...emptyActivity(), preparing: 1 };
  await expect(speech).toHaveText("让我理一理思路。");
  await expect.poll(() => speech.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
  if (interaction === "悬停") await label.hover();
  else await label.focus();
  await expect.poll(() => speech.evaluate(node => node.getAnimations().length)).toBe(0);
  await expect(speech).toBeVisible();
  await expect(speech).toHaveCSS("opacity", "1");
  state.activity = { ...emptyActivity(), awaitingUser: 1, waiting: { input: 0, confirmation: 1, resume: 0 } };
  await expect(speech).toHaveText("这一步，想听听你的选择。");
  await label.evaluate(node => node.blur());
  await page.mouse.move(500, 250);
  await expect(speech).toBeHidden({ timeout: 7500 });
  await expect(zhiya(page).locator(".pp-caption")).toHaveText("等你确认");
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});
