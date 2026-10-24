import { expect, test } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import {
  workspaceFixture,
  experimentFixture,
} from "../visual/workspace-fixture";
import { contrastFailures, controlFontFailures } from "./review-accessibility";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";

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
    .getByRole("link", { name: "POM", exact: true })
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
