import { test, expect } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import {
  workspaceFixture,
  experimentFixture,
} from "../visual/workspace-fixture";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: experimentFixture(PROJECT) }),
  );
});

test("已有款式同时展示作品与资料，离开保护保留修改", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await expect(page.getByAltText("当前款式主设计图")).toBeVisible();
  await expect(page.getByLabel("款式名称", { exact: true })).toBeVisible();
  await page.getByLabel("款式名称", { exact: true }).fill("长袖口修改草稿");
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "长袖口修改草稿",
  );
  await page.getByRole("tab", { name: "技术包", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "保留未保存的修改" }),
  ).toBeVisible();
});

test("手机资料常驻，查看原图后保留草稿", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.getByLabel("款式名称", { exact: true }).fill("手机草稿");
  const trigger = page.getByRole("button", { name: /查看大图：/ }).first();
  await trigger.click();
  const panel = page.getByRole("dialog", { name: /查看大图：/ });
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "手机草稿",
  );
  await expect(
    page.getByRole("button", { name: "保存修订", exact: true }),
  ).toBeVisible();
});

test("实验母图与结果同时出现，设置计划不会执行生成", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto(`/${PROJECT}/studio?tab=experiments`);
  await expect(page.getByAltText("本轮实验母图")).toBeVisible();
  await expect(page.getByRole("heading", { name: "藏蓝方案" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮目标", exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "本轮目标", exact: true })
    .fill("保留版型，比较米白与藏蓝");
  expect(writes).toEqual([]);
});

test("技术包完整复核清单只在复核章节显示", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await expect(
    page.getByRole("region", { name: "发布准备情况" }),
  ).not.toBeVisible();
  await page
    .getByRole("navigation", { name: "技术包章节" })
    .getByRole("button", { name: "复核发布", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "发布准备情况" }),
  ).toBeVisible();
});

test("系列位置收起后再选同一位置保留草稿", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=planning`);
  const position = page.getByRole("button", { name: /轻薄外套主推款/ });
  await position.click();
  await page.getByLabel("位置名称", { exact: true }).fill("尚未保存的位置");
  await page.getByRole("button", { name: "关闭位置编辑" }).click();
  await position.click();
  await expect(page.getByLabel("位置名称", { exact: true })).toHaveValue(
    "尚未保存的位置",
  );
});

for (const [tab, field] of [
  ["tech", "技术包名称"],
  ["samples", "轮次名称"],
])
  test(`${tab} 必填字段错误会定位并聚焦`, async ({ page }) => {
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    await page.getByLabel(field!, { exact: true }).fill("");
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect(page.getByLabel(field!, { exact: true })).toBeVisible();
    await expect(page.getByLabel(field!, { exact: true })).toBeFocused();
  });

test("手机技术包自定义校验定位 BOM 用量", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=tech`);
  await page
    .getByRole("navigation", { name: "技术包章节" })
    .getByRole("button", { name: "BOM", exact: true })
    .click();
  await page.getByLabel("BOM 1 用量", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByLabel("BOM 1 用量", { exact: true })).toBeFocused();
  await expect(page.locator("dialog:modal")).toHaveCount(0);
});

test("手机样衣保存定位问题字段错误", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=samples`);
  await page.getByLabel("问题描述", { exact: true }).fill("");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByLabel("问题描述", { exact: true })).toBeFocused();
  await expect(page.locator("dialog:modal")).toHaveCount(0);
});

for (const [tab, field] of [["samples", "轮次名称"]])
  test(`${tab} 只读成员可以查看常驻资料`, async ({ page }) => {
    await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
      route.fulfill({
        json: {
          ...workspaceFixture(),
          role: "VIEWER",
          capabilities: { edit: false, review: false, manageMembers: false },
        },
      }),
    );
    await page.goto(`/${PROJECT}/studio?tab=${tab}`);
    await expect(page.getByLabel(field!, { exact: true })).toBeVisible();
    await expect(page.getByLabel(field!, { exact: true })).toBeDisabled();
  });

for (const width of [1738, 1440, 1280, 1199, 1024, 390, 720])
  test(`工作室导航与页面在 ${width} 宽无横向溢出`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: width === 720 ? 450 : width < 768 ? 812 : 768,
    });
    for (const tab of [
      "styles",
      "experiments",
      "patterns",
      "tech",
      "samples",
      "presentation",
      "tasks",
      "planning",
      "team",
      "trends",
      "brand",
    ]) {
      await page.goto(`/${PROJECT}/studio?tab=${tab}`);
      await expect(
        page.locator('[role="tabpanel"]:not([hidden]) h2').first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `output/studio-rollout/fixture-${tab}-${width}.png`,
      });
      if (width < 1200)
        await expect(
          page.getByRole("combobox", { name: "当前功能", exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("tab", { name: "品牌资料", exact: true }),
        ).toBeVisible();
    }
  });
