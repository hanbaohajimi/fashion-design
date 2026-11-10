import { test, expect, type Page } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

// These routes are explicit test doubles. No fixture is a Live2D model or approved silhouette.
const enabled = process.env.FOREST_SPIRIT_E2E_ENABLED === "true";
const manifest = {
  schemaVersion: 1, status: "ready", characterId: "forest-spirit-front-v8",
  visualReview: { approved: true, noEyelashes: true, crossEyeHighlights: true },
  model3Url: "/forest-test/model.model3.json", coreUrl: "/forest-test/core.js", runtimeModuleUrl: "/forest-test/runtime.js",
  hitArea: { approved: true, viewBox: [100, 200], polygons: [[[20, 20], [80, 20], [80, 190], [20, 190]]] },
  motions: { idle: "/forest-test/idle.motion3.json", hover_greet: "/forest-test/hover.motion3.json", drag_hold: "/forest-test/drag.motion3.json", put_down: "/forest-test/down.motion3.json" },
};
const runtime = `
export const sdkVersion = "5-r.5";
export function createCubismRenderer(canvas) {
  const log = (event) => (window.__spiritTestEvents ??= []).push(event);
  const draw = () => { const ctx = canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#688b80"; ctx.fillRect(canvas.width*.2,canvas.height*.1,canvas.width*.6,canvas.height*.85); ctx.fillStyle="white"; ctx.font="10px sans-serif"; ctx.fillText("TEST ONLY",canvas.width*.22,canvas.height*.5); };
  return {
    async load() { log("load:mock"); draw(); },
    play(name) { log("play:"+name); return new Promise(resolve=>setTimeout(resolve,name==="hover_greet"?300:10)); },
    pause() { log("pause"); }, resume() { log("resume"); },
    resize(w,h,dpr) { canvas.width=Math.max(1,w*dpr);canvas.height=Math.max(1,h*dpr);draw(); },
    dispose() { log("dispose"); }
  };
}`;

async function prepare(page: Page) {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
  await page.setViewportSize({ width: 1440, height: 900 });
}
const eventCount = (page: Page, event: string) => page.evaluate(name => ((window as unknown as { __spiritTestEvents?: string[] }).__spiritTestEvents ?? []).filter(item => item === name).length, event);

test("missing production model keeps the existing complete chat and draft", async ({ page }) => {
  await prepare(page);
  let manifests = 0;
  let posts = 0;
  page.on("request", request => { if (request.url().includes("/api/") && request.method() === "POST" && request.url().includes("conversation")) posts++; });
  await page.route("**/live2d/forest-spirit/asset-manifest.json", route => { manifests++; return route.fulfill({ json: { status: "missing" } }); });
  await page.goto(`/${PROJECT}`);
  const input = page.getByRole("textbox", { name: "描述设计需求" });
  await expect(input).toBeEnabled();
  await input.fill("森林布偶接入验证：保留本次草稿");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(page.locator("[data-forest-spirit-host]")).toHaveCount(0);
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click();
  await expect(input).toHaveValue("森林布偶接入验证：保留本次草稿");
  expect(posts).toBe(0);
  if (enabled) expect(manifests).toBeGreaterThan(0);
  else expect(manifests).toBe(0);
  await page.screenshot({ path: "output/forest-spirit-validation/existing-chat-fallback.png" });
});

test("explicit mock runtime verifies gestures, same chat and recovery; not model acceptance", async ({ page }) => {
  test.skip(!enabled, "Requires NEXT_PUBLIC_FOREST_SPIRIT_ENABLED=true on the development server");
  await prepare(page);
  let conversationPosts = 0;
  page.on("request", request => { if (request.url().includes("/api/") && request.method() === "POST" && request.url().includes("conversation")) conversationPosts++; });
  await page.route("**/live2d/forest-spirit/asset-manifest.json", route => route.fulfill({ json: manifest }));
  await page.route("**/forest-test/core.js", route => route.fulfill({ contentType: "text/javascript", body: "window.Live2DCubismCore = {}; // Explicit browser-test double only" }));
  await page.route("**/forest-test/runtime.js", route => route.fulfill({ contentType: "text/javascript", body: runtime }));
  await page.goto(`/${PROJECT}`);
  const input = page.getByRole("textbox", { name: "描述设计需求" });
  await expect(input).toBeEnabled();
  await input.fill("同一会话中的未发送设计需求");
  const host = page.locator("[data-forest-spirit-host]");
  await expect(host).toHaveAttribute("data-conversation-id", "visual-chat");
  const close = page.getByRole("button", { name: "收起设计助手", exact: true });
  await close.click();
  const hit = page.locator("[data-forest-spirit-hit]");
  await expect(hit).toBeVisible();
  const polygon = hit.locator("polygon");
  await polygon.hover();
  await expect.poll(() => eventCount(page, "play:hover_greet")).toBe(1);
  await polygon.hover();
  expect(await eventCount(page, "play:hover_greet")).toBe(1);
  await polygon.click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("同一会话中的未发送设计需求");
  await expect(hit).toBeHidden();
  await expect(host).toHaveAttribute("data-conversation-id", "visual-chat");
  await close.click();
  await expect(hit).toBeVisible();
  const rect = await polygon.boundingBox();
  if (!rect) throw new Error("Synthetic hit target missing");
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(host.locator("[data-phase]")).toHaveAttribute("data-phase", "dragArmed");
  await page.mouse.move(start.x - 170, start.y - 80, { steps: 6 });
  await page.mouse.up();
  await expect(input).toBeHidden();
  await expect.poll(() => eventCount(page, "play:put_down")).toBe(1);
  const anchor = await page.evaluate(() => JSON.parse(localStorage.getItem("fashion:forest-spirit:visual-designer:atelier-visual") ?? "null"));
  expect(anchor.xRatio).toBeGreaterThanOrEqual(0); expect(anchor.xRatio).toBeLessThan(1);
  expect(anchor.yRatio).toBeGreaterThanOrEqual(0); expect(anchor.yRatio).toBeLessThan(1);
  const transform = await hit.evaluate(node => node.parentElement?.style.transform);
  await hit.focus(); await page.keyboard.press("Enter");
  await expect(input).toBeVisible();
  await close.click();
  await expect(hit).toBeVisible();
  expect(await hit.evaluate(node => node.parentElement?.style.transform)).toBe(transform);
  await expect(host).toHaveAttribute("data-conversation-id", "visual-chat");
  expect(conversationPosts).toBe(0);
  // Transparent margin has no pointer target belonging to the spirit.
  const box = await hit.boundingBox();
  if (!box) throw new Error("Synthetic surface missing");
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-forest-spirit-hit]")), { x: box.x + 2, y: box.y + 2 })).toBe(false);
  await page.screenshot({ path: "output/forest-spirit-validation/mock-interaction-only.png" });
  await host.locator("canvas").evaluate(node => node.dispatchEvent(new Event("forest-spirit-error")));
  await expect(hit).toBeHidden();
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click();
  await expect(input).toHaveValue("同一会话中的未发送设计需求");
});

test.describe("mobile interaction with an explicitly synthetic renderer", () => {
  test.use({ hasTouch: true });
  test("touch opens existing full chat without hover and preserves the draft", async ({ page }) => {
    test.skip(!enabled, "Requires the explicitly enabled test server");
    await prepare(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/live2d/forest-spirit/asset-manifest.json", route => route.fulfill({ json: manifest }));
    await page.route("**/forest-test/core.js", route => route.fulfill({ contentType: "text/javascript", body: "window.Live2DCubismCore = {};" }));
    await page.route("**/forest-test/runtime.js", route => route.fulfill({ contentType: "text/javascript", body: runtime }));
    await page.goto(`/${PROJECT}`);
    const hit = page.locator("[data-forest-spirit-hit]");
    await expect(hit).toBeVisible();
    await hit.locator("polygon").tap();
    const input = page.getByRole("textbox", { name: "描述设计需求" });
    await expect(input).toBeVisible();
    await input.fill("手机继续同一会话");
    await expect(hit).toBeHidden();
    await page.getByRole("button", { name: "收起设计助手", exact: true }).tap();
    await expect(hit).toBeVisible();
    await hit.locator("polygon").tap();
    await expect(input).toHaveValue("手机继续同一会话");
    expect(await eventCount(page, "play:hover_greet")).toBe(0);
    await expect(page.locator("[data-forest-spirit-host]")).toHaveAttribute("data-conversation-id", "visual-chat");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "output/forest-spirit-validation/mobile-existing-chat.png" });
  });
});
