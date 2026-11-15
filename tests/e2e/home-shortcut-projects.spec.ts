import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { prepareHomeShortcut } from "./home-shortcut-fixture";
import { PROJECT } from "../visual/fixtures";
import {
  openCanvasFunction,
  returnCanvasHome,
} from "./canvas-function-navigation";

const tools = [
  {
    value: "experiments",
    label: "色料实验",
    title: "换色实验",
    field: "本轮目标",
    module: true,
  },
  {
    value: "patterns",
    label: "印花工作台",
    title: "印花工作台",
    field: "方案名称",
    module: true,
  },
  {
    value: "presentation",
    label: "商品展示",
    title: "商品展示",
    field: "展示包名称",
    module: true,
  },
  {
    value: "wardrobe",
    label: "衣橱",
    title: "衣橱",
    field: "搭配名称",
    module: false,
  },
  {
    value: "realtime",
    label: "实时试穿",
    title: "实时试穿",
    field: null,
    module: false,
  },
  {
    value: "runway",
    label: "服装秀",
    title: "服装秀",
    field: "服装秀名称",
    module: false,
  },
] as const;
const output = "output/home-shortcut-projects";

for (const width of [1440, 390])
  for (const tool of tools) {
    test(`${width}px首页${tool.label}直接创建新项目并展开，关闭后继续原画布与草稿`, async ({
      page,
    }) => {
      const state = await prepareHomeShortcut(page, width);
      await page.goto("/");
      await page
        .getByRole("region", { name: "创作快捷入口", exact: true })
        .getByRole("button", { name: tool.label, exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: tool.title,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(/\/shortcut-project-1$/);
      await expect(
        page.getByText(`正在打开${tool.label}…`, { exact: true }),
      ).toHaveCount(0);
      expect(state.projects.size).toBe(1);
      expect(state.projectRequests).toHaveLength(1);
      await expect(page.getByRole("dialog", { name: /选择项目/ })).toHaveCount(
        0,
      );
      await expect(page.locator("[data-archive-navigation]")).toHaveCount(0);
      if (tool.value === "wardrobe" && width < 768)
        await dialog.getByRole("button", { name: "搭配", exact: true }).click();
      const input = tool.field
        ? dialog.getByRole("textbox", { name: tool.field, exact: true })
        : dialog.getByRole("checkbox", { name: /我同意本次/ });
      if (tool.field) await input.fill(`${tool.label}的起步草稿`);
      else await input.check();
      const canvas = await page
        .getByLabel("无限白板", { exact: true })
        .elementHandle();
      const frame = page
        .locator('.tl-shape[data-shape-id^="shape:creation-"]')
        .first();
      const bounds = tool.module ? await frame.boundingBox() : null;
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: `${output}/${tool.value}-${width}.png`,
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "返回画布", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      expect(await canvas?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      if (tool.module) {
        expect(await frame.boundingBox()).toEqual(bounds);
        await page
          .getByRole("button", { name: "打开工作界面", exact: true })
          .click();
      } else await openCanvasFunction(page, tool.label);
      if (tool.field)
        await expect(input).toHaveValue(`${tool.label}的起步草稿`);
      else await expect(input).toBeChecked();
      await expect(page).toHaveURL(/\/shortcut-project-1$/);
      expect(state.mutations).toEqual(["POST /api/projects"]);
      expect(state.errors).toEqual([]);
    });
  }

test("创建回执中断后按原快捷功能重试，沿用同一个新项目", async ({ page }) => {
  const state = await prepareHomeShortcut(page);
  state.loseCreate();
  await page.goto("/");
  await page.getByRole("button", { name: "印花工作台", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "模拟项目创建回执中断" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "重试创建", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "印花工作台", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-1$/);
  expect(state.projects.size).toBe(1);
  expect(state.projectRequests).toHaveLength(2);
  expect(state.projectRequests[0]).toBe(state.projectRequests[1]);
});

test("功能准备失败留在刚创建的画布，刷新恢复不重复创建项目或创作目标", async ({
  page,
}) => {
  const state = await prepareHomeShortcut(page);
  state.loseModule();
  await page.goto("/");
  await page.getByRole("button", { name: "色料实验", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "色料实验未能打开" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-1\?openTool=experiments$/);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "换色实验", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-1$/);
  expect(state.projectRequests).toHaveLength(1);
  expect(state.creationRequests).toHaveLength(1);
  expect(state.records.get("shortcut-project-1")).toHaveLength(1);
});

test("创建期间重复点击只有一次请求；成功后再次点击会新建另一个项目", async ({
  page,
}) => {
  const state = await prepareHomeShortcut(page);
  const release = state.holdCreation();
  await page.goto("/");
  const shortcut = page.getByRole("button", { name: "衣橱", exact: true });
  await shortcut.dblclick();
  await expect.poll(() => state.projectRequests.length).toBe(1);
  for (const tool of tools)
    await expect(
      page.getByRole("button", { name: tool.label, exact: true }),
    ).toBeDisabled();
  release();
  const dialog = page.getByRole("dialog", { name: "衣橱", exact: true });
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await returnCanvasHome(page);
  await shortcut.click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-2$/);
  expect(state.projects.size).toBe(2);
  expect(state.projectRequests[0]).not.toBe(state.projectRequests[1]);
});

test("首页项目卡片继续已有项目，左侧衣橱沿用独立页面和项目选择器", async ({
  page,
}) => {
  const state = await prepareHomeShortcut(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /项目选择器|选择项目/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /秋冬通勤服装设计/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.projectRequests).toHaveLength(0);
  await returnCanvasHome(page);
  await page
    .getByRole("navigation", { name: "工作区导航", exact: true })
    .getByRole("link", { name: "衣橱", exact: true })
    .click();
  await expect(page).toHaveURL(/\/wardrobe$/);
  await expect(
    page.getByRole("button", { name: "衣橱项目", exact: true }),
  ).toBeVisible();
  expect(state.projectRequests).toHaveLength(0);
});

test("打开完成后消费快捷指令，刷新不会重新展开功能", async ({ page }) => {
  const state = await prepareHomeShortcut(page);
  await page.goto("/");
  await page.getByRole("button", { name: "商品展示", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "商品展示", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-1$/);
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("无限白板", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(state.projects.size).toBe(1);
  expect(state.records.get("shortcut-project-1")).toHaveLength(1);
});

test("功能准备失败可以直接重试，保留原项目和操作编号", async ({ page }) => {
  const state = await prepareHomeShortcut(page);
  state.loseModule();
  await page.goto("/");
  await page.getByRole("button", { name: "印花工作台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试打开功能", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试打开功能", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "印花工作台", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/shortcut-project-1$/);
  expect(state.projectRequests).toHaveLength(1);
  expect(state.records.get("shortcut-project-1")).toHaveLength(1);
  expect(new Set(state.creationRequests.map((item) => item.id)).size).toBe(1);
  expect(state.errors).toEqual([]);
});

test("左侧独立衣橱的空状态创建仍留在独立衣橱", async ({ page }) => {
  const state = await prepareHomeShortcut(page);
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
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/wardrobe\?projectId=shortcut-project-1$/);
  await expect(
    page.getByRole("button", { name: "衣橱项目", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-canvas-project-panel]")).toHaveCount(0);
  expect(state.projectRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
