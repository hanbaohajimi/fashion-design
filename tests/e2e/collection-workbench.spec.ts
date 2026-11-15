import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { openCanvasFunction } from "./canvas-function-navigation";
import { seedCollectionWorkbench } from "./collection-workbench-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { workspaceFixture } from "../visual/workspace-fixture";
import { PROJECT } from "../visual/fixtures";

const output = "output/collection-workbench";
async function setup(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    count: 1,
    realClock: true,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useCanvasPhotograph(page);
  const data = workspaceFixture();
  let fail = false;
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: "模拟规划读取失败" } })
      : route.fulfill({ json: data }),
  );
  const collections = await seedCollectionWorkbench(page, PROJECT, data);
  await mkdir(output, { recursive: true });
  return {
    ...state,
    data,
    collections,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

for (const width of [1440, 390]) {
  test(`${width}px统一入口，三个分区共享系列并在切换和重开后保留草稿`, async ({
    page,
  }) => {
    const state = await setup(page, width);
    await loadZhiya(page);
    await page
      .getByRole("button", { name: "全部功能模块", exact: true })
      .click();
    const catalog = page.getByRole("dialog", {
      name: "全部功能模块",
      exact: true,
    });
    await expect(
      catalog.getByRole("button", { name: "系列规划", exact: true }),
    ).toHaveCount(0);
    await expect(
      catalog.getByRole("button", { name: "款式档案", exact: true }),
    ).toBeVisible();
    await expect(
      catalog.getByRole("button", { name: "商品展示", exact: true }),
    ).toBeVisible();
    await catalog.getByRole("searchbox", { name: "搜索功能" }).fill("系列规划");
    await catalog
      .getByRole("button", { name: "系列工作台", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "系列工作台",
      exact: true,
    });
    for (const name of ["设计方向", "款式规划", "系列扩展"])
      await expect(
        dialog.getByRole("tab", { name, exact: true }),
      ).toBeVisible();
    await expect(
      dialog.getByText("城市漫步 · 秋冬", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/direction-${width}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
    await dialog.getByRole("button", { name: /轻薄外套主推款/ }).click();
    const name = dialog.getByRole("textbox", { name: "位置名称", exact: true });
    await name.fill("合并后的规划草稿");
    const identity = await name.elementHandle();
    await dialog.getByRole("tab", { name: "系列扩展", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "生成", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "导出 PDF", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${output}/looks-${width}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
    await expect(name).toHaveValue("合并后的规划草稿");
    expect(await identity?.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
    await openCanvasFunction(page, "系列工作台");
    await expect(name).toHaveValue("合并后的规划草稿");
    await page.screenshot({
      path: `${output}/planning-${width}.png`,
      animations: "disabled",
    });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    if (width < 768)
      expect(
        await name.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
    await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
    await name.scrollIntoViewIfNeeded();
    const inputBox = await name.boundingBox();
    const tabsBox = await dialog.getByRole("tablist", { name: "系列工作区" }).boundingBox();
    expect(inputBox!.y).toBeGreaterThanOrEqual(tabsBox!.y + tabsBox!.height);
    await page.screenshot({ path: `${output}/planning-editor-${width}.png`, animations: "disabled" });
  });
}

test("切换系列只显示对应位置，切回原系列恢复未保存内容", async ({ page }) => {
  const state = await setup(page);
  state.data.collections.push({ id: "collection-2", name: "海岸系列" });
  const second = structuredClone(state.data.slots[0]!);
  second.id = "slot-second";
  Object.assign(second.currentRevision.payload, {
    name: "海岸衬衫",
    collectionId: "collection-2",
  });
  state.data.slots.push(second);
  await loadZhiya(page);
  await openCanvasFunction(page, "系列工作台");
  const dialog = page.getByRole("dialog", { name: "系列工作台", exact: true });
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await dialog.getByRole("button", { name: /轻薄外套主推款/ }).click();
  await dialog.getByLabel("位置名称", { exact: true }).fill("城市系列待继续");
  await dialog.getByRole("button", { name: "切换系列", exact: true }).click();
  await page
    .getByRole("button", { name: "保留草稿并切换", exact: true })
    .click();
  await dialog.getByRole("button", { name: "海岸系列", exact: true }).click();
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /轻薄外套主推款/ }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: /海岸衬衫/ }).click();
  await expect(dialog.getByLabel("位置名称", { exact: true })).toHaveValue(
    "海岸衬衫",
  );
  await dialog.getByRole("button", { name: "切换系列", exact: true }).click();
  await dialog
    .getByRole("button", { name: "城市漫步 · 秋冬", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await dialog.getByRole("button", { name: /轻薄外套主推款/ }).click();
  await expect(dialog.getByLabel("位置名称", { exact: true })).toHaveValue(
    "城市系列待继续",
  );
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("规划保存失败可重试，原文档身份与款式修订保持且旧列表不撤回保存结果", async ({
  page,
}) => {
  const state = await setup(page);
  const requests: Record<string, unknown>[] = [];
  await page.route(`**/api/projects/${PROJECT}/studio/documents`, (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    if (requests.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: "模拟规划保存失败" },
      });
    const saved = structuredClone(state.data.slots[0]!);
    saved.version = 2;
    saved.currentRevision = {
      ...saved.currentRevision,
      id: "slot-r2",
      revision: 2,
      payload: input.payload,
    };
    saved.revisions.push(saved.currentRevision);
    return route.fulfill({ json: saved });
  });
  await loadZhiya(page);
  await openCanvasFunction(page, "系列工作台");
  const dialog = page.getByRole("dialog", { name: "系列工作台", exact: true });
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await dialog.getByRole("button", { name: /轻薄外套主推款/ }).click();
  await dialog.getByLabel("位置名称", { exact: true }).fill("已确认的主推款");
  await dialog.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟规划保存失败");
  await expect(dialog.getByLabel("位置名称", { exact: true })).toHaveValue(
    "已确认的主推款",
  );
  await dialog.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /已确认的主推款/ }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[1]).toMatchObject({
    documentId: "collection_slot",
    expectedVersion: 1,
    type: "COLLECTION_SLOT",
    payload: {
      name: "已确认的主推款",
      collectionId: "collection-1",
      styleRevisionId: "style-r1",
    },
  });
  await dialog.getByRole("tab", { name: "设计方向", exact: true }).click();
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await expect(dialog.getByLabel("位置名称", { exact: true })).toHaveValue(
    "已确认的主推款",
  );
  expect(state.errors).toEqual([]);
});

test("旧规划链接进入合并工作台，保留规划记录与只读权限", async ({ page }) => {
  const state = await setup(page);
  state.data.capabilities.edit = false;
  state.data.role = "VIEWER";
  await page.goto(`/${PROJECT}/studio?tab=planning`);
  await expect(
    page.getByRole("tab", { name: "款式规划", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /轻薄外套主推款/ }).click();
  await expect(page.getByLabel("位置名称", { exact: true })).toHaveValue(
    "轻薄外套主推款",
  );
  await expect(page.getByLabel("位置名称", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "新增计划位置", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "系列扩展", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生成", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/tab=planning/);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("空系列保留从已有核心图创建的能力，创建后直接安排位置", async ({
  page,
}) => {
  const state = await setup(page);
  state.data.collections = [];
  state.data.slots = [];
  await loadZhiya(page);
  await openCanvasFunction(page, "系列工作台");
  const dialog = page.getByRole("dialog", { name: "系列工作台", exact: true });
  await expect(dialog.getByLabel("上传主推款")).toBeVisible();
  await dialog
    .getByRole("button", { name: "用第一张设计图建立系列", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await dialog
    .getByRole("button", { name: "新增计划位置", exact: true })
    .click();
  await expect(dialog.getByLabel("位置名称", { exact: true })).toHaveValue("");
  expect(state.collections.writes).toEqual([
    { path: "/api/collections", body: { heroAssetId: "asset-front" } },
  ]);
  expect(state.errors).toEqual([]);
});

test("规划读取失败保留系列方向与扩展，可在当前分区重试", async ({ page }) => {
  const state = await setup(page);
  await loadZhiya(page);
  await openCanvasFunction(page, "系列工作台");
  const dialog = page.getByRole("dialog", { name: "系列工作台", exact: true });
  await expect(
    dialog.getByRole("tab", { name: "设计方向", exact: true }),
  ).toBeVisible();
  state.setFail(true);
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟规划读取失败");
  await dialog.getByRole("tab", { name: "系列扩展", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "生成", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "款式规划", exact: true }).click();
  state.setFail(false);
  await dialog
    .getByRole("button", { name: "重新读取规划", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: /轻薄外套主推款/ }),
  ).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
