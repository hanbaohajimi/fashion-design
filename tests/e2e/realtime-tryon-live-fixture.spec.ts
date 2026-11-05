import { expect, test, type Page } from "@playwright/test";
import { buildTryOnHarness } from "./fixtures/realtime-tryon-harness";

test.setTimeout(60_000);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function setup(page: Page, uiCase = "default") {
  page.on("pageerror", (error) => console.error("Try-on fixture browser error:", error.message));
  const bundle = await buildTryOnHarness();
  const state = {
    creates: 0, signs: 0, uploads: 0, completes: 0, ends: 0,
    captureBodies: [] as Array<{ width: number; height: number; garmentAssetId: string; garmentRevision: number }>,
    captureKeys: [] as string[], workflowPatches: [] as Array<{ operations: Array<{ node: { payload: { assetId: string } } }> }>,
    uploaded: Buffer.alloc(0), blocked: [] as string[],
  };
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3000") { state.blocked.push(url.origin); await route.abort("blockedbyclient"); return; }
    const path = url.pathname;
    if (path === "/__tryon-test/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>模拟实时试穿验证</title><link rel="stylesheet" href="/__tryon-test/harness.css"><body style="margin:0"><div id="root"></div><script type="module" src="/__tryon-test/harness.js"></script></body></html>' });
    if (path === "/__tryon-test/harness.js") return route.fulfill({ contentType: "text/javascript", body: bundle.javascript });
    if (path === "/__tryon-test/harness.css") return route.fulfill({ contentType: "text/css", body: bundle.css });
    if (path.startsWith("/__tryon-test/garment/") || /^\/api\/design-assets\/[^/]+\/content$/.test(path)) return route.fulfill({ contentType: "image/png", body: png });
    if (path === "/api/realtime-tryon/capabilities") return route.fulfill({ json: {
      enabled: true, configured: true, accessMode: "internal", provider: "decart", modelId: "lucy-vton-3.6",
      maxSessionSeconds: 60, maxGarmentBytes: 5242880, estimatedUsdPerSecond: "0.02", priceVerifiedAt: "2026-10-29T00:00:00.000Z",
    } });
    if (path === "/api/realtime-tryon/sessions") {
      state.creates += 1;
      return route.fulfill({ json: { sessionId: "fake-session", clientToken: "fake-not-a-real-token", modelId: "lucy-vton-3.6",
        maxSessionSeconds: 60, tokenExpiresAt: new Date(Date.now() + 30000).toISOString(), serverNow: new Date().toISOString(), estimatedUsdPerSecond: "0.02" } });
    }
    if (path.endsWith("/observations")) return route.fulfill({ json: { accepted: true, source: "client-observed" } });
    if (path.endsWith("/end")) { state.ends += 1; return route.fulfill({ json: { ended: true } }); }
    const file = { id: "capture-file", status: "READY", mimeType: "image/png", name: "实时试穿.png", size: 1,
      width: 960, height: 720, thumbnail256Url: "/__tryon-test/garment/a.png", thumbnail1024Url: "/__tryon-test/garment/a.png", error: null };
    if (path === "/api/files/sign-upload") {
      state.signs += 1;
      return route.fulfill({ json: { deduplicated: false, file: { ...file, status: "PENDING" }, upload: { method: "PUT", url: "http://127.0.0.1:3000/__tryon-test/upload", headers: {} } } });
    }
    if (path === "/__tryon-test/upload") {
      state.uploads += 1; state.uploaded = request.postDataBuffer() ?? Buffer.alloc(0);
      return route.fulfill({ status: 200, body: "" });
    }
    if (path === "/api/files/capture-file/complete") { state.completes += 1; return route.fulfill({ json: file }); }
    if (path.endsWith("/captures")) {
      state.captureBodies.push(request.postDataJSON()); state.captureKeys.push(request.headers()["idempotency-key"] ?? "");
      if (state.captureBodies.length === 1) return route.fulfill({ status: 503, json: { message: "模拟登记失败，可重试保存" } });
      return route.fulfill({ json: { assetId: "saved-capture", url: "/api/design-assets/saved-capture/content", source: "realtime-tryon-capture" } });
    }
    if (path === "/api/projects/tryon-fixture-project/workflow" || path === "/api/projects/tryon-fixture-project/workflow/sync") {
      if (request.method() === "PATCH") state.workflowPatches.push(request.postDataJSON());
      return route.fulfill({ json: { projectId: "tryon-fixture-project", revision: 1, layoutRevision: 0, nodes: [], edges: [], legacyAvailable: false } });
    }
    if (path === "/favicon.ico") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { message: "Unexpected test request" } });
  });
  await page.goto(`/__tryon-test/?case=${uiCase}`);
  await expect(page.getByRole("heading", { name: "实时试穿", exact: true })).toBeVisible();
  return state;
}

async function chooseGarment(page: Page, index: number) {
  await page.getByRole("button", { name: "更换", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择服装参考", exact: true });
  await dialog.getByRole("button", { name: `选择图片 ${index}`, exact: true }).click();
  await dialog.getByRole("button", { name: /确认选择/ }).click();
}

test("模拟视频：显式同意后单连接换装，原尺寸截图经上传重试入画布，隐藏后释放媒体", async ({ page }) => {
  const state = await setup(page);
  expect(state.creates).toBe(0);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  const start = page.getByRole("button", { name: "开始实时试穿", exact: true });
  await expect(start).toBeDisabled();
  await expect(page.getByText("仅本地预览，尚未发送到 AI", { exact: true })).toBeVisible();
  expect(state.creates).toBe(0);
  await page.getByRole("checkbox", { name: "我同意本次第三方视频处理及所示费用" }).check();
  await start.click();
  await expect(page.getByText("实时试穿中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存这一帧", exact: true })).toBeEnabled();
  const localVideo = await page.getByLabel("原始摄像头画面", { exact: true }).elementHandle();
  const remoteVideo = await page.getByLabel("AI 试穿结果", { exact: true }).elementHandle();
  await page.getByRole("button", { name: "收起原始画面" }).click();
  await page.getByRole("button", { name: "展开原始画面" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await localVideo?.evaluate((node) => node === document.querySelector('[aria-label="原始摄像头画面"]'))).toBe(true);
  expect(await remoteVideo?.evaluate((node) => node === document.querySelector('[aria-label="AI 试穿结果"]'))).toBe(true);
  expect(state.creates).toBe(1);
  expect(await page.evaluate(() => window.__tryonFixture.localStopped)).toBe(0);
  await page.screenshot({ path: "output/realtime-tryon/redesign-live-390.png", fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await chooseGarment(page, 2);
  await expect(page.getByRole("button", { name: "保存这一帧", exact: true })).toBeDisabled();
  await chooseGarment(page, 3);
  await expect(page.getByText("实时试穿中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存这一帧", exact: true })).toBeEnabled();
  expect(state.creates).toBe(1);
  expect(await page.evaluate(() => window.__tryonFixture.connections)).toBe(1);
  const payloads = await page.evaluate(() => window.__tryonFixture.statePayloads);
  expect(payloads.length).toBeGreaterThanOrEqual(2);
  expect(payloads.every((payload) => payload.image && payload.enhance === false && payload.prompt.includes("Substitute the current top"))).toBe(true);
  await page.getByRole("button", { name: "保存这一帧", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试保存这一帧", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "重试保存这一帧", exact: true }).click();
  await expect(page.getByText("AI 截图已保存到项目资产。", { exact: true })).toBeVisible();
  expect(state.signs).toBe(1); expect(state.uploads).toBe(1); expect(state.completes).toBe(1);
  expect(state.captureBodies).toHaveLength(2);
  expect(state.captureBodies[0]).toEqual(state.captureBodies[1]);
  expect(state.captureBodies[0]).toMatchObject({ width: 960, height: 720, garmentAssetId: "c", garmentRevision: 2 });
  expect(state.captureKeys[0]).toBe(state.captureKeys[1]);
  expect(state.captureKeys[0]).not.toBe("");
  expect(state.uploaded.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(state.uploaded.readUInt32BE(16)).toBe(960); expect(state.uploaded.readUInt32BE(20)).toBe(720);
  await page.getByRole("button", { name: "加入作品区与画布", exact: true }).click();
  await expect(page.getByRole("button", { name: "已加入作品区与画布", exact: true })).toBeDisabled();
  expect(state.workflowPatches).toHaveLength(1);
  expect(state.workflowPatches[0]?.operations[0]?.node.payload.assetId).toBe("saved-capture");
  await page.screenshot({ path: "output/realtime-tryon/mock-live-capture-desktop.png", fullPage: true });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("已停止本次试穿", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ local: window.__tryonFixture.localStopped, remote: window.__tryonFixture.remoteStopped, disconnected: window.__tryonFixture.disconnects }))).toEqual({ local: 1, remote: 1, disconnected: 1 });
  await expect.poll(() => state.ends).toBe(1);
  expect(state.blocked).toEqual([]);
});

for (const uiCase of ["empty", "readonly"]) {
  test(`试穿界面边界：${uiCase}`, async ({ page }) => {
    const state = await setup(page, uiCase);
    await page.setViewportSize({ width: 390, height: 844 });
    if (uiCase === "empty") await expect(page.getByText("选择一件服装", { exact: true })).toBeVisible();
    else {
      await expect(page.getByText("当前项目为只读，无法创建试穿会话或保存结果。")).toBeVisible();
      await expect(page.getByRole("button", { name: "更换", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "上传服装图片", exact: true })).toBeDisabled();
    }
    await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
    await expect(page.getByRole("button", { name: "开始实时试穿", exact: true })).toBeDisabled();
    await page.getByText("使用说明", { exact: true }).click();
    await expect(page.getByText(/视觉试穿不能证明真实尺码/)).toBeVisible();
    await page.screenshot({ path: `output/realtime-tryon/redesign-${uiCase}.png`, fullPage: true });
    expect(state.creates).toBe(0);
  });
}
