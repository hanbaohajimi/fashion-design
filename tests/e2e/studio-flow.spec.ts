import { expect, test, type Page } from "@playwright/test";
import {
  createStudioStyleSchema,
  studioDocumentInputSchema,
  type StudioDocumentView,
} from "../../packages/shared/src/studio";
import {
  experimentActionSchema,
  experimentCreateSchema,
  type ExperimentView,
} from "../../packages/shared/src/experiments";
import { createExportSchema } from "../../apps/api/src/modules/exports/exports.schemas";
import {
  studioFixture,
  styleFixture,
} from "../../apps/web/src/modules/studio/studio-test-fixtures";

const PROJECT_ID = "e2e-studio";
const NOW = "2026-10-21T00:00:00.000Z";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="650" viewBox="0 0 500 650"><rect width="500" height="650" fill="#e9e6de"/><path d="M170 140 80 180 45 350 130 370 145 250 145 520 355 520 355 250 370 370 455 350 420 180 330 140 290 190 250 150 210 190Z" fill="#586458" stroke="#26362c" stroke-width="4"/><path d="M250 155v365M170 320h60v85h-60zM275 320h60v85h-60z" fill="none" stroke="#d9ddca" stroke-width="3"/></svg>';
test.setTimeout(60_000);

// Real Next.js pages with isolated API fixtures. Contracts are parsed with the
// same schemas as the server; these tests do not verify the database or queue.
async function mockStudio(page: Page) {
  let data = studioFixture({
    styles: [styleFixture()],
    assets: ["front", "back", "detail", "scene", "alternate"].map((name) => ({
      id: "asset-" + name,
      url: "/studio-fixture/" + name + ".svg",
      thumbnailUrl: null,
    })),
  });
  let batches: ExperimentView[] = [];
  const savedStyles: Array<ReturnType<typeof createStudioStyleSchema.parse>> =
    [];
  const savedDocuments: Array<
    ReturnType<typeof studioDocumentInputSchema.parse>
  > = [];
  const planRequests: Array<ReturnType<typeof experimentCreateSchema.parse>> =
    [];
  const actionRequests: Array<ReturnType<typeof experimentActionSchema.parse>> =
    [];
  const exportRequests: Array<ReturnType<typeof createExportSchema.parse>> = [];
  const unexpected: string[] = [];
  const invalid: string[] = [];
  await page.route("**/studio-fixture/*.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.route("**/images/*.png", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/me")
      return route.fulfill({
        json: {
          user: {
            id: "studio-user",
            authId: "studio-auth",
            email: "studio@example.com",
            name: "设计师",
            avatar: null,
            createdAt: NOW,
            deletedAt: null,
          },
          credits: { limit: 600, remaining: 500, used: 100 },
        },
      });
    if (path === "/api/projects/" + PROJECT_ID)
      return route.fulfill({
        json: {
          id: PROJECT_ID,
          name: "城市漫步 · 春夏设计",
          archived: false,
          createdAt: NOW,
          updatedAt: NOW,
          assetCount: data.assets.length,
          coverAssetId: null,
          coverUrl: null,
        },
      });
    if (path === "/api/projects/" + PROJECT_ID + "/studio")
      return route.fulfill({ json: data });
    if (path === "/api/fabrics")
      return route.fulfill({
        json: { items: [], total: 0, page: 1, limit: 100 },
      });
    if (path.endsWith("/studio/styles") && method === "POST") {
      const result = createStudioStyleSchema.safeParse(request.postDataJSON());
      if (!result.success) {
        invalid.push(result.error.message);
        return route.fulfill({
          status: 400,
          json: { message: result.error.message },
        });
      }
      savedStyles.push(result.data);
      const { requestKey: _requestKey, ...payload } = result.data;
      const revision = {
        id: "created-style-r1",
        revision: 1,
        payload,
        createdAt: NOW,
        views: payload.views.map((view) => ({
          ...view,
          url:
            data.assets.find((asset) => asset.id === view.assetId)?.url ?? "",
          thumbnailUrl: null,
        })),
      };
      const style = {
        id: "created-style",
        code: payload.code,
        name: payload.name,
        category: payload.category,
        season: payload.season,
        status: payload.status,
        version: 1,
        currentRevision: revision,
        revisions: [revision],
      };
      data = { ...data, styles: [...data.styles, style] };
      return route.fulfill({ status: 201, json: style });
    }
    if (path.endsWith("/studio/documents") && method === "POST") {
      const result = studioDocumentInputSchema.safeParse(
        request.postDataJSON(),
      );
      if (!result.success) {
        invalid.push(result.error.message);
        return route.fulfill({
          status: 400,
          json: { message: result.error.message },
        });
      }
      savedDocuments.push(result.data);
      const revision = {
        id: "presentation-r1",
        revision: 1,
        payload: result.data.payload,
        createdAt: NOW,
      };
      const document: StudioDocumentView = {
        id: "presentation-1",
        type: result.data.type,
        version: 1,
        currentRevision: revision,
        revisions: [revision],
      };
      if (result.data.type === "PRESENTATION_SET")
        data = {
          ...data,
          presentationSets: [...data.presentationSets, document],
        };
      return route.fulfill({ status: 201, json: document });
    }
    if (path.endsWith("/experiments") && method === "GET")
      return route.fulfill({ json: batches });
    if (path.endsWith("/experiments") && method === "POST") {
      const result = experimentCreateSchema.safeParse(request.postDataJSON());
      if (!result.success) {
        invalid.push(result.error.message);
        return route.fulfill({
          status: 400,
          json: { message: result.error.message },
        });
      }
      planRequests.push(result.data);
      const input = result.data;
      const cells =
        input.mode === "color"
          ? input.colors.map((color) => ({ title: color.name, color }))
          : input.variations.map((title) => ({ title, color: null }));
      const batch: ExperimentView = {
        id: "batch-1",
        projectId: PROJECT_ID,
        version: 1,
        sourceAssetId: input.sourceAssetId,
        mode: input.mode,
        preserve: input.preserve,
        createdAt: NOW,
        items: cells.map((cell, index) => ({
          id: "cell-" + index,
          title: cell.title,
          color: cell.color,
          prompt: input.prompt,
          status: "draft",
          attempt: 0,
          taskId: null,
          error: null,
          fabric: null,
          assets: [],
        })),
      };
      batches = [batch];
      return route.fulfill({ status: 201, json: batch });
    }
    if (path.endsWith("/experiments/batch-1/actions") && method === "POST") {
      const result = experimentActionSchema.safeParse(request.postDataJSON());
      if (!result.success) {
        invalid.push(result.error.message);
        return route.fulfill({
          status: 400,
          json: { message: result.error.message },
        });
      }
      actionRequests.push(result.data);
      batches = batches.map((batch) => ({
        ...batch,
        items: batch.items.map((item) =>
          result.data.itemIds.includes(item.id)
            ? {
                ...item,
                status: result.data.action === "cancel" ? "canceled" : "queued",
              }
            : item,
        ),
      }));
      return route.fulfill({ json: batches[0] });
    }
    if (path === "/api/exports" && method === "GET")
      return route.fulfill({
        json: { items: [], total: 0, page: 1, hasMore: false },
      });
    if (path === "/api/exports" && method === "POST") {
      const result = createExportSchema.safeParse(request.postDataJSON());
      if (!result.success) {
        invalid.push(result.error.message);
        return route.fulfill({
          status: 400,
          json: { message: result.error.message },
        });
      }
      exportRequests.push(result.data);
      return route.fulfill({
        status: 201,
        json: { id: "export-1", status: "queued" },
      });
    }
    if (path === "/api/exports/export-1")
      return route.fulfill({
        json: {
          id: "export-1",
          status: "succeeded",
          downloadUrl: "/api/exports/export-1/content",
        },
      });
    unexpected.push(method + " " + path);
    return route.fulfill({ status: 404, json: { message: "未模拟此 API" } });
  });
  return {
    savedStyles,
    savedDocuments,
    planRequests,
    actionRequests,
    exportRequests,
    invalid,
    unexpected,
  };
}

async function openTab(page: Page, tab: string) {
  await page.goto("/" + PROJECT_ID + "/studio?tab=" + tab);
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1 }),
  ).toBeVisible();
}

test("款式候选限制为 2–4 张，采用理由和母图随款式保存并在刷新后保留", async ({
  page,
}) => {
  const mocked = await mockStudio(page);
  await openTab(page, "styles");
  const comparison = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "比较候选并选款" }),
  });
  await comparison.locator("summary").click();
  await comparison
    .getByRole("button", { name: "选择图片 1", exact: true })
    .click();
  await expect(
    comparison.getByRole("button", { name: "采用为新款式" }),
  ).toHaveCount(0);
  await comparison
    .getByRole("button", { name: "选择图片 2", exact: true })
    .click();
  await expect(
    comparison.getByRole("button", { name: "采用为新款式" }),
  ).toHaveCount(2);
  await comparison
    .getByRole("button", { name: "选择图片 3", exact: true })
    .click();
  await comparison
    .getByRole("button", { name: "选择图片 4", exact: true })
    .click();
  await comparison
    .getByRole("button", { name: "选择图片 5", exact: true })
    .click();
  await expect(
    comparison.getByText("最多选择 4 张，请先取消一张。"),
  ).toBeVisible();
  await expect(
    comparison.getByRole("button", { name: "采用为新款式" }),
  ).toHaveCount(4);
  await comparison.getByRole("button", { name: "采用为新款式" }).nth(1).click();
  await page.getByLabel("款号", { exact: true }).fill("SS-028-JK02");
  await page.getByLabel("款式名称", { exact: true }).fill("城市褶线夹克");
  await page.getByLabel("品类", { exact: true }).fill("夹克");
  await page.getByLabel(/^采用理由/).fill("第二个方案保留完整口袋和宽松肩线");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect.poll(() => mocked.savedStyles.length).toBe(1);
  expect(mocked.savedStyles[0]).toMatchObject({
    sourceAssetId: "asset-back",
    changeNote: "第二个方案保留完整口袋和宽松肩线",
  });
  await expect(
    page.getByRole("heading", { name: "城市褶线夹克", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("complementary", { name: "已有款式" })
    .getByRole("button", { name: /SS-028-JK02/ })
    .click();
  await expect(page.getByLabel(/^本次修改说明/)).toHaveValue(
    "第二个方案保留完整口袋和宽松肩线",
  );
  expect(mocked.invalid).toEqual([]);
  expect(mocked.unexpected).toEqual([]);
});

test("实验保存只建立草稿，显式提交才将三个方案送入队列", async ({ page }) => {
  const mocked = await mockStudio(page);
  await openTab(page, "experiments");
  await page.getByRole("button", { name: "保存实验计划", exact: true }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "待提交" }),
  ).toHaveCount(3);
  expect(mocked.planRequests).toHaveLength(1);
  expect(mocked.actionRequests).toHaveLength(0);
  expect(mocked.unexpected).toEqual([]);
  await page.screenshot({
    path: "output/playwright/studio-experiments-final-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "提交待执行方案", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "排队中" }),
  ).toHaveCount(3);
  expect(mocked.actionRequests).toEqual([
    { itemIds: ["cell-0", "cell-1", "cell-2"], action: "submit" },
  ]);
  await page.reload();
  await expect(
    page.getByRole("article").filter({ hasText: "排队中" }),
  ).toHaveCount(3);
  expect(mocked.planRequests).toHaveLength(1);
  expect(mocked.invalid).toEqual([]);
});

test("商品展示包逐图复核后绑定确切款式修订保存并请求展示 PDF", async ({
  page,
}) => {
  const mocked = await mockStudio(page);
  await openTab(page, "presentation");
  await page.getByLabel("展示包名称", { exact: true }).fill("春夏商品展示");
  await page.getByRole("button", { name: "选择图片 1", exact: true }).click();
  await page.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await page
    .getByRole("combobox", { name: "图片 1 视图", exact: true })
    .selectOption("front");
  await page
    .getByRole("combobox", { name: "图片 2 视图", exact: true })
    .selectOption("back");
  await page.getByLabel("图片 1 说明", { exact: true }).fill("夹克正面");
  await page.getByLabel("图片 2 说明", { exact: true }).fill("夹克背面");
  await page.getByRole("checkbox", { name: /已人工核对图片 1/ }).check();
  await page
    .getByRole("button", { name: "核对并完成展示包", exact: true })
    .click();
  await expect(page.getByText("交付前请逐张人工核对商品外观")).toBeVisible();
  expect(mocked.savedDocuments).toHaveLength(0);
  await page.getByRole("checkbox", { name: /已人工核对图片 2/ }).check();
  await page
    .getByRole("button", { name: "核对并完成展示包", exact: true })
    .click();
  await expect.poll(() => mocked.savedDocuments.length).toBe(1);
  expect(mocked.savedDocuments[0]).toMatchObject({
    type: "PRESENTATION_SET",
    payload: {
      status: "READY",
      styleRevisionId: "style-r1",
      items: [
        { assetId: "asset-front", kind: "front", reviewed: true },
        { assetId: "asset-back", kind: "back", reviewed: true },
      ],
    },
  });
  await expect(page.getByText("已核对", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: "导出此修订 PDF", exact: true })
    .first()
    .click();
  const download = page
    .getByRole("link", { name: "下载已生成的展示包 PDF", exact: true })
    .first();
  await expect(download).toHaveAttribute(
    "href",
    "/api/exports/export-1/content",
  );
  expect(mocked.exportRequests).toEqual([
    {
      sourceType: "presentation_set",
      studioRevisionId: "presentation-r1",
      format: "pdf",
      quality: "standard",
    },
  ]);
  await expect(
    page.getByRole("link", { name: /下载图片 1/ }).first(),
  ).toHaveAttribute("href", "/api/design-assets/asset-front/content");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/studio-presentation-final-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(mocked.invalid).toEqual([]);
  expect(mocked.unexpected).toEqual([]);
});

test("未保存内容可继续编辑，确认丢弃后新建和切换功能会重置草稿", async ({
  page,
}) => {
  const mocked = await mockStudio(page);
  await openTab(page, "presentation");
  await page.getByLabel("展示包名称", { exact: true }).fill("尚未保存的展示包");
  await page.getByRole("tab", { name: "款式档案", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "保留未保存的修改",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("展示包名称", { exact: true })).toHaveValue(
    "尚未保存的展示包",
  );
  await page.getByRole("button", { name: "新建展示包", exact: true }).click();
  await dialog.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(page.getByLabel("展示包名称", { exact: true })).toHaveValue("");
  await page.getByLabel("展示包名称", { exact: true }).fill("第二份草稿");
  await page.getByRole("tab", { name: "款式档案", exact: true }).click();
  await dialog.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "款式档案", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "商品展示", exact: true }).click();
  await expect(page.getByLabel("展示包名称", { exact: true })).toHaveValue("");
  expect(mocked.savedDocuments).toHaveLength(0);
  expect(mocked.unexpected).toEqual([]);
});
