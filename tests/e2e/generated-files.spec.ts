import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { generatedFilesFixture } from "./generated-files-fixture";
import { loadZhiya, openZhiya, zhiya } from "./zhiya-fixture";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { PROJECT } from "../visual/fixtures";
import { studioFixture, styleFixture, techPackFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import { studioPresentationSchema, type StudioDocumentView } from "../../packages/shared/src/studio";
import { generatedAudioBytes, generatedVideoBytes } from "./generated-media-fixture";
import type { CollectionDetail } from "../../apps/web/src/modules/board/generation/collection-types";

test.setTimeout(60_000);
const panel = (page: Page) => page.getByRole("dialog", { name: "生成文件", exact: true });
const rows = (page: Page) => panel(page).locator("[data-generated-file-id]");
const row = (page: Page, id: string) => panel(page).locator(`[data-generated-file-id="${id}"]`);
const open = async (page: Page) => { await page.getByRole("button", { name: "项目菜单", exact: true }).click(); await page.getByRole("button", { name: "生成文件", exact: true }).click(); await expect(panel(page)).toBeVisible(); };
const close = async (page: Page) => panel(page).getByRole("button", { name: "关闭生成文件", exact: true }).click();

test("生成文件独立于画布完整分页，筛选搜索到未加载的结果", async ({ page }) => {
  const state = await generatedFilesFixture(page); await loadZhiya(page);
  expect(state.requests).toEqual([]); await open(page); await expect(rows(page)).toHaveCount(30);
  await panel(page).getByRole("button", { name: "加载更多文件", exact: true }).click(); await expect(rows(page)).toHaveCount(60);
  await panel(page).getByRole("button", { name: "加载更多文件", exact: true }).click(); await expect(rows(page)).toHaveCount(67);
  expect(new Set(await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-generated-file-id")))).size).toBe(67);
  await panel(page).getByRole("group", { name: "生成文件类型" }).getByRole("button", { name: "视频", exact: true }).click();
  await expect(rows(page)).toHaveCount(7); await expect(rows(page).first()).toContainText("成片");
  await panel(page).getByRole("group", { name: "生成文件类型" }).getByRole("button", { name: "全部", exact: true }).click();
  await panel(page).getByRole("searchbox", { name: "查找生成文件" }).fill("result-66");
  await expect(rows(page)).toHaveCount(1); await expect(rows(page)).toContainText("服装方案 67");
  expect(state.requests.some(query => query.includes("q=result-66"))).toBe(true);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("开合文件列表和预览保留画布、聊天草稿及列表阅读位置", async ({ page }) => {
  const state = await generatedFilesFixture(page); await loadZhiya(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true }); await input.fill("先看看上次的结果，不要发送");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 5)); const element = await input.elementHandle();
  const shape = page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]'), before = await shape.boundingBox();
  await open(page); await expect(rows(page)).toHaveCount(30);
  const preview = row(page, "asset:result-21").getByRole("button", { name: /^预览/ });
  await preview.scrollIntoViewIfNeeded(); const list = panel(page).getByLabel("生成文件列表", { exact: true }); const scroll = await list.evaluate(element => element.scrollTop);
  await preview.click(); await expect(panel(page).getByRole("heading", { name: "服装方案 22", exact: true })).toBeFocused();
  await panel(page).getByRole("button", { name: "返回文件列表", exact: true }).click();
  expect(await list.evaluate(element => element.scrollTop)).toBe(scroll); await expect(preview).toBeFocused();
  await close(page); await expect(panel(page)).toHaveCount(0);
  await expect(input).toHaveValue("先看看上次的结果，不要发送"); expect(await element?.evaluate(element => element.isConnected)).toBe(true);
  expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 5]);
  expect(await shape.boundingBox()).toEqual(before); await expect(page.getByRole("button", { name: "项目菜单", exact: true })).toBeFocused();
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test("首屏和翻页失败可重试，保留已读内容并能刷新新结果", async ({ page }) => {
  const state = await generatedFilesFixture(page); state.failFirst = true; await loadZhiya(page); await open(page);
  await expect(panel(page).getByRole("alert")).toContainText("暂时无法读取"); state.failFirst = false;
  await panel(page).getByRole("button", { name: "重试读取文件" }).click(); await expect(rows(page)).toHaveCount(30);
  state.failNext = true; await panel(page).getByRole("button", { name: "加载更多文件" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("暂时无法读取"); await expect(rows(page)).toHaveCount(30);
  state.failNext = false; await panel(page).getByRole("button", { name: "重试读取文件" }).click(); await expect(rows(page)).toHaveCount(60);
  const initial = state.files[0]; if (!initial) throw new Error("fixture file missing");
  state.files.unshift({ ...initial, id: "asset:new-result", resourceId: "new-result", title: "刚完成的新方案" });
  await panel(page).getByRole("button", { name: "刷新文件" }).click(); await expect(rows(page).first()).toContainText("刚完成的新方案");
  expect(state.errors).toEqual([]);
});

test("原文件下载失败可重试，过期文件保留正确来源", async ({ page }) => {
  const state = await generatedFilesFixture(page); await loadZhiya(page); await open(page); await expect(rows(page)).toHaveCount(30);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WkAAAAASUVORK5CYII=", "base64");
  const server = createServer((_request, response) => { response.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length, "Content-Disposition": "attachment; filename=design.png" }); response.end(bytes); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("下载测试服务未启动");
  state.downloadUrl = `http://127.0.0.1:${address.port}/design.png`;
  try {
  state.failDownload = true; const download = row(page, "asset:look-0").getByRole("button", { name: "下载 藏蓝通勤外套" });
  await download.click(); await expect(row(page, "asset:look-0").getByRole("alert")).toContainText("文件暂时无法读取");
  state.failDownload = false; const pending = page.waitForEvent("download"); await download.click(); const file = await pending;
  const path = await file.path(); if (!path) throw new Error("No download");
  expect((await readFile(path)).subarray(1, 4).toString()).toBe("PNG");
  await expect(row(page, "export:result-5").getByRole("button", { name: /^下载/ })).toBeDisabled();
  await expect(row(page, "export:result-5").getByRole("link", { name: "回到来源重新导出" })).toHaveAttribute("href", /documentId=tech-5/);
  expect(state.downloads).toEqual(["look-0", "look-0"]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("归档历史不在画布仍能查看只读设计路径，当前结果可定位", async ({ page }) => {
  const state = await generatedFilesFixture(page, { canEdit: false }); await loadZhiya(page); await open(page);
  await row(page, "asset:result-1").getByRole("button", { name: /^预览/ }).click();
  await panel(page).getByRole("button", { name: "查看设计路径", exact: true }).click();
  await expect(panel(page).getByRole("region", { name: "步骤详情" })).toContainText("初稿设计要求");
  await expect(panel(page).getByRole("button", { name: "选定此方案", exact: true })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "返回文件列表", exact: true }).click();
  await row(page, "asset:look-0").getByRole("button", { name: "定位到画布", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]')).toBeInViewport();
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test("关闭面板取消下载准备，迟到响应不会触发下载", async ({ page }) => {
  const state = await generatedFilesFixture(page); await loadZhiya(page); await open(page);
  let release = () => {}; state.holdDownload = new Promise<void>(resolve => { release = resolve; });
  let downloads = 0; page.on("download", () => downloads++);
  await row(page, "asset:look-0").getByRole("button", { name: /^下载/ }).click();
  await expect.poll(() => state.downloads.length).toBe(1); await close(page); release();
  await expect(panel(page)).toHaveCount(0); await open(page); await expect(rows(page)).toHaveCount(30);
  expect(downloads).toBe(0); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("320px长标题、筛选与键盘关闭完整可达，织芽关闭后恢复", async ({ page }) => {
  const state = await generatedFilesFixture(page, { width: 320 }); const first = state.files[0]; if (!first) throw new Error("Missing file");
  first.title = "秋冬通勤设计与特殊材质细节的非常长文件名称_服装廓形版本一";
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" }); await loadZhiya(page); await open(page);
  await expect(rows(page)).toHaveCount(30); await expect(zhiya(page)).toHaveAttribute("data-active", "false");
  const closeButton = panel(page).getByRole("button", { name: "关闭生成文件", exact: true });
  expect((await closeButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await panel(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(panel(page).getByRole("button", { name: "音频", exact: true })).toBeInViewport();
  await mkdir("output/playwright/generated-files", { recursive: true }); await page.screenshot({ path: "output/playwright/generated-files/list-320.png" });
  await row(page, "asset:look-0").getByRole("button", { name: /^预览/ }).click();
  await panel(page).getByRole("button", { name: "查看设计路径", exact: true }).click();
  const path = panel(page).getByRole("region", { name: "设计路径", exact: true });
  await expect(path.getByRole("region", { name: "步骤详情" })).toBeVisible();
  expect(await path.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape"); await expect(panel(page).getByRole("searchbox")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(panel(page)).toHaveCount(0);
  await expect(zhiya(page)).toHaveAttribute("data-active", "true"); expect(state.errors).toEqual([]);
});

test("切换账号重新读取，不显示上一账号搜索和预览，迟到下载取消", async ({ page }) => {
  const state = await generatedFilesFixture(page); let account = "visual-designer";
  await seedReturningFeatureGuideUser(page, ["files-other-designer"]);
  await page.route("**/api/me", route => route.fulfill({ json: { user: { id: account, email: "designer@example.com", name: "设计师" }, credits: { limit: 600, used: 0, remaining: 600 } } }));
  await loadZhiya(page); await open(page);
  await panel(page).getByRole("searchbox").fill("藏蓝"); await expect(rows(page)).toHaveCount(1);
  let release = () => {}; state.holdDownload = new Promise<void>(resolve => { release = resolve; });
  let downloads = 0; page.on("download", () => downloads++);
  await row(page, "asset:look-0").getByRole("button", { name: /^下载/ }).click();
  await expect.poll(() => state.downloads.length).toBe(1);
  account = "files-other-designer"; state.files.splice(0, state.files.length);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "fashion:session-change", newValue: "files-account-change" })));
  // The account-scoped workspace remount closes private panels as well as canceling requests.
  await expect(panel(page)).toHaveCount(0);
  await open(page);
  await expect(panel(page).getByRole("searchbox")).toHaveValue("");
  await expect(panel(page).getByText("项目还没有生成文件", { exact: true })).toBeVisible();
  release(); await close(page); await open(page);
  await expect(rows(page)).toHaveCount(0); expect(downloads).toBe(0); expect(state.errors).toEqual([]);
});

test("迟到列表响应不覆盖新筛选，面板关闭停止读取", async ({ page }) => {
  const state = await generatedFilesFixture(page); let release = () => {};
  state.holdList = new Promise<void>(resolve => { release = resolve; }); await loadZhiya(page); await open(page);
  await expect.poll(() => state.requests.length).toBeGreaterThan(0); state.holdList = null;
  await panel(page).getByRole("button", { name: "文档", exact: true }).click(); await expect(rows(page)).toHaveCount(7);
  release(); await expect(rows(page).first()).toContainText("技术包");
  await close(page); const last = state.requests.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(250);
  expect(state.requests.length).toBe(last); expect(state.errors).toEqual([]);
});

test("文件到期立即提示，无额外轮询，失效画布定位保留预览", async ({ page }) => {
  const state = await generatedFilesFixture(page); const first = state.files[0]; if (!first) throw new Error("Missing file");
  first.nodeId = "removed-node"; first.expiresAt = new Date(Date.now() + 8000).toISOString();
  await loadZhiya(page); await open(page); await expect(rows(page)).toHaveCount(30);
  const loadedRequests = state.requests.length;
  await row(page, "asset:look-0").getByRole("button", { name: "定位到画布", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("已没有这个结果");
  await expect(row(page, "asset:look-0").getByRole("button", { name: /^下载/ })).toBeDisabled({ timeout: 12000 });
  expect(state.requests).toHaveLength(loadedRequests); expect(state.downloads).toEqual([]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("媒体预览失败有重试，关闭后移除播放器", async ({ page }) => {
  const state = await generatedFilesFixture(page); let requests = 0;
  await page.route("**/generated-preview-video", route => { requests++; return route.fulfill({ status: 503, body: "temporary unavailable" }); });
  await loadZhiya(page); await open(page);
  await row(page, "runway:result-3").getByRole("button", { name: /^预览/ }).click();
  await expect(panel(page).getByRole("alert")).toContainText("媒体预览暂不可用"); const first = requests;
  await panel(page).getByRole("button", { name: "重试媒体预览", exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(first); await panel(page).getByRole("button", { name: "返回文件列表", exact: true }).click();
  await expect(panel(page).locator("video,audio")).toHaveCount(0); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const kind of ["tech", "presentation"] as const) test(`${kind}导出来源定位准确历史修订，编辑草稿仍是当前版`, async ({ page }) => {
  const state = await generatedFilesFixture(page);
  const original = kind === "tech" ? techPackFixture({ name: "原始技术包" }) : (() => {
    const revision = { id: "presentation-r1", revision: 1, createdAt: "2026-10-21T00:00:00Z", payload: studioPresentationSchema.parse({ name: "原始展示稿", styleRevisionId: "style-r1", items: [{ assetId: "asset-front", kind: "front" }] }) };
    return { id: "presentation-1", type: "PRESENTATION_SET" as const, version: 1, currentRevision: revision, revisions: [revision] } satisfies StudioDocumentView;
  })();
  const old = structuredClone(original.currentRevision);
  original.version = 2; original.currentRevision = { ...old, id: `${old.id}-new`, revision: 2, payload: { ...old.payload, name: "当前编辑版本" } };
  original.revisions = [original.currentRevision, old];
  const data = studioFixture({ styles: [styleFixture()], ...(kind === "tech" ? { techPacks: [original] } : { presentationSets: [original] }) });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: data }));
  const file = state.files[5]; if (!file) throw new Error("Missing export file");
  file.sourceHref = `/${PROJECT}/studio?tab=${kind}&documentId=${original.id}&documentRevisionId=${old.id}&styleRevisionId=style-r1`;
  await loadZhiya(page); await open(page);
  await row(page, file.id).getByRole("link", { name: "回到来源重新导出" }).click();
  const record = page.locator(`[data-linked-document-revision="${old.id}"]`);
  await expect(record).toBeVisible(); await expect(record).toBeFocused();
  await expect(record).toContainText("所选导出文件的来源修订");
  await expect(record).toContainText(String(old.payload.name));
  await expect(page.getByLabel(kind === "tech" ? "技术包名称" : "展示包名称", { exact: true })).toHaveValue("当前编辑版本");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("空结果与图片失败可恢复，图片和媒体预览保持完整内容", async ({ page }) => {
  const state = await generatedFilesFixture(page); await loadZhiya(page); await open(page);
  await panel(page).getByRole("searchbox").fill("不存在的文件");
  await expect(panel(page).getByText("没有找到匹配的生成文件")).toBeVisible();
  await panel(page).getByRole("searchbox").fill(""); await expect(rows(page)).toHaveCount(30);
  const first = state.files[0]; if (!first) throw new Error("Missing image");
  first.contentUrl = "/generated-image-retry.svg"; let failed = true;
  await page.route("**/generated-image-retry.svg", route => failed ? route.fulfill({ status: 503, body: "unavailable" }) : route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="#173b32"/></svg>' }));
  await panel(page).getByRole("button", { name: "刷新文件", exact: true }).click();
  await row(page, "asset:look-0").getByRole("button", { name: /^预览/ }).click();
  await expect(panel(page).getByRole("button", { name: "重试预览" })).toBeVisible(); failed = false;
  await panel(page).getByRole("button", { name: "重试预览" }).click();
  const image = panel(page).getByRole("img", { name: "藏蓝通勤外套" });
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth / image.naturalHeight)).toBe(4);
  expect(state.errors).toEqual([]);
});

test("实际视频和音频可播放，返回列表停止播放并保留原下载入口", async ({ page }) => {
  const state = await generatedFilesFixture(page);
  const videoBytes = generatedVideoBytes;
  const audioBytes = generatedAudioBytes();
  await page.route("**/generated-preview-video", route => route.fulfill({ contentType: "video/mp4", body: videoBytes }));
  await page.route("**/generated-preview-audio", route => route.fulfill({ contentType: "audio/wav", body: audioBytes }));
  await loadZhiya(page); await open(page);
  for (const [id, kind] of [["runway:result-3", "video"], ["runway:result-4", "audio"]] as const) {
    await row(page, id).getByRole("button", { name: /^预览/ }).click();
    const media = panel(page).locator(kind);
    await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    expect(await media.evaluate((element: HTMLMediaElement) => element.paused)).toBe(true);
    await media.evaluate(async (element: HTMLMediaElement) => { element.muted = true; await element.play(); });
    await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(.1);
    const handle = await media.elementHandle();
    await panel(page).getByRole("button", { name: "返回文件列表", exact: true }).click();
    await expect(media).toHaveCount(0); expect(await handle?.evaluate(element => element.isConnected)).toBe(false);
    await expect(row(page, id).getByRole("button", { name: /^下载/ })).toBeEnabled();
  }
  expect(state.downloads).toEqual([]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const missing of [false, true]) test(`系列导出来源${missing ? "已删除时明确提示且不能导出" : "打开原系列并保留重新导出入口"}`, async ({ page }) => {
  const state = await generatedFilesFixture(page);
  const file = state.files[5]; if (!file) throw new Error("Missing export file");
  file.sourceHref = `/${PROJECT}?collectionId=original-collection`;
  const collection: CollectionDetail = {
    id: "original-collection", projectId: PROJECT, name: "原来的秋冬系列", createdAt: file.createdAt, updatedAt: file.createdAt,
    sourceGarmentType: null, hero: { assetId: "look-0", url: "/visual-garment.svg", thumbnailUrl: null },
    dna: { extractionStatus: "ready", fabrics: ["原系列羊毛"], locks: { fabrics: false, moodWords: false, palette: false, silhouettes: false }, moodWords: [], palette: [], referenceFileIds: [], signatureDetails: [], silhouettes: [], updatedAt: file.createdAt },
  };
  const calls: string[] = [];
  await page.route("**/api/collections/original-collection", route => {
    calls.push(route.request().url());
    return route.fulfill(missing ? { status: 404, json: { message: "这个系列已不存在或无法访问" } } : { json: collection });
  });
  await page.route("**/api/collections/original-collection/consistency", route => route.fulfill({ json: { looks: [], referenceLabel: "参考相似度", similarities: [] } }));
  await loadZhiya(page); await open(page);
  await row(page, file.id).getByRole("link", { name: "回到来源重新导出" }).click();
  const drawer = page.getByRole("dialog", { name: "系列 DNA", exact: true });
  await expect(drawer).toBeVisible();
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  if (missing) {
    await expect(drawer.getByRole("alert")).toContainText("这个系列已不存在或无法访问");
    await expect(drawer.getByRole("button", { name: "导出 PDF" })).toBeDisabled();
    await expect(drawer.getByRole("button", { name: "重新读取", exact: true })).toBeEnabled();
  } else {
    await expect(drawer).toContainText("原系列羊毛");
    await expect(drawer.getByRole("button", { name: "导出 PDF" })).toBeEnabled();
  }
  await drawer.getByRole("button", { name: "关闭系列抽屉" }).click();
  await expect(drawer).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const kind of ["tech", "presentation"] as const) test(`${kind}来源修订缺失时明确提示，不覆盖当前草稿`, async ({ page }) => {
  const state = await generatedFilesFixture(page);
  const document = kind === "tech" ? techPackFixture({ name: "当前技术资料" }) : (() => {
    const revision = { id: "presentation-r1", revision: 1, createdAt: "2026-10-21T00:00:00Z", payload: studioPresentationSchema.parse({ name: "当前展示资料", styleRevisionId: "style-r1", items: [{ assetId: "asset-front", kind: "front" }] }) };
    return { id: "presentation-1", type: "PRESENTATION_SET" as const, version: 1, currentRevision: revision, revisions: [revision] } satisfies StudioDocumentView;
  })();
  const data = studioFixture({ styles: [styleFixture()], ...(kind === "tech" ? { techPacks: [document] } : { presentationSets: [document] }) });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: data }));
  const file = state.files[5]; if (!file) throw new Error("Missing export file");
  file.sourceHref = `/${PROJECT}/studio?tab=${kind}&documentId=${document.id}&documentRevisionId=removed-revision`;
  await loadZhiya(page); await open(page);
  await row(page, file.id).getByRole("link", { name: "回到来源重新导出" }).click();
  await expect(page.getByRole("status").filter({ hasText: "来源修订已不可用" })).toBeVisible();
  await expect(page.getByLabel(kind === "tech" ? "技术包名称" : "展示包名称", { exact: true })).toHaveValue(String(document.currentRevision.payload.name));
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("来源已删除的过期文件保留记录，不提供错误跳转", async ({ page }) => {
  const state = await generatedFilesFixture(page);
  const file = state.files[5]; if (!file) throw new Error("Missing export file");
  file.sourceHref = null;
  await loadZhiya(page); await open(page);
  const record = row(page, file.id);
  await expect(record).toContainText("原来源已不可用");
  await expect(record.getByRole("link")).toHaveCount(0);
  await record.getByRole("button", { name: /^预览/ }).click();
  await expect(panel(page)).toContainText("文件已过期，原来源已不可用，导出记录仍保留。");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});
