import { expect, test, type Page } from "@playwright/test";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";

// These scenarios exercise the editable workflow, not the default design workbench.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fashion:canvas-view", "workflow"));
});
import { mkdir, readFile } from "node:fs/promises";

const PROJECT_ID = "e2e-workflow-export";
const NOW = "2026-10-14T00:00:00.000Z";
const EXPORT_PATH = "output/playwright/workflow-canvas-export.png";

function exportGraph() {
  const common = { status: "completed", createdAt: NOW, updatedAt: NOW };
  return {
    projectId: PROJECT_ID,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      { ...common, id: "brief", kind: "asset", type: "brief", title: "设计目标与需求", x: 40, y: 120, payload: { text: "秋冬通勤风衣，藏蓝色与宽松廓形。" } },
      { ...common, id: "analysis", kind: "tool", type: "analyze_brief", title: "需求分析与提取", x: 390, y: 120, payload: {} },
      { ...common, id: "constraint", kind: "asset", type: "constraint", title: "最终设计约束", x: 740, y: 120, payload: { text: "采用挺括面料，保留肩线与宽松轮廓。" } },
    ],
    edges: [
      { id: "brief-analysis", sourceNodeId: "brief", targetNodeId: "analysis", sourcePort: "out", targetPort: "goal" },
      { id: "analysis-constraint", sourceNodeId: "analysis", targetNodeId: "constraint", sourcePort: "out", targetPort: "source" },
    ],
  };
}

async function mockExportWorkflow(page: Page) {
  await seedReturningFeatureGuideUser(page, ["e2e-user"]);
  const graph = exportGraph();
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "e2e-user", authId: "auth-e2e", email: "export@example.com", name: "Export E2E", avatar: null, createdAt: NOW, deletedAt: null },
    credits: { limit: 600, remaining: 500, used: 100 },
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) => route.fulfill({ json: {
    id: PROJECT_ID, name: "导出内容验证", archived: false, createdAt: NOW, updatedAt: NOW,
    assetCount: 0, coverAssetId: null, coverUrl: null,
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.fulfill({ json: graph }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => route.fulfill({ json: { ...graph, proposals: [] } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/tools`, (route) => route.fulfill({ json: { items: [] } }));
  await page.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  return graph;
}

test("工作流 PNG 导出包含紧凑工具名称和素材文字", async ({ page }) => {
  test.setTimeout(60_000);
  const graph = await mockExportWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  const canvas = page.getByRole("region", { name: "设计工作流画布" });
  await expect(canvas.locator('[data-kind="asset"]')).toHaveCount(2);
  await expect(canvas.locator('[data-kind="tool"]')).toHaveCount(1);
  await expect(canvas.locator('[data-type="constraint"]')).toBeVisible();
  await expect(canvas.locator('[data-workflow-edge]')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  // 工具使用中性细边框，素材继续保留类别色条。
  const readBorderColor = (kind: "tool" | "asset") => canvas.locator(`[data-kind="${kind}"]`).first().evaluate((element) => {
    const channels = getComputedStyle(element).borderLeftColor.match(/\d+/gu);
    if (!channels || channels.length < 3) throw new Error("Node border color is unavailable");
    return { r: Number(channels[0]), g: Number(channels[1]), b: Number(channels[2]) };
  });
  const borderColors = { tool: await readBorderColor("tool"), asset: await readBorderColor("asset") };

  // Map the actual rendered text boxes into the exported graph coordinates.
  // Text is checked inside each node, so arrows alone cannot satisfy the test.
  const textBoxes = await Promise.all(graph.nodes.map(async (node) => {
    const card = canvas.locator(`[data-type="${node.type}"]`);
    const cardBox = await card.boundingBox();
    const titleBox = await card.locator("strong").boundingBox();
    const summaryBox = node.kind === "tool" ? null : await card.locator("p").boundingBox();
    if (!cardBox || !titleBox || (node.kind !== "tool" && !summaryBox)) throw new Error(`${node.id} text boxes are unavailable`);
    const naturalWidth = await card.evaluate((element) => (element as HTMLElement).offsetWidth);
    const zoom = cardBox.width / naturalWidth;
    return {
      id: node.id,
      kind: node.kind,
      width: naturalWidth,
      x: node.x,
      y: node.y,
      title: { x: (titleBox.x - cardBox.x) / zoom, y: (titleBox.y - cardBox.y) / zoom, width: titleBox.width / zoom, height: titleBox.height / zoom },
      summary: summaryBox ? { x: (summaryBox.x - cardBox.x) / zoom, y: (summaryBox.y - cardBox.y) / zoom, width: summaryBox.width / zoom, height: summaryBox.height / zoom } : null,
    };
  }));

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("资料与更多", { exact: true }).click();
  await page.getByRole("button", { name: "导出画布 PNG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`fashion-workflow-${PROJECT_ID}.png`);
  expect(await download.failure()).toBeNull();
  await mkdir("output/playwright", { recursive: true });
  await download.saveAs(EXPORT_PATH);
  const png = await readFile(EXPORT_PATH);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBeGreaterThan(1_500);
  expect(width).toBeLessThan(5_000);
  expect(height).toBeGreaterThan(500);
  expect(height).toBeLessThan(2_000);

  // Decode the file that was downloaded, rather than a screenshot or live DOM.
  const pixels = await page.evaluate(async ({ dataUrl, textBoxes, borderColors }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const bitmap = document.createElement("canvas");
    bitmap.width = image.naturalWidth;
    bitmap.height = image.naturalHeight;
    const context = bitmap.getContext("2d");
    if (!context) throw new Error("PNG canvas context is unavailable");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let toolColorPixels = 0;
    let assetColorPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] ?? 255;
      const g = data[index + 1] ?? 255;
      const b = data[index + 2] ?? 255;
      if (Math.abs(r - borderColors.tool.r) < 3 && Math.abs(g - borderColors.tool.g) < 3 && Math.abs(b - borderColors.tool.b) < 3) toolColorPixels += 1;
      if (Math.abs(r - borderColors.asset.r) < 3 && Math.abs(g - borderColors.asset.g) < 3 && Math.abs(b - borderColors.asset.b) < 3) assetColorPixels += 1;
    }
    const scale = bitmap.width / (Math.max(...textBoxes.map((node) => node.x + node.width)) - 40 + 128);
    const countText = (node: typeof textBoxes[number], box: typeof node.title) => {
      const left = Math.floor((node.x - 40 + 64 + box.x) * scale);
      const top = Math.floor((node.y - 120 + 64 + box.y) * scale);
      const right = Math.ceil(left + box.width * scale);
      const bottom = Math.ceil(top + box.height * scale);
      let darkPixels = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const index = (y * bitmap.width + x) * 4;
          const r = data[index] ?? 255;
          const g = data[index + 1] ?? 255;
          const b = data[index + 2] ?? 255;
          if ((data[index + 3] ?? 0) > 200 && r < 130 && g < 130 && b < 130 && Math.max(r, g, b) - Math.min(r, g, b) < 45) darkPixels += 1;
        }
      }
      return darkPixels;
    };
    return {
      width: bitmap.width,
      height: bitmap.height,
      toolColorPixels,
      assetColorPixels,
      text: textBoxes.map((node) => ({ id: node.id, kind: node.kind, title: countText(node, node.title), summary: node.summary ? countText(node, node.summary) : null })),
    };
  }, { dataUrl: `data:image/png;base64,${png.toString("base64")}`, textBoxes, borderColors });
  expect(pixels.width).toBe(width);
  expect(pixels.height).toBe(height);
  expect(pixels.toolColorPixels, "PNG must contain the tool's neutral outline").toBeGreaterThan(400);
  expect(pixels.assetColorPixels, "PNG must contain both assets' current top border color").toBeGreaterThan(2_000);
  for (const text of pixels.text) {
    expect(text.title, `${text.id} title must be rasterized in the PNG`).toBeGreaterThan(300);
    if (text.kind !== "tool") expect(text.summary, `${text.id} summary must be rasterized in the PNG`).toBeGreaterThan(300);
  }
});
