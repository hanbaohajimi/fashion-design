import { randomUUID } from "node:crypto";
import { test, expect, seedVisualApp, settleImages, PROJECT } from "./fixtures";
import {
  contrastFailures,
  controlFontFailures,
} from "../e2e/review-accessibility";
import { workspaceFixture, experimentFixture } from "./workspace-fixture";

test.beforeEach(async ({ page }) => seedVisualApp(page));

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`workspace ${viewport.width}`, () => {
    test.use({
      viewport,
      hasTouch: viewport.width < 768,
      isMobile: viewport.width < 768,
    });
    for (const tab of [
      "tasks",
      "styles",
      "experiments",
      "patterns",
      "presentation",
      "brand",
      "planning",
      "tech",
      "samples",
      "team",
      "trends",
    ]) {
      test(`${tab} ${viewport.width}`, async ({ page }) => {
        await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
          route.fulfill({ json: workspaceFixture() }),
        );
        await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
          route.fulfill({ json: experimentFixture(PROJECT) }),
        );
        await page.goto(`/${PROJECT}/studio?tab=${tab}`);
        await expect(
          page.locator('[role="tabpanel"]:not([hidden]) h2').first(),
        ).toBeVisible();
        if (tab === "experiments") {
          await expect(
            page.getByRole("heading", { name: "藏蓝方案", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "重试此方案", exact: true }),
          ).toBeVisible();
        }
        await settleImages(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(await controlFontFailures(page)).toEqual([]);
        expect(await contrastFailures(page, true)).toEqual([]);
        await expect(page).toHaveScreenshot(
          `workspace-${tab}-${viewport.width}.png`,
          { fullPage: true },
        );
      });
    }
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}`, () => {
    test.use({
      viewport,
      hasTouch: viewport.width < 768,
      isMobile: viewport.width < 768,
    });
    for (const screen of [
      "login",
      "projects",
      "fabrics",
      "trends",
      "invalid-link",
    ]) {
      test(`${screen} ${viewport.width}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(
          screen === "projects"
            ? "/"
            : screen === "invalid-link"
              ? "/auth/confirm"
              : `/${screen}`,
        );
        await expect(page.locator("main")).toBeVisible();
        if (screen === "projects")
          await expect(page.locator("article")).toHaveCount(2);
        if (screen === "fabrics")
          await expect(
            page
              .getByRole("img", { name: "棉布、哑光、通勤", exact: true })
              .first(),
          ).toBeVisible();
        if (screen === "trends")
          await expect(
            page.getByRole("heading", { name: "克制的都市通勤廓形" }),
          ).toBeVisible();
        if (screen === "invalid-link")
          await expect(page.getByRole("link", { name: /登录/u })).toBeVisible();
        await settleImages(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(await controlFontFailures(page)).toEqual([]);
        expect(await contrastFailures(page)).toEqual([]);
        if (viewport.width < 768)
          expect(
            await page
              .locator(
                'main button,main input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),main select,main summary',
              )
              .evaluateAll((elements) => {
                const minimum = parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    "--control-height-touch",
                  ),
                );
                return elements
                  .filter((element) =>
                    element.checkVisibility({ checkVisibilityCSS: true }),
                  )
                  .map((element) => ({
                    text:
                      element.getAttribute("aria-label") ??
                      element.textContent?.trim().slice(0, 30),
                    height: element.getBoundingClientRect().height,
                    width: element.getBoundingClientRect().width,
                  }))
                  .filter(
                    (item) =>
                      item.height + 0.1 < minimum || item.width + 0.1 < minimum,
                  );
              }),
          ).toEqual([]);
        await expect(page).toHaveScreenshot(`${screen}-${viewport.width}.png`, {
          fullPage: true,
        });
      });
    }
  });
}

test("trend destination keeps a single action and restores focus", async ({
  page,
}) => {
  await page.goto("/trends");
  const entry = page
    .getByRole("button", { name: "加入工作流", exact: true })
    .first();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "选择存入位置" });
  await expect(
    dialog.getByRole("button", { name: /秋冬通勤服装设计/u }),
  ).toBeVisible();
  await expect(
    dialog.locator('button[data-variant="primary"]:enabled'),
  ).toHaveCount(1);
  expect(await contrastFailures(page, true)).toEqual([]);
  await expect(page).toHaveScreenshot("trend-destination.png");
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
});

test("project empty and failure states", async ({ page }) => {
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "从第一个系列开始" }),
  ).toBeVisible();
  await expect(page.locator('main button[data-variant="primary"]')).toHaveCount(
    1,
  );
  await expect(page).toHaveScreenshot("projects-empty.png");
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "项目暂时无法读取，请重试" },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("项目暂时无法读取，请重试", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("projects-error.png");
});

test("readonly technical revision remains readable", async ({ page }) => {
  const data = workspaceFixture();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: {
        ...data,
        role: "VIEWER",
        capabilities: { edit: false, review: false, manageMembers: false },
      },
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await expect(
    page.getByText("只读工作区", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("技术包名称", { exact: true })).toBeDisabled();
  await settleImages(page);
  expect(await contrastFailures(page, true)).toEqual([]);
  await expect(page).toHaveScreenshot("workspace-tech-readonly.png", {
    fullPage: true,
  });
});

for (const tab of ["tasks", "experiments"]) {
  test(`${tab} readonly workspace`, async ({ page }) => {
    const data = workspaceFixture();
    await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
      route.fulfill({
        json: {
          ...data,
          role: "VIEWER",
          capabilities: { edit: false, review: false, manageMembers: false },
        },
      }),
    );
    await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
      route.fulfill({ json: experimentFixture(PROJECT) }),
    );
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    await expect(
      page.getByText("只读工作区", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.locator('main button[data-variant="primary"]:enabled'),
    ).toHaveCount(0);
    await settleImages(page);
    expect(await contrastFailures(page, true)).toEqual([]);
    await expect(page).toHaveScreenshot(`workspace-${tab}-readonly.png`, {
      fullPage: true,
    });
  });
}

test("task request failure retains the complete draft", async ({ page }) => {
  // Docker 的 host.docker.internal HTTP 不提供 secure-context UUID；此用例只验证失败界面。
  // 请求键由 Node 原生 API 提供，生产逻辑及 localhost 业务回归继续使用浏览器原生实现。
  await page.addInitScript((requestKey) => {
    if (typeof crypto.randomUUID !== "function") {
      Object.defineProperty(crypto, "randomUUID", { value: () => requestKey });
    }
  }, randomUUID());
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(`**/api/projects/${PROJECT}/workflow`, (route) =>
    route.fulfill({
      status: 503,
      json: { message: "任务暂时无法提交，请重试" },
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  await page
    .getByLabel("本次任务", { exact: true })
    .fill("保持夹克廓形并调整袖口");
  await page.getByLabel(/^必须保留/u).fill("双口袋和肩线");
  await page.getByRole("button", { name: "选择图片 1", exact: true }).click();
  await page.getByRole("button", { name: "生成效果图", exact: true }).click();
  await expect(
    page.getByText("任务暂时无法提交，请重试", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "本次任务", exact: true }),
  ).toHaveValue("保持夹克廓形并调整袖口");
  await settleImages(page);
  expect(await contrastFailures(page, true)).toEqual([]);
  await expect(page).toHaveScreenshot("workspace-task-request-failure.png", {
    fullPage: true,
  });
});

test("design preview failure keeps the editor and retry available", async ({
  page,
}) => {
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route("**/visual-garment.svg", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await expect(
    page.getByRole("button", { name: "重试预览", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("款式名称", { exact: true })).toBeVisible();
  expect(await contrastFailures(page, true)).toEqual([]);
  await expect(page).toHaveScreenshot("workspace-style-image-failure.png", {
    fullPage: true,
  });
});

test("experiment request failure retains configuration", async ({ page }) => {
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({
      status: 503,
      json: { message: "实验暂时无法读取，请重试" },
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=experiments`);
  await expect(
    page.getByText("实验暂时无法读取，请重试", { exact: true }),
  ).toBeVisible();
  await settleImages(page);
  expect(await controlFontFailures(page)).toEqual([]);
  expect(await contrastFailures(page, true)).toEqual([]);
  await expect(page).toHaveScreenshot(
    "workspace-experiment-request-failure.png",
    { fullPage: true },
  );
});

test.describe("studio touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("assistant actions remain reachable with touch controls", async ({
    page,
  }) => {
    await page.goto(`/${PROJECT}`);
    await page.getByRole("button", { name: "助手", exact: true }).click();
    const send = page.getByRole("button", { name: "发送 ↑", exact: true });
    await expect(send).toBeInViewport({ ratio: 1 });
    const minimum = await page.evaluate(() =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--control-height-touch",
        ),
      ),
    );
    for (const target of [
      send,
      page.getByRole("button", { name: "收起设计助手" }),
      page.getByText("更多", { exact: true }),
      page.getByRole("link", { name: "项目库", exact: true }),
    ]) {
      const bounds = await target.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(minimum);
      expect(bounds!.height).toBeGreaterThanOrEqual(minimum);
    }
    await expect(page).toHaveScreenshot("studio-assistant-touch.png");
    await page.getByText("更多", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "新建设计对话", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(page).toHaveScreenshot("studio-menu-touch.png");
  });
});

test("studio, sketch, asset and export", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "流程画布", exact: true }).click();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(1);
  await page.getByRole("button", { name: "适合画布" }).click();
  await expect(page.locator('[data-type="candidate"]')).toBeInViewport({
    ratio: 0.999,
  });
  await settleImages(page);
  await expect(page).toHaveScreenshot("studio-desktop.png");
  await page.getByRole("button", { name: "＋ 添加素材", exact: true }).click();
  await page
    .getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "绘制廓形草图" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("sketch.png");
  expect(await controlFontFailures(page)).toEqual([]);
  expect(await contrastFailures(page, true)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator('[data-type="candidate"]').focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "图片工作区" }),
  ).toBeVisible();
  await settleImages(page);
  await expect(page).toHaveScreenshot("asset-preview.png");
  expect(await controlFontFailures(page)).toEqual([]);
  expect(await contrastFailures(page, true)).toEqual([]);
  const image = page.getByRole("dialog", { name: "图片工作区", exact: true });
  await image.getByRole("button", { name: "图像", exact: true }).click();
  const history = image.getByRole("button", { name: "版本历史", exact: true });
  await history.focus();
  await history.press("Enter");
  await expect(page.getByRole("region", { name: "版本时间线" })).toBeVisible();
  await expect(page).toHaveScreenshot("asset-history-empty.png");
  await image.getByRole("button", { name: "图像", exact: true }).click();
  await image.getByRole("button", { name: "更多导出选项", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始导出", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("export-ready.png");
  expect(await controlFontFailures(page)).toEqual([]);
  expect(await contrastFailures(page, true)).toEqual([]);
});
