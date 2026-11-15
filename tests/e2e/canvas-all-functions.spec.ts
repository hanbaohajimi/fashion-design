import { mkdir } from "node:fs/promises";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { openCanvasFunction } from "./canvas-function-navigation";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { workspaceFixture } from "../visual/workspace-fixture";
import { PROJECT } from "../visual/fixtures";
import { runwayShowFixture } from "../../apps/web/src/modules/runway/runway-test-fixtures";
import { seedCollectionWorkbench } from "./collection-workbench-fixture";

const output = "output/canvas-all-functions";
const entries = [
  { panel: "planning", title: "系列工作台", field: "位置名称" },
  { panel: "brand", title: "品牌资料", field: "品牌名称" },
  { panel: "runway", title: "服装秀", field: "服装秀名称" },
  { panel: "wardrobe", title: "衣橱", field: "搭配名称" },
  { panel: "styles", title: "款式档案", field: "款式名称" },
  { panel: "realtime", title: "实时试穿", field: null },
] as const;

async function setup(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    count: 1,
    realClock: true,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useCanvasPhotograph(page);
  const data = workspaceFixture();
  await seedCollectionWorkbench(page, PROJECT, data);
  let fail = false;
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: "模拟资料读取失败" } })
      : route.fulfill({ json: data }),
  );
  await page.route(`**/api/projects/${PROJECT}/wardrobe`, (route) =>
    route.fulfill({
      json: {
        projectId: PROJECT,
        canEdit: true,
        items: [],
        outfits: [],
        preparations: [],
        tryOns: [],
        capabilities: {
          enabled: true,
          preparationEnabled: true,
          staticTryOnEnabled: true,
          realtimeOutfitEnabled: true,
          realtimeMultiItemVerified: true,
          realtimeCategories: ["top"],
        },
      },
    }),
  );
  await page.route("**/api/realtime-tryon/capabilities", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        configured: false,
        accessMode: "internal",
        provider: "decart",
        modelId: "lucy-vton-3.6",
        maxSessionSeconds: 60,
        maxGarmentBytes: 5242880,
        estimatedUsdPerSecond: null,
        priceVerifiedAt: null,
      },
    }),
  );
  const show = runwayShowFixture({ projectId: PROJECT, runs: [] });
  await page.route(`**/api/projects/${PROJECT}/runway/shows`, (route) =>
    route.fulfill({ json: [show] }),
  );
  await page.route(
    `**/api/projects/${PROJECT}/runway/shows/${show.id}`,
    (route) => route.fulfill({ json: show }),
  );
  await mkdir(output, { recursive: true });
  return Object.assign(state, {
    setFail: (value: boolean) => {
      fail = value;
    },
    data,
  });
}

async function edit(
  panel: (typeof entries)[number],
  dialog: Locator,
  width: number,
) {
  if (panel.panel === "planning") {
    await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
    await dialog.getByRole("button", { name: /轻薄外套主推款/ }).click();
  }
  if (panel.panel === "wardrobe" && width < 768)
    await dialog.getByRole("button", { name: "搭配", exact: true }).click();
  if (panel.field) {
    const field = dialog.getByRole("textbox", {
      name: panel.field,
      exact: true,
    });
    await field.fill(`${panel.title}待继续的草稿`);
    return field;
  }
  const consent = dialog.getByRole("checkbox", { name: /我同意本次/ });
  await consent.check();
  return consent;
}

for (const width of [1440, 390])
  for (const panel of entries) {
    test(`${width}px${panel.title}在当前画布展开，重开保留原界面与草稿`, async ({
      page,
    }) => {
      const state = await setup(page, width);
      await loadZhiya(page);
      const canvas = await page
        .getByLabel("无限白板", { exact: true })
        .elementHandle();
      const image = page.getByRole("group", {
        name: "通勤外套 1",
        exact: true,
      });
      await page.mouse.move(width / 2, 330);
      await page.mouse.wheel(30, 70);
      const position = await image.boundingBox();
      await openCanvasFunction(page, panel.title);
      const dialog = page.getByRole("dialog", {
        name: panel.title,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const input = await edit(panel, dialog, width);
      const identity = await input.elementHandle();
      await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
      await expect(page.locator("[data-archive-navigation]")).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "返回画布", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "全部功能模块", exact: true }),
      ).toBeFocused();
      expect(await canvas?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      expect(await image.boundingBox()).toEqual(position);
      await openCanvasFunction(page, panel.title);
      if (panel.field)
        await expect(input).toHaveValue(`${panel.title}待继续的草稿`);
      else await expect(input).toBeChecked();
      expect(await identity?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await page.screenshot({
        path: `${output}/${panel.panel}-${width}.png`,
        animations: "disabled",
      });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }

test("衣橱保留两条入口，首页侧栏继续进入带项目选择器的独立衣橱", async ({
  page,
}) => {
  await setup(page);
  await loadZhiya(page);
  await openCanvasFunction(page, "衣橱");
  const dialog = page.getByRole("dialog", { name: "衣橱", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  await expect(
    dialog.getByRole("button", { name: "衣橱项目", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "回到主页", exact: true }).click();
  await page
    .getByRole("navigation", { name: "工作区导航", exact: true })
    .getByRole("link", { name: "衣橱", exact: true })
    .click();
  await expect(page).toHaveURL(/\/wardrobe$/);
  await expect(
    page.getByRole("button", { name: "衣橱项目", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-canvas-project-panel]")).toHaveCount(0);
  await page.screenshot({
    path: `${output}/wardrobe-global.png`,
    animations: "disabled",
  });
});

test("系列工作台与品牌资料读取失败后可在原画布重试", async ({ page }) => {
  const state = await setup(page);
  state.setFail(true);
  await loadZhiya(page);
  await openCanvasFunction(page, "品牌资料");
  const dialog = page.getByRole("dialog", { name: "品牌资料", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("模拟资料读取失败");
  state.setFail(false);
  await dialog
    .getByRole("button", { name: "重新读取资料", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "品牌名称", exact: true })
    .fill("读取恢复后继续编辑");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openCanvasFunction(page, "系列工作台");
  await expect(
    page.getByRole("dialog", { name: "系列工作台", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.errors).toEqual([]);
});

test("窄桌面衣橱内的搭配区不遮挡返回画布操作", async ({ page }) => {
  const state = await setup(page, 900);
  await loadZhiya(page);
  await openCanvasFunction(page, "衣橱");
  const dialog = page.getByRole("dialog", { name: "衣橱", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "搭配名称", exact: true }),
  ).toBeVisible();
  await expect(page.locator("dialog:modal")).toHaveCount(1);
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.errors).toEqual([]);
});

test("服装秀保存需求后仍留在当前画布，关闭重开继续同一份需求", async ({
  page,
}) => {
  const state = await setup(page);
  const original = runwayShowFixture({ projectId: PROJECT, runs: [] });
  let writes = 0;
  await page.route(
    `**/api/projects/${PROJECT}/runway/shows/${original.id}`,
    (route) => {
      if (route.request().method() !== "PATCH")
        return route.fulfill({ json: original });
      writes++;
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: { ...original, title: body.title, draft: body.draft, version: 2 },
      });
    },
  );
  await loadZhiya(page);
  await openCanvasFunction(page, "服装秀");
  const dialog = page.getByRole("dialog", { name: "服装秀", exact: true });
  const name = dialog.getByRole("textbox", { name: "服装秀名称", exact: true });
  await name.fill("画布内保存的服装秀");
  await dialog.getByRole("button", { name: "保存需求", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "画布内保存的服装秀", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await openCanvasFunction(page, "服装秀");
  await expect(name).toHaveValue("画布内保存的服装秀");
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.errors).toEqual([]);
});

test("款式继续技术包时在画布内切换面板并携带确切修订", async ({ page }) => {
  const state = await setup(page);
  await loadZhiya(page);
  await openCanvasFunction(page, "款式档案");
  const styles = page.getByRole("dialog", { name: "款式档案", exact: true });
  await styles
    .getByRole("button", { name: "继续创作与交付", exact: true })
    .click();
  await page.getByRole("button", { name: "继续技术包", exact: true }).click();
  const tech = page.getByRole("dialog", { name: "技术包", exact: true });
  await expect(
    tech.getByRole("textbox", { name: "技术包名称", exact: true }),
  ).toBeVisible();
  await expect(styles).toBeHidden();
  await expect(
    tech.getByText("JK-027 款式修订 r1", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("只读项目的新增面板沿用编辑权限", async ({ page }) => {
  const state = await setup(page);
  state.data.capabilities.edit = false;
  state.data.role = "VIEWER";
  await loadZhiya(page);
  for (const panel of entries) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    if (panel.panel === "planning") {
      await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "新增计划位置", exact: true }),
      ).toBeDisabled();
    } else if (panel.panel === "realtime") {
      await expect(
        dialog.getByRole("button", { name: "保存这一帧", exact: true }),
      ).toBeDisabled();
    } else if (panel.field) {
      await expect(
        dialog.getByRole("textbox", { name: panel.field, exact: true }),
      ).toBeDisabled();
    }
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
