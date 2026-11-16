import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";
import { canvasAction } from "./canvas-workspace-controls";

const proofDirectory = `output/playwright/canvas-image-sizing/${process.env.IMAGE_PROOF_PHASE === "before" ? "before" : "after"}`;
const shape = (page: Page) => page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]');
const visibleImage = (page: Page) => shape(page).locator("[data-canvas-image=plain]");
const objects = (page: Page) => page.getByRole("region", { name: "画布对象", exact: true });
const imageRow = (page: Page) => objects(page).locator('[data-canvas-object-id="shape:canvas-material-0"]');

async function selectImage(page: Page) {
  await openCanvasFunction(page, "画布对象");
  await imageRow(page).getByRole("button", { name: /^选择/ }).click();
  await objects(page).getByRole("button", { name: "关闭画布对象" }).click();
}

async function fitControl(page: Page) {
  const trigger = page.getByRole("toolbar", { name: "常用图片工具", exact: true }).getByRole("button", { name: "更多图片操作", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  return page.getByRole("group", { name: "更多图片操作选项", exact: true }).getByRole("button", { name: "匹配图片比例", exact: true });
}

function edgeImage(width: number, height: number, transparent = false) {
  const border = Math.min(width, height) * .08;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${transparent ? "" : `<rect width="${width}" height="${height}" fill="#f7f5ef"/>`}
    <rect width="${border}" height="${height}" fill="#ff0000"/>
    <rect x="${width - border}" width="${border}" height="${height}" fill="#0000ff"/>
    <rect x="${border}" width="${width - border * 2}" height="${border}" fill="#00ff00"/>
    <rect x="${border}" y="${height - border}" width="${width - border * 2}" height="${border}" fill="#ffff00"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * .12}" fill="#173b32"/>
  </svg>`;
}

async function prepareImage(page: Page, width: number, height: number, metadata = true, canEdit = true) {
  const state = await prepareZhiya(page, { count: 1, realClock: true, canEdit });
  const node = state.graph.nodes[0];
  if (!node) throw new Error("缺少测试图片");
  node.title = "完整图片参考";
  node.payload = { assetId: "look-0", imageUrl: "/canvas-image-size.svg", ...(metadata ? { width, height } : {}) };
  await page.route("**/canvas-image-size.svg", route => route.fulfill({ contentType: "image/svg+xml", body: edgeImage(width, height) }));
  return { ...state, node };
}

async function loaded(page: Page) {
  await expect.poll(() => shape(page).locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
}

async function exportPixels(page: Page, name: string) {

  const pending = page.waitForEvent("download");
  await openCanvasFunction(page, "导出画布 PNG");
  const download = await pending;
  await mkdir(proofDirectory, { recursive: true });
  await download.saveAs(`${proofDirectory}/${name}.png`);
  const encoded = (await readFile(`${proofDirectory}/${name}.png`)).toString("base64");
  return page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取导出像素");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = { red: 0, green: 0, blue: 0, yellow: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0;
      if (r > 245 && g < 10 && b < 10) colors.red++;
      if (r < 10 && g > 245 && b < 10) colors.green++;
      if (r < 10 && g < 10 && b > 245) colors.blue++;
      if (r > 245 && g > 245 && b < 10) colors.yellow++;
    }
    return colors;
  }, encoded);
}

for (const [name, width, height] of [["宽幅", 1200, 300], ["竖幅", 300, 1200], ["长图", 240, 2400]] as const) {
  test(`${name}图片按原比例加入画布，四边在导出中完整保留`, async ({ page }) => {
    const state = await prepareImage(page, width, height);
    await loadZhiya(page); await loaded(page);
    const pixels = await exportPixels(page, name);
    for (const [color, count] of Object.entries(pixels)) expect(count, `${name}的${color}边缘应保留`).toBeGreaterThan(40);
    const box = await visibleImage(page).boundingBox();
    if (!box) throw new Error("图片不可见");
    expect(box.width / box.height).toBeCloseTo(width / height, 3);
    await page.screenshot({ path: `${proofDirectory}/${name}-canvas.png` });
    expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  });
}

test("缺失尺寸的旧摆放完整显示，可匹配比例、撤销重做并刷新恢复", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300, false);
  await loadZhiya(page); await loaded(page);
  const initial = await visibleImage(page).boundingBox();
  if (!initial) throw new Error("旧摆放不可见");
  expect(initial.width / initial.height).toBeCloseTo(4, 3);
  for (const count of Object.values(await exportPixels(page, "旧摆放完整显示"))) expect(count).toBeGreaterThan(40);
  await selectImage(page);
  const fit = await fitControl(page);
  await expect(fit).toBeEnabled();
  const before = await visibleImage(page).boundingBox();
  if (!before) throw new Error("选中图片不可见");
  await fit.click();
  const after = await visibleImage(page).boundingBox();
  if (!after) throw new Error("比例调整后不可见");
  expect(after.width / after.height).toBeCloseTo(4, 3);
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
  expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 1);
  await expect(await fitControl(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await canvasAction(page, "撤销白板操作");
  expect(await visibleImage(page).boundingBox()).toEqual(before);
  await expect.poll(() => {
    const document = state.saves.at(-1)?.snapshot.document as { store?: Record<string, { props?: { h?: number } }> } | undefined;
    return document?.store?.["shape:canvas-material-0"]?.props?.h;
  }).toBe(380);
  await canvasAction(page, "重做白板操作");
  await expect.poll(() => {
    const store = state.saves.at(-1)?.snapshot.document as { store?: Record<string, { props?: { w?: number; h?: number } }> } | undefined;
    return store?.store?.["shape:canvas-material-0"]?.props?.h;
  }).toBe(80);
  const legacy = state.saves.at(-1)?.snapshot.document as { store?: Record<string, { props?: Record<string, unknown> }> } | undefined;
  const legacyProps = legacy?.store?.["shape:canvas-material-0"]?.props;
  if (!legacyProps) throw new Error("尚未保存图片摆放");
  // Load a real persisted record in the old format, without the optional source-size cache.
  delete legacyProps.imageWidth;
  delete legacyProps.imageHeight;
  delete legacyProps.imageSource;
  await page.reload(); await loaded(page);
  await expect.poll(() => visibleImage(page).boundingBox()).toEqual(after);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const readonly of [false, true]) test(`${readonly ? "只读" : "锁定"}图片保持完整，拒绝修改比例`, async ({ page }) => {
  const state = await prepareImage(page, 1200, 300, false, !readonly);
  await loadZhiya(page); await loaded(page);
  if (!readonly) {
    await openCanvasFunction(page, "画布对象");
    await imageRow(page).getByRole("button", { name: /^锁定/ }).click();
    await objects(page).getByRole("button", { name: "关闭画布对象" }).click();
  }
  await selectImage(page);
  const before = await visibleImage(page).boundingBox();
  await expect(await fitControl(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(await visibleImage(page).boundingBox()).toEqual(before);
  for (const count of Object.values(await exportPixels(page, readonly ? "只读图片" : "锁定图片"))) expect(count).toBeGreaterThan(40);
  if (readonly) expect(state.saves).toEqual([]);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("只读变为可编辑后，已加载的旧图片无需刷新即可匹配比例", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300, false, false);
  await loadZhiya(page); await loaded(page); await selectImage(page);
  const fit = await fitControl(page);
  await expect(fit).toBeDisabled();
  expect(state.saves).toEqual([]);
  state.setCanEdit(true); state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(fit).toBeEnabled(); await fit.click();
  const bounds = await visibleImage(page).boundingBox();
  if (!bounds) throw new Error("图片没有呈现");
  expect(bounds.width / bounds.height).toBeCloseTo(4, 3);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("新版图片比例变化保留摆放和位置，以新图片尺寸匹配且可撤销", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300);
  await loadZhiya(page); await loaded(page);
  const before = await visibleImage(page).boundingBox();
  await page.route("**/canvas-image-size-v2.svg", route => route.fulfill({ contentType: "image/svg+xml", body: edgeImage(300, 1200) }));
  state.node.payload = { assetId: "look-0-v2", imageUrl: "/canvas-image-size-v2.svg", width: 300, height: 1200 };
  state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(shape(page).locator("img")).toHaveAttribute("src", "/canvas-image-size-v2.svg");
  await loaded(page);
  const updated = await visibleImage(page).boundingBox();
  if (!before || !updated) throw new Error("图片不可见");
  expect(updated.x + updated.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
  expect(updated.y + updated.height / 2).toBeCloseTo(before.y + before.height / 2, 1);
  expect(updated.width / updated.height).toBeCloseTo(.25, 3);
  // The old short frame makes the new portrait small; all four edges must still survive.
  for (const count of Object.values(await exportPixels(page, "新版保留摆放"))) expect(count).toBeGreaterThan(0);
  await selectImage(page); await (await fitControl(page)).click();
  const after = await visibleImage(page).boundingBox();
  if (!after) throw new Error("新版图片不可见");
  expect(after.width / after.height).toBeCloseTo(.25, 3);
  await canvasAction(page, "撤销白板操作");
  expect(await visibleImage(page).boundingBox()).toEqual(updated);
  await expect.poll(() => {
    const document = state.saves.at(-1)?.snapshot.document as { store?: Record<string, { props?: { w?: number } }> } | undefined;
    return document?.store?.["shape:canvas-material-0"]?.props?.w;
  }).toBe(320);
  await expect(shape(page).locator("img")).toHaveAttribute("src", "/canvas-image-size-v2.svg");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("透明参考图片不透出占位说明，加载失败可在原位置重试", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300, false);
  state.node.type = "reference_image";
  let requests = 0;
  await page.route("**/canvas-image-size.svg", route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, contentType: "text/plain", body: "暂时不可用" }) :
      route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300, true) });
  });
  await loadZhiya(page);
  await expect(shape(page).getByText("图片暂不可用", { exact: true })).toBeVisible();
  const before = await visibleImage(page).boundingBox();
  await shape(page).getByRole("button", { name: "重新加载图片", exact: true }).click();
  await loaded(page);
  await expect(shape(page).getByText(/图片暂不可用|正在载入图片|IMAGE \/ CDN/)).toHaveCount(0);
  const loadedBounds = await visibleImage(page).boundingBox();
  if (!before || !loadedBounds) throw new Error("图片不可见");
  expect(loadedBounds.width / loadedBounds.height).toBeCloseTo(4, 3);
  expect(loadedBounds.x + loadedBounds.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
  expect(loadedBounds.y + loadedBounds.height / 2).toBeCloseTo(before.y + before.height / 2, 1);
  for (const count of Object.values(await exportPixels(page, "透明参考图片"))) expect(count).toBeGreaterThan(40);
  expect(requests).toBeGreaterThanOrEqual(2);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("320px窄屏可从图片操作区匹配比例并保留居中", async ({ page }) => {
  const state = await prepareImage(page, 300, 1200, false);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadZhiya(page); await loaded(page);
  const before = await visibleImage(page).boundingBox();
  await selectImage(page);
  const fit = await fitControl(page);
  await fit.scrollIntoViewIfNeeded(); await expect(fit).toBeInViewport(); await fit.click();
  const after = await visibleImage(page).boundingBox();
  if (!before || !after) throw new Error("窄屏图片不可见");
  expect(after.width / after.height).toBeCloseTo(.25, 3);
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
  expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(proofDirectory, { recursive: true });
  await page.screenshot({ path: `${proofDirectory}/匹配比例-320.png` });
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("图片读取失败不下载缺图文件，恢复后可用同一地址重新导出", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300);
  let available = false;
  await page.route("**/canvas-image-size.svg", route => available ?
    route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300) }) :
    route.fulfill({ status: 503, contentType: "text/plain", body: "图片暂时不可用" }));
  await loadZhiya(page);
  await expect(shape(page).getByText("图片暂不可用", { exact: true })).toBeVisible();
  let downloads = 0; page.on("download", () => downloads++);

  await openCanvasFunction(page, "导出画布 PNG");
  await expect(page.getByRole("alert").filter({ hasText: "暂时无法导出" })).toBeVisible();
  expect(downloads).toBe(0);
  available = true;
  await shape(page).getByRole("button", { name: "重新加载图片", exact: true }).click(); await loaded(page);
  for (const count of Object.values(await exportPixels(page, "恢复后完整导出"))) expect(count).toBeGreaterThan(40);
  await expect(page.getByRole("alert").filter({ hasText: "暂时无法导出" })).toHaveCount(0);
  expect(downloads).toBe(1);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("导出等待期间图片版本更新时，提示重试并避免混用新旧图片", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300);
  let hold = false, release = () => {}, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/canvas-image-size.svg", async route => {
    if (hold) { started = true; await gate; }
    await route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300) });
  });
  await page.route("**/canvas-image-size-v2.svg", route => route.fulfill({ contentType: "image/svg+xml", body: edgeImage(300, 1200) }));
  await loadZhiya(page); await loaded(page); hold = true;
  let downloads = 0; page.on("download", () => downloads++);

  await openCanvasFunction(page, "导出画布 PNG");
  await expect.poll(() => started).toBe(true);
  state.node.payload = { imageUrl: "/canvas-image-size-v2.svg", width: 300, height: 1200 };
  state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(shape(page).locator("img")).toHaveAttribute("src", "/canvas-image-size-v2.svg");
  release();
  await expect(page.getByRole("alert").filter({ hasText: "图片已更新，请重新导出当前画布" })).toBeVisible();
  expect(downloads).toBe(0);
  for (const count of Object.values(await exportPixels(page, "更新期间重试"))) expect(count).toBeGreaterThan(0);
  expect(downloads).toBe(1);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("同图多份摆放只读取一次导出图片，导出不改写画布地址", async ({ page }) => {
  const state = await prepareZhiya(page, { count: 3, realClock: true });
  for (const node of state.graph.nodes) node.payload = { imageUrl: "/same-source.svg", width: 1200, height: 300 };
  let requests = 0;
  await page.route("**/same-source.svg", route => {
    requests++; return route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300) });
  });
  await loadZhiya(page);
  await expect.poll(() => page.locator('[data-canvas-node-id] img').evaluateAll(images => images.length === 3 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  const before = requests;
  await exportPixels(page, "同图多份摆放");
  expect(requests - before).toBe(1);
  for (const image of await page.locator('[data-canvas-node-id] img').all()) await expect(image).toHaveAttribute("src", "/same-source.svg");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("损坏图片即使返回成功状态也不生成缺图文件", async ({ page }) => {
  const state = await prepareImage(page, 1200, 300);
  await page.route("**/canvas-image-size.svg", route => route.fulfill({ status: 200, contentType: "image/png", body: "not an image" }));
  await loadZhiya(page);
  await expect(shape(page).getByText("图片暂不可用", { exact: true })).toBeVisible();
  let downloads = 0; page.on("download", () => downloads++);

  await openCanvasFunction(page, "导出画布 PNG");
  await expect(page.getByRole("alert").filter({ hasText: "暂时无法导出" })).toBeVisible();
  expect(downloads).toBe(0); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("离开项目取消尚在读取图片的导出，不在其他页面下载旧作品", async ({ page }) => {
  await prepareImage(page, 1200, 300);
  let hold = false, started = false, failed = false, finished = false, release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/canvas-image-size.svg", async route => {
    if (!hold) return route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300) });
    started = true; await gate;
    try { await route.fulfill({ contentType: "image/svg+xml", body: edgeImage(1200, 300) }); }
    catch { /* The request has been canceled by leaving the project. */ }
    finally { finished = true; }
  });
  page.on("requestfailed", request => { if (request.url().endsWith("/canvas-image-size.svg")) failed = true; });
  let downloads = 0; page.on("download", () => downloads++);
  await loadZhiya(page); await loaded(page); hold = true;

  await openCanvasFunction(page, "导出画布 PNG");
  await expect.poll(() => started).toBe(true);
  await page.goto("/projects");
  await expect.poll(() => failed).toBe(true);
  release(); await expect.poll(() => finished).toBe(true);
  expect(downloads).toBe(0);
});
