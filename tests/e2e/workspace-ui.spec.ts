import { expect, test } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import {
  workspaceFixture,
  experimentFixture,
} from "../visual/workspace-fixture";
import { contrastFailures, controlFontFailures } from "./review-accessibility";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import { studioDocumentInputSchema } from "../../packages/shared/src/studio";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: experimentFixture(PROJECT) }),
  );
});

test("侧栏完整可达，方向键仅移动焦点，任务正文在笔记本首屏可输入", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  await expect(
    page.getByRole("textbox", { name: "本次任务", exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("tablist", { name: "设计工作室功能" });
  await expect(navigation.getByRole("tab")).toHaveCount(11);
  const tasks = navigation.getByRole("tab", { name: "开始任务", exact: true });
  await tasks.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    navigation.getByRole("tab", { name: "款式档案", exact: true }),
  ).toBeFocused();
  await expect(tasks).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tab=styles/u);
  await tasks.click();
  const prompt = page.getByRole("textbox", { name: "本次任务", exact: true });
  await expect(prompt).toBeInViewport();
  expect((await prompt.boundingBox())!.y).toBeLessThanOrEqual(192);
  await expect(page.getByRole("button", { name: "创作进展" })).toBeInViewport();
});

test("团队局部切换保留草稿，离开模块仍经过未保存保护", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=team`);
  const opinion = page.getByRole("textbox", { name: "评审意见" });
  await opinion.fill("检查口袋位置后再确认此修订");
  await page.getByRole("tab", { name: "成员管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作区成员" })).toBeVisible();
  await page.getByRole("tab", { name: "修订评审", exact: true }).click();
  await expect(opinion).toHaveValue("检查口袋位置后再确认此修订");
  await page.getByRole("tab", { name: "技术包", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保留未保存的修改" });
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(opinion).toHaveValue("检查口袋位置后再确认此修订");
});

test("技术包章节与窄屏重排保留输入，错误和最后操作可达", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await page
    .getByRole("textbox", { name: "技术包名称", exact: true })
    .fill("更新的夹克技术资料");
  await page
    .getByRole("navigation", { name: "技术包章节" })
    .getByRole("button", { name: "POM", exact: true })
    .click();
  await expect(page.getByLabel("POM 1 部位", { exact: true })).toBeInViewport();
  await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue(
    "更新的夹克技术资料",
  );
  for (const viewport of [
    { width: 683, height: 384 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await controlFontFailures(page)).toEqual([]);
    expect(await contrastFailures(page, true)).toEqual([]);
    const save = page.getByRole("button", { name: "保存修订", exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
  }
});

test("只读和长内容在全部模块保留可达资料，缺图可重试", async ({ page }) => {
  test.setTimeout(90_000);
  const data = workspaceFixture();
  const longName = "秋冬通勤服装设计与工艺复核".repeat(12);
  const styles = data.styles.map((style) => ({
    ...style,
    name: longName,
    currentRevision: {
      ...style.currentRevision,
      payload: { ...style.currentRevision.payload, name: longName },
    },
  }));
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: {
        ...data,
        styles,
        role: "VIEWER",
        capabilities: { edit: false, review: false, manageMembers: false },
      },
    }),
  );
  await page.route("**/visual-garment.svg", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
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
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    await expect(
      page.locator('[role="tabpanel"]:not([hidden]) h2').first(),
    ).toBeVisible();
    await expect(
      page.getByText("只读工作区", { exact: true }).last(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await controlFontFailures(page)).toEqual([]);
    const enabledSaves = page.locator('button[type="submit"]:enabled');
    await expect(enabledSaves).toHaveCount(0);
    if (tab === "patterns") {
      await expect(
        page.getByText("图案暂时无法加载", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "重试预览", exact: true }).click();
      await expect(
        page.getByText("图案暂时无法加载", { exact: true }),
      ).toBeVisible();
    }
  }
});

test("空项目的十一项功能保持输入和返回入口可达", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studioFixture({ assets: [] }) }),
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
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
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    await expect(
      page.locator('[role="tabpanel"]:not([hidden]) h2').first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "返回设计画布", exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await controlFontFailures(page)).toEqual([]);
    expect(await contrastFailures(page, true)).toEqual([]);
  }
});

test("技术包跨章节保持同一草稿，隐藏的无效字段会展开并获得焦点", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route(
    `**/api/projects/${PROJECT}/studio/documents`,
    async (route) => {
      const body = studioDocumentInputSchema.parse(
        route.request().postDataJSON(),
      );
      requests.push(body);
      await route.fulfill({ json: workspaceFixture().techPacks[0] });
    },
  );
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await page.getByLabel("技术包名称", { exact: true }).fill("同一份完整草稿");
  await expect(
    page.getByRole("button", { name: "导出此修订 PDF" }).first(),
  ).toBeDisabled();
  const chapters = page.getByRole("navigation", { name: "技术包章节" });
  await chapters.getByRole("button", { name: "BOM", exact: true }).click();
  await page.getByLabel("BOM 1 名称", { exact: true }).fill("");
  await chapters.getByRole("button", { name: "POM", exact: true }).click();
  await page.getByLabel("POM 1 尺寸", { exact: true }).fill("116");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByLabel("BOM 1 名称", { exact: true })).toBeFocused();
  expect(requests).toHaveLength(0);
  await page.getByLabel("BOM 1 名称", { exact: true }).fill("已确认主面料");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    type: "TECH_PACK",
    expectedVersion: 1,
    payload: {
      name: "同一份完整草稿",
      bom: [{ name: "已确认主面料" }],
      pom: [{ value: 116 }],
    },
  });
});

test("375px 任务输入先于素材，折叠品牌规则后不丢失选择", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  const prompt = page.getByRole("textbox", { name: "本次任务", exact: true });
  await prompt.fill("保留宽松廓形并调整袖口");
  expect((await prompt.boundingBox())!.y).toBeLessThan(700);
  const brand = page.locator("summary").filter({ hasText: "品牌关联" });
  await brand.click();
  const select = page.getByRole("combobox", { name: /品牌/ }).last();
  const option = await select.locator("option").last().getAttribute("value");
  await select.selectOption(option!);
  await brand.click();
  await expect(brand).toContainText("山岚");
  await brand.click();
  await expect(select).toHaveValue(option!);
  await expect(prompt).toHaveValue("保留宽松廓形并调整袖口");
});

test("200% 等效可用宽度下十一模块自然重排，主操作和字段仍可达", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 683, height: 384 });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();
    await expect(panel.locator("h2").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await controlFontFailures(page)).toEqual([]);
    expect(await contrastFailures(page, true)).toEqual([]);
    expect(
      await panel.locator('button[data-variant="primary"]:enabled').count(),
    ).toBeLessThanOrEqual(1);
    const action = panel.locator("button:enabled").last();
    if (await action.isVisible()) {
      await action.scrollIntoViewIfNeeded();
      await action.focus();
      await expect(action).toBeInViewport();
      await expect(action).toBeFocused();
    }
  }
});

test("加载和工作室请求失败可恢复到原模块", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/projects/${PROJECT}/studio`, async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      json: { message: "工作室暂时无法读取" },
    });
  });
  await page.goto(`/${PROJECT}/studio?tab=brand`);
  await expect(
    page.getByLabel("正在加载工作室资料", { exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "工作室暂时无法打开" }),
  ).toBeVisible();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "品牌资料", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/tab=brand/u);
});
