import { expect, test, type Page } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

test.setTimeout(60_000);

async function setup(page: Page, camera: "ready" | "denied" | "delayed" = "ready") {
  await seedVisualApp(page);
  const requests: string[] = [];
  await page.route("**/api/realtime-tryon/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path.endsWith("/capabilities")) return route.fulfill({ json: {
      enabled: false, configured: false, accessMode: "internal", provider: "decart",
      modelId: "lucy-vton-3.6", maxSessionSeconds: 60, maxGarmentBytes: 5242880,
      estimatedUsdPerSecond: null, priceVerifiedAt: null, unavailableReason: "实时试穿尚未启用",
    } });
    return route.fulfill({ status: 503, json: { message: "测试禁止创建供应商会话" } });
  });
  const blocked: string[] = [];
  await page.route(/https?:\/\/([^/]*\.)?decart\.ai\//u, (route) => {
    blocked.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) => route.fulfill({ json: workspaceFixture() }));
  await page.addInitScript((mode) => {
    const state = { requests: 0, stopped: 0, audio: false, resolve: null as (() => void) | null };
    Object.assign(window, { __tryonCamera: state });
    const create = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#e9e5df"; context.fillRect(0, 0, 640, 480);
      context.fillStyle = "#263950"; context.font = "24px sans-serif";
      context.fillText("MOCK CAMERA / LOCAL PREVIEW", 36, 220);
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        const original = track.stop.bind(track);
        track.stop = () => { state.stopped += 1; original(); };
      }
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        state.requests += 1; state.audio = constraints.audio !== false;
        if (mode === "denied") throw new DOMException("Mock camera permission denied", "NotAllowedError");
        if (mode === "delayed") await new Promise<void>((resolve) => { state.resolve = resolve; });
        return create();
      },
    });
  }, camera);
  return { requests, blocked };
}

async function open(page: Page) {
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=realtime`);
  await expect(page.getByRole("heading", { name: "实时试穿", exact: true })).toBeVisible();
}

test("默认关闭时展示真实原因，页面不自动开启摄像头或签发令牌", async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await expect(page.getByText("实时试穿尚未启用", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始实时试穿", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tryonCamera: { requests: number } }).__tryonCamera.requests)).toBe(0);
  expect(fixture.requests.every((request) => request.startsWith("GET "))).toBe(true);
  expect(fixture.blocked).toEqual([]);
  await page.screenshot({ path: "output/realtime-tryon/mock-disabled-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "开启摄像头", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/realtime-tryon/mock-disabled-mobile.png", fullPage: true });
  for (const [width, height] of [[1366, 768], [1280, 800], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/realtime-tryon/redesign-${width}x${height}.png`, fullPage: true });
  }
});

test("本地预览仅申请视频，停止时释放轨道且不创建推理会话", async ({ page }) => {
  const fixture = await setup(page);
  await open(page);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await expect.poll(() => page.getByLabel("原始摄像头画面", { exact: true }).evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
  await expect(page.getByRole("button", { name: "保存这一帧", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tryonCamera: { stopped: number } }).__tryonCamera.stopped)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __tryonCamera: { audio: boolean } }).__tryonCamera.audio)).toBe(false);
  expect(fixture.requests.every((request) => request.startsWith("GET "))).toBe(true);
  expect(fixture.blocked).toEqual([]);
});

test("相机拒绝显示可理解错误，不签发令牌", async ({ page }) => {
  const fixture = await setup(page, "denied");
  await open(page);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /摄像头|相机/ })).toBeVisible();
  expect(fixture.requests.every((request) => request.startsWith("GET "))).toBe(true);
});

test("授权尚未回应时可停止，迟到的相机流立即回收", async ({ page }) => {
  const fixture = await setup(page, "delayed");
  await open(page);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __tryonCamera: { resolve: (() => void) | null } }).__tryonCamera.resolve?.());
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tryonCamera: { stopped: number } }).__tryonCamera.stopped)).toBeGreaterThan(0);
  expect(fixture.requests.every((request) => request.startsWith("GET "))).toBe(true);
});
