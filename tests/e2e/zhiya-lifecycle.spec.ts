import { expect, test } from "@playwright/test";
import { NOW, PROJECT } from "../visual/fixtures";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { elementBox, emptyActivity, hit, loadZhiya, openZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.setTimeout(60_000);

test("位置和聊天偏好按账号、项目隔离", async ({ page }) => {
  const state = await prepareZhiya(page);
  await seedReturningFeatureGuideUser(page, ["another-designer"]);
  let account = "visual-designer";
  await page.route("**/api/me", route => route.fulfill({ json: {
    user: { id: account, email: "designer@example.com", name: "设计师" },
    credits: { limit: 600, used: 0, remaining: 600 },
  } }));
  await page.route("**/api/projects/second", route => route.fulfill({ json: {
    id: "second", name: "针织系列探索", archived: false, assetCount: 3,
    coverAssetId: "look", coverUrl: "/visual-garment.svg", createdAt: NOW, updatedAt: NOW,
  } }));
  await page.route("**/api/projects/second/agent-conversations*", route => route.fulfill({ json: {
    items: [{ id: "second-chat", mode: "workflow", projectId: "second", title: "针织系列", createdAt: NOW, updatedAt: NOW, archivedAt: null }], nextCursor: null,
  } }));
  await page.addInitScript(() => {
    if (localStorage.getItem("zhiya-preference-fixture")) return;
    localStorage.setItem("zhiya-preference-fixture", "1");
    localStorage.setItem("fashion:zhiya:visual-designer:atelier-visual", JSON.stringify({ x: .3, y: .55 }));
    localStorage.setItem("fashion:zhiya:visual-designer:second", JSON.stringify({ x: .7, y: .6 }));
    localStorage.setItem("fashion:workspace-split:visual-designer:atelier-visual", JSON.stringify({ open: false, width: 420 }));
    localStorage.setItem("fashion:workspace-split:visual-designer:second", JSON.stringify({ open: true, width: 360 }));
  });
  await loadZhiya(page);
  const original = await elementBox(hit(page));
  await page.goto("/second");
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await expect(input).toBeVisible();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toBeVisible();
  await expect.poll(async () => (await elementBox(hit(page))).x - original.x).toBeGreaterThan(300);
  await page.goto(`/${PROJECT}`);
  await expect(zhiya(page)).toBeVisible();
  await expect.poll(async () => Math.abs((await elementBox(hit(page))).x - original.x)).toBeLessThan(2);
  await openZhiya(page);
  expect((await elementBox(page.getByRole("complementary", { name: "设计助手", exact: true }))).width).toBeCloseTo(400, 0);
  await expect(input).toBeVisible();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toBeVisible();
  await expect(input).toBeHidden();
  account = "another-designer";
  await page.reload();
  await expect(zhiya(page)).toBeVisible();
  expect((await elementBox(hit(page))).x - original.x).toBeGreaterThan(500);
  await openZhiya(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fashion:workspace-split:another-designer:atelier-visual") ?? "{}").open)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fashion:workspace-split:visual-designer:atelier-visual") ?? "{}").open)).toBe(false);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("聊天、离屏与失焦停止绘制，反复挂载释放 GPU 对象和角色事件监听", async ({ page }) => {
  await page.addInitScript(() => {
    const objects = new Set<object>(), contexts = new WeakSet<object>(), signals = new Set<AbortSignal>();
    let draws = 0;
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof nativeContext>) {
      const context = nativeContext.apply(this, args);
      if (context && String(args[0]) === "webgl" && this.classList.contains("pp-body-mesh") && !contexts.has(context)) {
        contexts.add(context);
        const gl = context as unknown as Record<string, (...args: unknown[]) => unknown>;
        for (const type of ["Buffer", "Texture", "Program", "Shader"]) {
          const create = gl[`create${type}`], release = gl[`delete${type}`];
          gl[`create${type}`] = function (...params) {
            const object = create.apply(this, params);
            if (object) objects.add(object as object);
            return object;
          };
          gl[`delete${type}`] = function (...params) {
            objects.delete(params[0] as object);
            return release.apply(this, params);
          };
        }
        const draw = gl.drawElements;
        gl.drawElements = function (...params) { draws++; return draw.apply(this, params); };
      }
      return context;
    } as typeof nativeContext;
    const listen = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (this instanceof Element && this.closest("[data-zhiya]") && typeof options === "object" && options.signal) signals.add(options.signal);
      return listen.call(this, type, callback, options);
    };
    (window as unknown as { zhiyaResources: () => { draws: number; objects: number; listeners: number } }).zhiyaResources = () => ({ draws, objects: objects.size, listeners: [...signals].filter(signal => !signal.aborted).length });
  });
  const state = await prepareZhiya(page, { activity: { ...emptyActivity(), executing: 1 } });
  await loadZhiya(page);
  const resources = () => page.evaluate(() => (window as unknown as { zhiyaResources: () => { draws: number; objects: number; listeners: number } }).zhiyaResources());
  await expect(zhiya(page)).toHaveAttribute("data-body-surface", "mesh");
  expect((await resources()).objects).toBe(4);
  expect((await resources()).listeners).toBe(1);
  const stopped = async () => {
    await expect(zhiya(page)).toHaveAttribute("data-active", "false");
    await expect(zhiya(page)).toHaveAttribute("data-rendering", "false");
    const before = (await resources()).draws;
    await page.waitForTimeout(500);
    expect((await resources()).draws).toBe(before);
  };
  await openZhiya(page); await stopped();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await zhiya(page).evaluate(node => { node.hidden = true; }); await stopped();
  await zhiya(page).evaluate(node => { node.hidden = false; });
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await stopped();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await stopped();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  for (let cycle = 0; cycle < 3; cycle++) {
    const previous = await zhiya(page).elementHandle();
    await page.getByRole("button", { name: "项目菜单", exact: true }).click();
    await page.getByRole("button", { name: "全部项目", exact: true }).click();
    await expect(zhiya(page)).toHaveCount(0);
    await expect.poll(async () => (await resources()).objects).toBe(0);
    expect((await resources()).listeners).toBe(0);
    expect(await previous?.evaluate(node => [node.isConnected, node.dataset.rendering])).toEqual([false, "false"]);
    await page.getByRole("link", { name: "打开项目 秋冬通勤服装设计", exact: true }).click();
    await expect(zhiya(page)).toHaveAttribute("data-body-surface", "mesh");
    expect((await resources()).objects).toBe(4);
    expect((await resources()).listeners).toBe(1);
  }
  expect(state.errors).toEqual([]);
});
