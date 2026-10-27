import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { seedVisualApp, NOW, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

const artifacts = "output/playwright/interaction-quality";
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mkdir(artifacts, { recursive: true });
});

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("交互目标不可见");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("桌面磁吸、聚光灯、涟漪和静止性能记录", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame;
    Object.assign(window, { interactionFrames: 0 });
    window.requestAnimationFrame = (callback) => {
      (window as unknown as { interactionFrames: number }).interactionFrames++;
      return original.call(window, callback);
    };
  });
  await page.goto("/");
  const card = page.getByRole("region", { name: "继续创作" });
  const link = card.getByRole("link");
  const visual = link.locator(":scope > span");
  await expect(link).toBeVisible();
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  await page.screenshot({ path: `${artifacts}/desktop-normal.png` });
  const originalBounds = await link.boundingBox();
  const position = await center(link);
  await page.mouse.move(position.x + 30, position.y + 10);
  await expect(card).toHaveAttribute("data-spotlight-active", "true");
  await expect
    .poll(() =>
      visual.evaluate(
        (node) => new DOMMatrix(getComputedStyle(node).transform).m41,
      ),
    )
    .toBeGreaterThan(0);
  const translation = await visual.evaluate((node) => {
    const matrix = new DOMMatrix(getComputedStyle(node).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  expect(Math.abs(translation.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(translation.y)).toBeLessThanOrEqual(4);
  expect(await link.boundingBox()).toEqual(originalBounds);
  await page.screenshot({ path: `${artifacts}/desktop-hover.png` });
  await page.mouse.down();
  await expect
    .poll(() =>
      visual.evaluate(
        (node) => new DOMMatrix(getComputedStyle(node).transform).m41,
      ),
    )
    .toBe(0);
  await page.screenshot({ path: `${artifacts}/desktop-pressed.png` });
  await page.mouse.move(5, 100);
  await page.mouse.up();
  await expect(card).not.toHaveAttribute("data-spotlight-active");

  // Save a Chrome timeline for the pointer-tracking pass, with paint boundaries.
  await expect(page.locator("[data-couture-motion]")).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  const trace: unknown[] = [];
  let layers: Array<{
    backendNodeId?: number;
    layerId: string;
    width: number;
    height: number;
  }> = [];
  cdp.on("LayerTree.layerTreeDidChange", (event) => {
    layers = event.layers ?? [];
  });
  await cdp.send("LayerTree.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'section[aria-label="继续创作"] > span[aria-hidden]',
  });
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  cdp.on("Tracing.dataCollected", ({ value }) => trace.push(...value));
  await cdp.send("Tracing.start", {
    categories:
      "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.invalidationTracking",
    options: "record-as-much-as-possible",
  });
  const cardPosition = await center(card);
  await page.mouse.move(cardPosition.x - 150, cardPosition.y);
  await page.mouse.move(cardPosition.x + 150, cardPosition.y, { steps: 30 });
  await expect
    .poll(() =>
      layers.some((layer) => layer.backendNodeId === node.backendNodeId),
    )
    .toBe(true);
  const glowLayer = layers.find(
    (layer) => layer.backendNodeId === node.backendNodeId,
  );
  const cardBounds = await card.boundingBox();
  expect(glowLayer?.width).toBe(cardBounds?.width);
  expect(glowLayer?.height).toBe(cardBounds?.height);
  await page.mouse.move(5, 100);
  await expect(card).not.toHaveAttribute("data-spotlight-active");
  await expect
    .poll(() =>
      card
        .locator("[aria-hidden]")
        .first()
        .evaluate((node) => getComputedStyle(node).opacity),
    )
    .toBe("0");
  const framesBefore = await page.evaluate(
    () =>
      (window as unknown as { interactionFrames: number }).interactionFrames,
  );
  await page.waitForTimeout(250);
  const framesAfter = await page.evaluate(
    () =>
      (window as unknown as { interactionFrames: number }).interactionFrames,
  );
  expect(framesAfter).toBe(framesBefore);
  const complete = new Promise<void>((resolve) =>
    cdp.once("Tracing.tracingComplete", () => resolve()),
  );
  await cdp.send("Tracing.end");
  await complete;
  await writeFile(
    `${artifacts}/pointer-timeline.json`,
    JSON.stringify({ traceEvents: trace }),
    "utf8",
  );
  await writeFile(
    `${artifacts}/pointer-performance.json`,
    JSON.stringify(
      { glowLayer, cardBounds, idleFrameRequests: framesAfter - framesBefore },
      null,
      2,
    ),
    "utf8",
  );
  await cdp.detach();
  await testInfo.attach("pointer-timeline", {
    path: `${artifacts}/pointer-timeline.json`,
    contentType: "application/json",
  });

  const create = page.getByRole("button", { name: "新建项目", exact: true });
  const createPosition = await center(create);
  await page.mouse.move(createPosition.x, createPosition.y);
  await page.mouse.down();
  const ripple = create.locator("[aria-hidden] > span").last();
  await expect(ripple).toHaveCount(1);
  await ripple.evaluate((node) =>
    node.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = 120;
    }),
  );
  await page.screenshot({ path: `${artifacts}/desktop-ripple.png` });
  await ripple.evaluate((node) =>
    node.getAnimations().forEach((animation) => animation.play()),
  );
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "给新系列一个名字" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "创建项目", exact: true }),
  ).toHaveAttribute("data-interaction", "ripple");
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
});

for (const width of [1440, 1024, 390, 375]) {
  test(`内容与布局 ${width}：长名称、无封面、图片失败、空项目`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let variant = "long";
    await page.route("**/api/projects?*", (route) =>
      route.fulfill({
        json: {
          items:
            variant === "empty"
              ? []
              : [
                  {
                    id: PROJECT,
                    name: "服装系列设计与修订资料".repeat(8),
                    archived: false,
                    assetCount: 0,
                    coverAssetId: null,
                    coverUrl:
                      variant === "failed" ? "/missing-cover.png" : null,
                    createdAt: NOW,
                    updatedAt: NOW,
                  },
                ],
          total: variant === "empty" ? 0 : 1,
          page: 1,
          hasMore: false,
        },
      }),
    );
    await page.route("**/missing-cover.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    for (const state of ["long", "failed", "empty"]) {
      variant = state;
      await page.goto("/");
      if (state === "empty") {
        const start = page.getByRole("button", {
          name: "创建第一个项目",
          exact: true,
        });
        await expect(start).toHaveAttribute("data-interaction", "magnetic");
        await expect(
          page.getByRole("region", { name: "继续创作" }),
        ).toHaveCount(0);
        await start.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        const card = page.getByRole("region", { name: "继续创作" });
        await expect(card).toBeVisible();
        await expect(card.locator("img")).toHaveCount(0);
      }
      await assertNoOverflow(page);
      await page.screenshot({
        path: `${artifacts}/${state}-${width}.png`,
        fullPage: true,
      });
    }
    const selected = page.getByRole("button", { name: "进行中", exact: true });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(
      await selected.evaluate((node) => getComputedStyle(node).boxShadow),
    ).toContain("inset");
    await page.getByRole("button", { name: "已归档", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "已归档", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("偏好动态切换与高对比度保留操作、焦点和选择", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "继续创作" });
  const link = card.getByRole("link");
  const position = await center(link);
  await page.mouse.move(position.x + 20, position.y);
  await expect(card).toHaveAttribute("data-spotlight-active", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(card).not.toHaveAttribute("data-spotlight-active");
  expect(
    await link
      .locator(":scope > span")
      .evaluate((node) => getComputedStyle(node).transform),
  ).toBe("none");
  const create = page.getByRole("button", { name: "新建项目", exact: true });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await page.emulateMedia({
    reducedMotion: "no-preference",
    forcedColors: "active",
  });
  await link.focus();
  await expect(link).toBeFocused();
  expect(
    await link
      .locator(":scope > span")
      .evaluate((node) => getComputedStyle(node).boxShadow),
  ).toBe("none");
  await page.screenshot({ path: `${artifacts}/forced-colors.png` });
  await assertNoOverflow(page);
});

test("保存按钮保留表单、失败草稿、重试与一次提交", async ({ page }) => {
  const studio = workspaceFixture();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studio }),
  );
  let writes = 0;
  await page.route(
    `**/api/projects/${PROJECT}/studio/styles/*`,
    async (route) => {
      writes++;
      if (writes === 1)
        return route.fulfill({
          status: 503,
          json: { message: "暂时无法保存，请重试" },
        });
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: { ...studio.styles[0], ...body, version: 2 },
      });
    },
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  const name = page.getByLabel("款式名称", { exact: true });
  await name.fill("保留完整轮廓的修订");
  const save = page.getByRole("button", { name: "保存修订", exact: true });
  await expect(save).toHaveAttribute("data-interaction", "spring");
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "暂时无法保存" }),
  ).toBeVisible();
  await expect(name).toHaveValue("保留完整轮廓的修订");
  await save.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => writes).toBe(2);
  await expect(save).toBeDisabled();
});

test.describe("触屏", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  test("粗指针不启用悬停效果，轻触仍打开创建窗口", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("region", { name: "继续创作" });
    const link = card.getByRole("link");
    await link.dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    await expect(card).not.toHaveAttribute("data-spotlight-active");
    expect(
      await link
        .locator(":scope > span")
        .evaluate((node) => getComputedStyle(node).transform),
    ).toBe("none");
    await page.getByRole("button", { name: "新建项目", exact: true }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${artifacts}/touch-dialog.png` });
    await assertNoOverflow(page);
  });
});
