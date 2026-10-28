import { mkdir, writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

test.describe.configure({ timeout: 90_000 });

const surfaces = [
  { id: "projects", path: "/" },
  { id: "workspace", path: `/${PROJECT}` },
  { id: "studio", path: `/${PROJECT}/studio?tab=styles` },
  { id: "fabrics", path: `/fabrics?from=board&boardId=${PROJECT}` },
  { id: "trends", path: `/trends?from=board&boardId=${PROJECT}` },
] as const;

type Surface = typeof surfaces[number]["id"];
const preferenceKey = (surface: Surface) => `fashion:feature-guide:v1:visual-designer:${surface}`;
const guide = (page: Page) => page.getByRole("dialog", { name: "界面功能指引", exact: true });

async function prepare(page: Page) {
  await seedVisualApp(page, { guides: true });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
  const writes: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      await route.fulfill({ status: 409, json: { message: "功能指引不得提交业务操作" } });
      return;
    }
    await route.fallback();
  });
  return writes;
}

async function expectGuideGeometry(page: Page) {
  const dialog = guide(page);
  await expect(dialog).toBeVisible();
  const card = dialog.locator("[data-feature-guide-card]");
  await expect(card).toBeVisible();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("功能指引几何测试需要固定视口");
  await expect.poll(async () => {
    const box = await card.boundingBox();
    return Boolean(box && box.width >= 200 && box.height > 80 && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
  }, { message: "功能介绍卡应完整位于当前视口内" }).toBe(true);
  await expect.poll(async () => {
    const box = await dialog.locator("[data-feature-guide-highlight]").boundingBox();
    return Boolean(box && box.width >= 24 && box.height >= 24 && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
  }, { message: "高亮必须对应屏幕内可见的功能区域" }).toBe(true);
  await expect(dialog.getByRole("button", { name: "跳过", exact: true })).toBeInViewport();
  const next = dialog.getByRole("button", { name: /^(下一步|完成)$/u });
  await expect(next).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function finishGuide(page: Page) {
  const titles: string[] = [];
  const dialog = guide(page);
  for (let index = 0; index < 12; index += 1) {
    await expectGuideGeometry(page);
    const heading = dialog.getByRole("heading").last();
    const title = await heading.innerText();
    expect(titles, "导览不应循环到已经介绍的步骤").not.toContain(title);
    titles.push(title);
    const complete = dialog.getByRole("button", { name: "完成", exact: true });
    if (await complete.isVisible()) {
      await complete.click();
      await expect(dialog).toBeHidden();
      return titles;
    }
    await dialog.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(heading).not.toHaveText(title);
  }
  throw new Error("功能指引超过预期步骤数，可能未跳过失效目标");
}

async function replayFromAccount(page: Page) {
  await page.getByRole("button", { name: "designer@example.com", exact: true }).click();
  await page.getByRole("button", { name: "功能指引", exact: true }).click();
  await expect(guide(page)).toBeVisible();
}

async function expectHighlightAtTarget(page: Page, selector: string) {
  await expect.poll(async () => {
    const target = await page.locator(selector).boundingBox();
    const highlight = await guide(page).locator("[data-feature-guide-highlight]").boundingBox();
    if (!target || !highlight) return Number.POSITIVE_INFINITY;
    return Math.max(
      Math.abs(highlight.x + highlight.width / 2 - target.x - target.width / 2),
      Math.abs(highlight.y + highlight.height / 2 - target.y - target.height / 2),
    );
  }, { message: "高亮中心应跟随当前目标的位置" }).toBeLessThan(1);
}

for (const width of [320, 390, 1024, 1280, 1440]) {
  for (const surface of surfaces) {
    test(`${surface.id} 功能指引适配 ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      const writes = await prepare(page);
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto(surface.path);
      await expect(guide(page)).toBeVisible();
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), preferenceKey(surface.id))).toBe("viewed");
      await expectGuideGeometry(page);
      if (width === 1440 || width === 390) {
        await mkdir("output/feature-guide", { recursive: true });
        const capture = await page.screenshot({ path: `output/feature-guide/${surface.id}-${width}.png` });
        if (surface.id === "projects") await writeFile(`output/feature-guide/${width === 1440 ? "desktop" : "mobile"}.png`, capture);
      }
      const titles = await finishGuide(page);
      expect(titles.length).toBeGreaterThanOrEqual(2);
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), preferenceKey(surface.id))).toBe("completed");
      expect(writes).toEqual([]);
    });
  }
}

test("跳过后记住选择，账号菜单可重播并完成", async ({ page }) => {
  const writes = await prepare(page);
  await page.goto("/");
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
  await expect(guide(page)).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey("projects"))).toBe("skipped");
  await page.reload();
  await expect(page.locator('[data-guide-page="projects"][data-guide-ready="true"]')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  await replayFromAccount(page);
  await finishGuide(page);
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey("projects"))).toBe("completed");
  expect(writes).toEqual([]);
});

test("业务弹窗关闭前不抢焦点，关闭后再展示功能指引", async ({ page }) => {
  const writes = await prepare(page);
  let releaseProjects: (() => void) | undefined;
  const projectsReady = new Promise<void>(resolve => { releaseProjects = resolve; });
  await page.route("**/api/projects?*", async route => { await projectsReady; await route.fallback(); });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "给新系列一个名字", exact: true });
    await expect(createDialog).toBeVisible();
    releaseProjects?.();
    await expect(page.locator('[data-guide-page="projects"][data-guide-ready="true"]')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(guide(page)).toBeHidden();
    await expect(createDialog.getByRole("textbox", { name: "项目名称", exact: true })).toBeFocused();
    await createDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(guide(page)).toBeVisible();
    await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
    expect(writes).toEqual([]);
  } finally {
    releaseProjects?.();
  }
});

for (const width of [390, 1440]) {
  test(`助手关闭时介绍可见入口，不展开或修改偏好 ${width}`, async ({ page }) => {
    const writes = await prepare(page);
    const splitKey = `fashion:workspace-split:visual-designer:${PROJECT}`;
    const savedSplit = JSON.stringify({ width: 384, open: false });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: splitKey, value: savedSplit });
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/${PROJECT}`);
    await expect(guide(page)).toBeVisible();
    const titles = await finishGuide(page);
    expect(titles).toContain("和设计助手讨论想法");
    expect(titles).not.toContain("明确告诉助手参考什么");
    await expect(page.getByRole("complementary", { name: "设计助手", exact: true })).toBeHidden();
    expect(await page.evaluate(key => localStorage.getItem(key), splitKey)).toBe(savedSplit);
    expect(writes).toEqual([]);
  });
}

test("键盘焦点保留在指引内，Escape 退出并可从菜单再次打开", async ({ page }) => {
  const writes = await prepare(page);
  await page.goto("/");
  await expect(guide(page)).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press(index % 3 ? "Tab" : "Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-feature-guide]")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(guide(page)).toBeHidden();
  await replayFromAccount(page);
  await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
  await guide(page).getByRole("button", { name: "上一步", exact: true }).click();
  await expect(guide(page).getByRole("heading").last()).toHaveText("从这里找到各个工作区");
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
  expect(writes).toEqual([]);
});

test("加载失败时不显示功能指引或记录已看过", async ({ page }) => {
  const writes = await prepare(page);
  await page.route("**/api/projects?*", route => route.fulfill({ status: 503, json: { message: "项目读取暂不可用" } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "项目库", exact: true })).toBeVisible();
  await expect(page.locator('[data-guide-page="projects"]')).toHaveAttribute("data-guide-ready", "false");
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey("projects"))).toBeNull();
  expect(writes).toEqual([]);
});

test("空项目库、面料库和趋势档案仅介绍存在的入口", async ({ page }) => {
  const writes = await prepare(page);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && ["/api/projects", "/api/fabrics", "/api/trends"].includes(path)) {
      await route.fulfill({ json: { items: [], total: 0, page: 1, totalPages: 0, hasMore: false, limit: 30, pageSize: 60 } });
      return;
    }
    await route.fallback();
  });
  for (const surface of surfaces.filter(item => ["projects", "fabrics", "trends"].includes(item.id))) {
    await page.goto(surface.path);
    await expect(guide(page)).toBeVisible();
    const titles = await finishGuide(page);
    expect(titles).not.toContain("找回之前的设计");
    expect(titles).not.toContain("先看面料，再看资料");
    expect(titles).not.toContain("摘要与原始来源一起看");
    expect(titles.length).toBeGreaterThan(0);
  }
  expect(writes).toEqual([]);
});

test("调整窗口和目标移除后重新定位并跳过失效步骤", async ({ page }) => {
  const writes = await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(guide(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectGuideGeometry(page);
  await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
  const content = guide(page).locator("[data-feature-guide-content]");
  await expect(content).toHaveAttribute("data-guide-step", "create");
  await page.locator('[data-guide="projects-create"]').evaluate(element => element.removeAttribute("data-guide"));
  await expect(content).not.toHaveAttribute("data-guide-step", "create");
  await expectGuideGeometry(page);
  await finishGuide(page);
  expect(writes).toEqual([]);
});

test("兄弟内容增高和图片加载只移动目标时，高亮仍跟随目标", async ({ page }) => {
  const writes = await prepare(page);
  let releaseImage: (() => void) | undefined;
  const imageReady = new Promise<void>(resolve => { releaseImage = resolve; });
  await page.route("**/guide-late-layout.svg", async route => {
    await imageReady;
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="72"><rect width="160" height="72" fill="#e9e5df"/></svg>' });
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
    await expect(guide(page).locator("[data-guide-step]")).toHaveAttribute("data-guide-step", "create");
    const target = page.locator('[data-guide="projects-create"]');
    await target.evaluate(element => {
      const box = element.getBoundingClientRect();
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;left:360px;top:180px;width:320px;height:320px;display:flex;flex-direction:column;align-items:flex-start";
      const sibling = document.createElement("div");
      sibling.id = "guide-growing-sibling";
      sibling.style.cssText = "width:160px;height:0;flex:none";
      const image = document.createElement("img");
      image.id = "guide-late-image";
      image.alt = "";
      image.style.cssText = "display:block;width:160px;height:auto;flex:none";
      image.src = "/guide-late-layout.svg";
      element.before(container);
      (element as HTMLElement).style.cssText = `width:${box.width}px;height:${box.height}px;min-width:0;margin:0;flex:none`;
      container.append(sibling, image, element);
    });
    await expectHighlightAtTarget(page, '[data-guide="projects-create"]');
    const original = await target.boundingBox();
    if (!original) throw new Error("新建项目入口应可见");

    await page.locator("#guide-growing-sibling").evaluate(element => { (element as HTMLElement).style.height = "48px"; });
    await expect.poll(async () => (await target.boundingBox())?.y).toBeCloseTo(original.y + 48, 0);
    await expectHighlightAtTarget(page, '[data-guide="projects-create"]');
    const afterSibling = await target.boundingBox();
    if (!afterSibling) throw new Error("兄弟内容增高后入口应保持可见");

    releaseImage?.();
    await expect(page.locator("#guide-late-image")).toHaveJSProperty("naturalHeight", 72);
    await expect.poll(async () => {
      const box = await target.boundingBox();
      return box ? Math.abs(box.y - afterSibling.y) : 0;
    }).toBeGreaterThan(24);
    await expectHighlightAtTarget(page, '[data-guide="projects-create"]');
    const afterImage = await target.boundingBox();
    expect(afterImage?.width).toBeCloseTo(original.width, 1);
    expect(afterImage?.height).toBeCloseTo(original.height, 1);
    await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
    expect(writes).toEqual([]);
  } finally {
    releaseImage?.();
  }
});

test("带边框的滚动祖先只高亮真实内容可视区", async ({ page }) => {
  const writes = await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
  await expect(guide(page).locator("[data-guide-step]")).toHaveAttribute("data-guide-step", "create");
  await page.locator('[data-guide="projects-create"]').evaluate(element => {
    const contents = document.createElement("div");
    contents.style.cssText = "display:contents;overflow:hidden";
    const scroller = document.createElement("div");
    scroller.id = "guide-bordered-scroller";
    scroller.style.cssText = "position:fixed;left:480px;top:240px;width:200px;height:100px;overflow:auto;border-style:solid;border-width:24px 36px 28px 20px;border-color:transparent;box-sizing:content-box;padding:0";
    const overflow = document.createElement("div");
    overflow.style.cssText = "width:180px;height:300px";
    element.before(contents);
    (element as HTMLElement).style.cssText = "position:absolute;left:-60px;top:10px;width:180px;min-width:180px;height:44px;margin:0;box-sizing:border-box";
    scroller.append(overflow, element);
    contents.append(scroller);
  });
  await expect.poll(async () => {
    const target = await page.locator('[data-guide="projects-create"]').boundingBox();
    const scroller = await page.locator("#guide-bordered-scroller").boundingBox();
    const highlight = await guide(page).locator("[data-feature-guide-highlight]").boundingBox();
    if (!target || !scroller || !highlight) return Number.POSITIVE_INFINITY;
    const visibleLeft = scroller.x + 20;
    return Math.max(
      Math.abs(highlight.x + highlight.width / 2 - (visibleLeft + target.x + target.width) / 2),
      Math.abs(highlight.y + highlight.height / 2 - target.y - target.height / 2),
    );
  }, { message: "高亮应以边框内实际可见的按钮部分为中心" }).toBeLessThan(1);
  await expect(guide(page).locator("[data-guide-step]")).toHaveAttribute("data-guide-step", "create");
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
  expect(writes).toEqual([]);
});

test("普通动效下 Escape 经过 120ms 淡出后恢复原焦点", async ({ page }) => {
  const writes = await prepare(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let releaseProjects: (() => void) | undefined;
  const projectsReady = new Promise<void>(resolve => { releaseProjects = resolve; });
  await page.route("**/api/projects?*", async route => { await projectsReady; await route.fallback(); });
  try {
    await page.goto("/");
    const origin = page.getByRole("button", { name: "新建项目", exact: true });
    await origin.focus();
    releaseProjects?.();
    await expect(guide(page)).toBeVisible();
    await expect.poll(() => guide(page).evaluate(element => getComputedStyle(element).opacity)).toBe("1");
    await guide(page).evaluate(element => {
      const result = new Promise<{ opacities: number[]; durations: (number | string)[] }>(resolve => {
        const opacities: number[] = [];
        const durations: (number | string)[] = [];
        const sample = () => {
          if (!element.isConnected || !(element as HTMLDialogElement).open) {
            resolve({ opacities, durations });
            return;
          }
          opacities.push(Number(getComputedStyle(element).opacity));
          for (const animation of element.getAnimations()) {
            const duration = animation.effect?.getTiming().duration;
            if (duration !== undefined) durations.push(duration);
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      (window as Window & { guideExitResult?: typeof result }).guideExitResult = result;
    });
    await page.keyboard.press("Escape");
    const fade = await page.evaluate(() => (window as Window & { guideExitResult?: Promise<{ opacities: number[]; durations: (number | string)[] }> }).guideExitResult);
    expect(fade?.opacities.some(opacity => opacity > 0 && opacity < 1), "关闭时应存在可见的中间透明度").toBe(true);
    expect(fade?.durations).toContain(120);
    await expect(guide(page)).toBeHidden();
    await expect(origin).toBeFocused();
    expect(writes).toEqual([]);
  } finally {
    releaseProjects?.();
  }
});

test("只读款式资料不介绍保存动作，也不会改变原有权限", async ({ page }) => {
  const writes = await prepare(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: {
    ...workspaceFixture(),
    role: "VIEWER",
    capabilities: { edit: false, review: false, manageMembers: false },
  } }));
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await expect(guide(page)).toBeVisible();
  const titles = await finishGuide(page);
  expect(titles).not.toContain("留意保存与提交状态");
  await expect(page.getByText("只读工作区", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("技术包名称", { exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
});

test("完成同类页面指引后，切换项目不会重新自动介绍", async ({ page }) => {
  const writes = await prepare(page);
  await page.route("**/api/projects/second", route => route.fulfill({ json: {
    id: "second", name: "第二个设计项目", archived: false, assetCount: 0,
    coverAssetId: null, coverUrl: null, createdAt: "2026-10-20T02:00:00.000Z", updatedAt: "2026-10-20T02:00:00.000Z",
  } }));
  await page.route("**/api/projects/second/studio", route => route.fulfill({ json: workspaceFixture() }));
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await expect(guide(page)).toBeVisible();
  await finishGuide(page);
  await page.goto("/second/studio?tab=styles");
  await expect(page.locator('[data-guide-page="studio"][data-guide-ready="true"]')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey("studio"))).toBe("completed");
  expect(writes).toEqual([]);
});

test("助手模态展开时等待用户关闭，再介绍工作台", async ({ page }) => {
  const writes = await prepare(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`/${PROJECT}?conversationId=visual-chat`);
  const assistant = page.getByRole("dialog", { name: "设计助手面板", exact: true });
  await expect(assistant).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  await assistant.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(guide(page)).toBeVisible();
  await finishGuide(page);
  await expect(assistant).toBeHidden();
  expect(writes).toEqual([]);
});

test("工作室帮助中的入口关闭原弹窗后重播功能指引", async ({ page }) => {
  const writes = await prepare(page);
  await page.goto(`/${PROJECT}`);
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("button", { name: "流程画布", exact: true }).click();
  await page.getByRole("button", { name: "工作室帮助", exact: true }).click();
  const help = page.getByRole("dialog", { name: "工作室使用帮助", exact: true });
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "查看界面指引", exact: true }).click();
  await expect(help).toBeHidden();
  await expect(guide(page)).toBeVisible();
  await finishGuide(page);
  expect(writes).toEqual([]);
});

test("运行中的指引为新弹窗让出焦点，关闭后恢复当前步骤", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "async-business-dialog";
    dialog.setAttribute("aria-label", "异步业务确认");
    const button = document.createElement("button");
    button.textContent = "关闭业务确认";
    button.onclick = () => { dialog.close(); dialog.remove(); };
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
    button.focus();
  });
  const business = page.getByRole("dialog", { name: "异步业务确认" });
  await expect(guide(page)).toBeHidden();
  await expect(business.getByRole("button")).toBeFocused();
  await business.getByRole("button").click();
  await expect(guide(page)).toBeVisible();
  await expect(guide(page).locator("[data-guide-step]")).toHaveAttribute("data-guide-step", "create");
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
});

test("320 短屏的说明可滚动，操作按钮与高亮保持可见", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  for (let index = 0; index < 4; index += 1) {
    await expectGuideGeometry(page);
    await expect.poll(async () => {
      const card = await guide(page).locator("[data-feature-guide-card]").boundingBox();
      const highlight = await guide(page).locator("[data-feature-guide-highlight]").boundingBox();
      if (!card || !highlight) return false;
      return card.x >= highlight.x + highlight.width || card.x + card.width <= highlight.x || card.y >= highlight.y + highlight.height || card.y + card.height <= highlight.y;
    }).toBe(true);
    const complete = guide(page).getByRole("button", { name: "完成", exact: true });
    if (await complete.isVisible()) { await complete.click(); break; }
    await guide(page).getByRole("button", { name: "下一步", exact: true }).click();
  }
  await expect(guide(page)).toBeHidden();
});

test("指引暂停后将焦点交给非原生业务弹层", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await expect(guide(page)).toBeVisible();
  await page.evaluate(() => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "图片详情");
    modal.style.cssText = "position:fixed;inset:20px;background:white;z-index:1000";
    const close = document.createElement("button");
    close.textContent = "关闭图片详情";
    close.onclick = () => modal.remove();
    modal.append(close);
    document.body.append(modal);
    close.focus();
  });
  const close = page.getByRole("button", { name: "关闭图片详情" });
  await expect(guide(page)).toBeHidden();
  await expect(close).toBeFocused();
  await close.click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole("button", { name: "跳过", exact: true }).click();
});
