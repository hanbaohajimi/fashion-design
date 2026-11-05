import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { WardrobePreparationView } from "../../packages/shared/src/wardrobe";
import { PROJECT } from "../visual/fixtures";
import { seedWardrobe } from "./wardrobe-fixture";

// Deliberately synthetic: left lens has 30% alpha; right lens is opaque white.
// This tests inspection controls, never garment/material/provider acceptance.
const partialAlpha = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220"><rect x="40" y="70" width="100" height="60" rx="14" fill="white" fill-opacity=".3" stroke="#343434" stroke-width="6"/><rect x="160" y="70" width="100" height="60" rx="14" fill="white" stroke="#343434" stroke-width="6"/><path d="M140 88Q150 78 160 88M40 78 20 65M260 78 280 65" fill="none" stroke="#343434" stroke-width="6"/><text x="150" y="170" text-anchor="middle" font-size="14" fill="#777">ALPHA TEST FIXTURE</text></svg>';
const imageBounds = { width: 300, height: 220, x: 17, y: 62, contentWidth: 266, contentHeight: 112 };
const output = "output/wardrobe-tryon/preview-background";

test.use({ viewport: { width: 1440, height: 1000 }, video: "on" });

async function setup(page: Page) {
  const fixture = await seedWardrobe(page);
  await page.route("**/partial-alpha.svg", route => route.fulfill({ contentType: "image/svg+xml", body: partialAlpha }));
  await page.route("**/visual-garment.svg", route => route.fulfill({ contentType: "image/svg+xml", body: partialAlpha }));
  const item = fixture.summary.items[0];
  if (!item) throw new Error("Missing fixture item");
  item.name = "局部透明测试素材";
  Object.assign(item.currentRevision, { name: item.name, url: "/partial-alpha.svg", imageBounds });
  const preparation: WardrobePreparationView = { id: "alpha-front", projectId: PROJECT, sourceAssetId: "asset-front", name: item.name, category: "accessory", sourceKind: "isolated", mode: "existing", status: "ready", taskId: null, error: null, candidates: [{ assetId: "alpha-candidate", url: "/partial-alpha.svg", imageBounds }], createdAt: new Date(0).toISOString() };
  fixture.summary.preparations = [preparation, { ...preparation, id: "alpha-side", sourceAssetId: item.currentRevision.assetId, presentation: { view: "side", revisionId: item.currentRevision.id, orientation: "left" } }];
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe&assetId=asset-front`);
  await mkdir(output, { recursive: true });
  return fixture;
}

async function inspect(dialog: Locator, candidate: Locator, name: string) {
  await expect.poll(() => candidate.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const originalSource = await candidate.getAttribute("src");
  if (!originalSource) throw new Error("Missing candidate source");
  const values = [];
  for (const [label, value, color] of [["白", "white", "rgb(255, 255, 255)"], ["场景灰", "scene", "rgb(228, 227, 229)"], ["深灰", "dark", "rgb(48, 48, 48)"]] as const) {
    const control = dialog.getByRole("group", { name: "预览底色", exact: true });
    await control.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog.locator(`[data-preview-background="${value}"]`)).toHaveCount(3);
    await expect(candidate.locator("..")).toHaveCSS("background-color", color);
    await expect(candidate).toHaveAttribute("src", originalSource);
    const pixels = await candidate.evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0); const alpha = context.getImageData(75, 100, 1, 1).data[3];
      context.clearRect(0, 0, canvas.width, canvas.height);
      const surface = image.parentElement; if (!surface) throw new Error("Missing inspection surface");
      context.fillStyle = getComputedStyle(surface).backgroundColor; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
      return { alpha, translucent: context.getImageData(75, 100, 1, 1).data[0], opaqueWhite: context.getImageData(205, 100, 1, 1).data[0] };
    });
    expect(pixels.alpha).toBe(77); expect(pixels.opaqueWhite).toBe(255);
    values.push(pixels.translucent);
    if (name === "side") await control.evaluate(node => node.scrollIntoView({ block: "start" }));
    else await control.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `${output}/${name}-${value}.png` });
  }
  expect(values[0]).toBe(255); expect(values[2]).toBeLessThan(120);
}

test("正面候选三底核对保留局部 alpha 且零生成或确认请求", async ({ page }) => {
  const fixture = await setup(page);
  const dialog = page.getByRole("dialog", { name: "准备衣架单品" });
  await dialog.getByRole("button", { name: "查看与继续", exact: true }).click();
  await inspect(dialog, dialog.getByRole("img", { name: "待确认单品候选", exact: true }), "front");
  await expect(dialog.getByRole("button", { name: "确认单品并挂上衣架" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("group", { name: "预览底色", exact: true }).scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: `${output}/front-mobile.png` });
  await dialog.getByRole("img", { name: "待确认单品候选", exact: true }).scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: `${output}/front-mobile-candidate.png` });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("侧挂候选沿用三底核对且不修改来源或保存展示修订", async ({ page }) => {
  const fixture = await setup(page);
  await page.getByRole("dialog", { name: "准备衣架单品" }).getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "查看单品：局部透明测试素材", exact: true }).click();
  await page.getByRole("button", { name: "准备新修订", exact: true }).click();
  await page.getByRole("button", { name: "准备侧挂图与挂具宽度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "准备侧挂展示图" });
  await dialog.getByRole("button", { name: "核对侧挂候选", exact: true }).click();
  await inspect(dialog, dialog.getByRole("img", { name: "待核对侧挂候选", exact: true }), "side");
  await expect(dialog.getByRole("button", { name: "确认侧挂展示图", exact: true })).toBeDisabled();
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("正面挂点只在显式保存挂具设置时创建展示修订", async ({ page }) => {
  const fixture = await setup(page);
  const item = fixture.summary.items[0]; if (!item) throw new Error("Missing fixture item");
  const previous = { ...item.currentRevision };
  const saved: Array<Record<string, unknown>> = [];
  await page.route(`**/api/projects/${PROJECT}/wardrobe/items/${item.id}/presentation`, route => {
    const body = route.request().postDataJSON() as { expectedVersion: number; frontAnchor: { x: number; y: number } };
    saved.push(body);
    item.version += 1;
    item.currentRevision = { ...previous, id: "anchor-adjusted-revision", version: item.version, anchor: body.frontAnchor };
    item.revisions = [...item.revisions, item.currentRevision];
    return route.fulfill({ json: item });
  });
  await page.getByRole("dialog", { name: "准备衣架单品" }).getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "查看单品：局部透明测试素材", exact: true }).click();
  await page.getByRole("button", { name: "准备新修订", exact: true }).click();
  await page.getByRole("button", { name: "准备侧挂图与挂具宽度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "准备侧挂展示图" });
  await dialog.getByRole("spinbutton", { name: "正面挂点横向 %", exact: true }).fill("47.7");
  await dialog.getByRole("spinbutton", { name: "正面挂点纵向 %", exact: true }).fill("17.6");
  const preview = dialog.getByRole("img", { name: "挂架预览：局部透明测试素材", exact: true });
  expect(await preview.locator("[data-garment]").evaluate(node => (node as HTMLElement).style.getPropertyValue("--anchor-y"))).toBe("17.6%");
  expect(saved).toEqual([]); expect(item.currentRevision.id).toBe(previous.id);
  await dialog.getByRole("spinbutton", { name: "正面挂点横向 %", exact: true }).evaluate(node => node.scrollIntoView({ block: "start" }));
  await dialog.screenshot({ path: `${output}/front-anchor-settings.png` });
  await dialog.getByRole("button", { name: "仅保存挂具设置", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toHaveLength(1); expect(saved[0]?.expectedVersion).toBe(previous.version); expect(saved[0]).not.toHaveProperty("sideDisplay");
  expect(item.currentRevision.anchor.y).toBeCloseTo(.176, 5);
  expect(item.currentRevision.assetId).toBe(previous.assetId); expect(item.currentRevision.url).toBe(previous.url);
  expect(item.revisions.find(revision => revision.id === previous.id)?.anchor).toEqual(previous.anchor);
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("侧挂候选修正显式提交并沿用候选来源和取消流程", async ({ page }) => {
  const fixture = await setup(page);
  const item = fixture.summary.items[0]; if (!item) throw new Error("Missing fixture item");
  const frontAsset = item.currentRevision.assetId;
  const requests: Array<Record<string, unknown>> = [];
  const repair: WardrobePreparationView = { ...fixture.summary.preparations[1]!, id: "repair-preparation", status: "queued", taskId: "repair-task", candidates: [] };
  await page.route(`**/api/projects/${PROJECT}/wardrobe/prepare`, route => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    fixture.summary.preparations.push(repair);
    return route.fulfill({ json: repair });
  });
  let canceled = false;
  await page.route("**/api/generations/repair-task", route => {
    expect(route.request().method()).toBe("DELETE");
    canceled = true; repair.status = "canceled";
    return route.fulfill({ json: { id: "repair-task", status: "canceled" } });
  });
  await page.getByRole("dialog", { name: "准备衣架单品" }).getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "查看单品：局部透明测试素材", exact: true }).click();
  await page.getByRole("button", { name: "准备新修订", exact: true }).click();
  await page.getByRole("button", { name: "准备侧挂图与挂具宽度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "准备侧挂展示图" });
  await dialog.getByRole("button", { name: "核对侧挂候选", exact: true }).click();
  await dialog.getByRole("button", { name: "修正此候选", exact: true }).click();
  const submit = dialog.getByRole("button", { name: "确认修正侧挂候选", exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "候选修正说明", exact: true }).fill("保持当前侧挂角度和镜框，只修正镜片局部透明度");
  expect(requests).toEqual([]);
  await dialog.getByRole("button", { name: "修正此候选", exact: true }).evaluate(node => node.scrollIntoView({ block: "start" }));
  await dialog.screenshot({ path: `${output}/side-repair.png` });
  await submit.click();
  await expect(dialog.getByRole("button", { name: "取消侧挂准备", exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ sourceAssetId: "alpha-candidate", sourceKind: "isolated", mode: "extract", referenceAssetIds: [],
    presentation: { view: "side", revisionId: item.currentRevision.id, orientation: "left", repairPreparationId: "alpha-side" } });
  expect(requests[0]).not.toHaveProperty("region");
  await dialog.getByRole("button", { name: "取消侧挂准备", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "取消侧挂准备", exact: true })).toHaveCount(0);
  expect(canceled).toBe(true); expect(item.currentRevision.assetId).toBe(frontAsset);
  expect(fixture.summary.preparations.find(value => value.id === "alpha-side")?.candidates[0]?.assetId).toBe("alpha-candidate");
});
