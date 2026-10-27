import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";

test("压力资料：500条历史、100个节点及1000条面料", async ({ page }) => {
  test.setTimeout(120_000);
  await seedVisualApp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem("fashion:profile-workspace", "1");
    const samples: unknown[] = [];
    Object.assign(window, { workspaceProfile: samples });
    window.addEventListener("fashion:workspace-profile", event => samples.push((event as CustomEvent).detail));
  });
  const nodes = Array.from({ length: 100 }, (_, index) => ({
    id: `stress-${index}`, kind: "asset", type: "reference_image", title: `参考素材 ${index + 1}`,
    x: (index % 10) * 300, y: Math.floor(index / 10) * 400, status: "completed", canDelete: false,
    createdAt: NOW, updatedAt: NOW, payload: { imageUrl: "/visual-garment.svg", imageWidth: 600, imageHeight: 800 },
  }));
  await page.route(new RegExp(`/api/projects/${PROJECT}/workflow(?:/sync)?$`), route => route.fulfill({ json: { projectId: PROJECT, revision: 1, layoutRevision: 0, legacyAvailable: false, nodes, edges: [], proposals: [] } }));
  await page.route("**/api/agent-conversations/visual-chat/messages*", route => route.fulfill({ json: {
    items: Array.from({ length: 500 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? "assistant" : "user", status: "completed", content: `第 ${index + 1} 条设计讨论。保留立领与宽松廓形。`, context: null, clientRequestId: null, replyToId: null, generationTaskId: null, error: null, createdAt: NOW, updatedAt: NOW })), nextCursor: null,
  } }));
  await page.goto(`/${PROJECT}`);
  await expect(page.locator('[data-message-id="history-499"]')).toBeVisible();
  const input = page.getByRole("textbox", { name: "描述设计需求" });
  await input.focus();
  await page.evaluate(() => {
    const samples: number[] = [];
    Object.assign(window, { inputPaintSamples: samples });
    document.querySelector("textarea")?.addEventListener("input", () => {
      const started = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - started)));
    }, { capture: true });
  });
  const driverRoundTripSamples: number[] = [];
  for (let index = 0; index < 25; index++) {
    const started = await page.evaluate(() => performance.now());
    await page.keyboard.insertText("衣");
    driverRoundTripSamples.push(await page.evaluate(start => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))), started));
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { inputPaintSamples: number[] }).inputPaintSamples.length)).toBe(25);
  const inputSamples = await page.evaluate(() => (window as unknown as { inputPaintSamples: number[] }).inputPaintSamples);
  const profile = await page.evaluate(() => (window as unknown as { workspaceProfile: { actualDuration: number; phase: string }[] }).workspaceProfile);
  const percentile = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] ?? 0;
  const inputP95 = percentile(inputSamples);
  const updateP95 = percentile(profile.filter(row => row.phase !== "mount").map(row => row.actualDuration));
  await page.getByRole("button", { name: "流程画布", exact: true }).click();
  await expect(page.locator('[data-node-id="stress-0"]').first()).toBeAttached();
  await page.route("**/api/fabrics?*", route => route.fulfill({ json: {
    items: Array.from({ length: 1000 }, (_, index) => ({ id: `fabric-${index}`, scope: "preset", canManage: false, mainFileId: `file-${index}`, mainImageUrl: "/visual-garment.svg", tags: ["棉麻", `面料 ${index + 1}`], createdAt: NOW, updatedAt: NOW })),
    total: 1000, totalPages: 1, page: 1, limit: 1000,
  } }));
  await page.goto("/fabrics");
  await expect(page.getByText("1000 项面料", { exact: false })).toBeVisible();
  const renderedCards = await page.locator('article').count();
  expect(renderedCards).toBeLessThan(1000);
  await mkdir("output/desktop-agent-ui/performance", { recursive: true });
  await writeFile("output/desktop-agent-ui/performance/stress.json", JSON.stringify({ browser: page.context().browser()?.version(), runtime: "Next development / Windows / fixture", history: 500, nodes: 100, fabrics: 1000, renderedCards, inputSamples, inputP95, driverRoundTripSamples, driverRoundTripP95: percentile(driverRoundTripSamples), reactUpdateP95: updateP95, profile }, null, 2));
  expect(inputP95, "浏览器内 input 事件到绘制 p95，开发运行时").toBeLessThanOrEqual(200);
  expect(updateP95, "React 更新 p95，开发运行时").toBeLessThanOrEqual(200);
});
