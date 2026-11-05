import { test, expect, type Locator } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { PROJECT } from "../visual/fixtures";
import { seedWardrobe } from "./wardrobe-fixture";

// Interaction evidence only: labeled geometric fixtures, never provider/material evidence.
test.use({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  contextOptions: { reducedMotion: "no-preference" },
  video: { mode: "on", size: { width: 390, height: 844 } },
});

async function settle(node: Locator) {
  await expect.poll(() => node.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
}

test("真实触屏上下文通过查看及加入按钮完成三种挂具搭配，不依赖悬停", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = resolve(process.env.WARDROBE_TOUCH_OUTPUT ?? `output/wardrobe-tryon/touch-${Date.now()}`);
  const withinOutput = relative(resolve("output"), directory);
  if (isAbsolute(withinOutput) || withinOutput.startsWith("..")) throw new Error("Touch evidence must remain in output/");
  await mkdir(directory, { recursive: true });
  const video = page.video();
  if (!video) throw new Error("Touch recording is required");
  let checksCompleted = false;
  try {
    const fixture = await seedWardrobe(page);
    fixture.summary.items = fixture.summary.items.filter(item => ["top", "bottom", "shoes"].includes(item.currentRevision.category));
    fixture.summary.capabilities.preparationEnabled = false;
    fixture.summary.capabilities.staticTryOnEnabled = false;
    const blocked: string[] = [], writes: string[] = [];
    await page.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) { blocked.push(url.hostname); return route.abort("blockedbyclient"); }
      if (!["GET", "HEAD"].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 409 }); }
      return route.fallback();
    });
    await page.addInitScript(() => {
      const pointerTypes: string[] = [];
      Object.assign(window, { __wardrobePointerTypes: pointerTypes });
      document.addEventListener("pointerdown", event => pointerTypes.push(event.pointerType), true);
    });
    await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
    const environment = await page.evaluate(() => ({ width: innerWidth, touchPoints: navigator.maxTouchPoints, hoverNone: matchMedia("(hover: none)").matches, coarse: matchMedia("(pointer: coarse)").matches }));
    expect(environment.width).toBe(390);
    expect(environment.touchPoints).toBeGreaterThan(0);
    expect(environment.hoverNone).toBe(true);
    expect(environment.coarse).toBe(true);
    const rack = page.getByRole("region", { name: "项目单品衣架" });
    await expect(rack).toBeVisible(); await settle(rack);
    await expect(rack.getByText("点击单品查看正面与详情，再加入搭配", { exact: true })).toBeVisible();
    await expect(rack.getByText("移到单品上查看正面，点击聚焦查看", { exact: true })).not.toBeVisible();
    const captures: { state: string; file: string; sha256: string }[] = [];
    const environmentChecks: unknown[] = [];
    const recordEnvironment = async (state: string) => {
      environmentChecks.push({ state, ...(await page.evaluate(() => ({ width: innerWidth, touchPoints: navigator.maxTouchPoints, hoverNone: matchMedia("(hover: none)").matches, coarse: matchMedia("(pointer: coarse)").matches }))) });
      await writeFile(`${directory}/environment-checks.json`, JSON.stringify(environmentChecks, null, 2));
    };
    const capture = async (state: string, target: Locator) => {
      const file = `${directory}/${state}.png`;
      await recordEnvironment(`${state}-before-capture`);
      // Oversized element/full-page capture resets this Chromium touch context.
      // Keep tall panels at the real viewport and capture their lower portion separately.
      const box = await target.boundingBox();
      if (box && box.height > (page.viewportSize()?.height ?? 844)) await page.screenshot({ path: file });
      else await target.screenshot({ path: file });
      await recordEnvironment(`${state}-after-capture`);
      captures.push({ state, file, sha256: createHash("sha256").update(await readFile(file)).digest("hex") });
    };
    await capture("rack-rest", rack);
    const first = rack.getByRole("button", { name: "查看单品：测试短上衣", exact: true });
    await expect(first).toBeVisible(); await first.tap();
    const cases = [{ name: "测试短上衣", display: "hanger" }, { name: "测试裤装", display: "clips" }, { name: "测试运动鞋", display: "shelf" }];
    for (let index = 0; index < cases.length; index++) {
      const item = cases[index]; if (!item) throw new Error("Missing touch case");
      const dialog = page.getByRole("dialog", { name: `单品：${item.name}`, exact: true });
      await expect(dialog).toBeVisible(); await settle(dialog);
      await expect(dialog.getByRole("heading", { name: item.name, exact: true })).toBeVisible();
      await expect(dialog.locator("[data-garment]")).toHaveAttribute("data-display", item.display);
      await expect(dialog.locator("header")).toContainText(`${index + 1} / 3`);
      const add = dialog.getByRole("button", { name: "加入搭配", exact: true });
      await expect(add).toBeVisible(); await expect(add).toBeEnabled();
      await capture(`${item.display}-focus`, dialog);
      await add.tap();
      await expect(dialog.getByRole("button", { name: "已加入搭配", exact: true })).toBeDisabled();
      if (index < cases.length - 1) await dialog.getByRole("button", { name: "下一件单品", exact: true }).tap();
    }
    for (const name of ["测试运动鞋", "测试裤装"]) {
      const dialog = page.getByRole("dialog", { name: `单品：${name}`, exact: true });
      await dialog.getByRole("button", { name: "上一件单品", exact: true }).tap();
    }
    const originalDialog = page.getByRole("dialog", { name: "单品：测试短上衣", exact: true });
    await expect(originalDialog).toBeVisible(); await settle(originalDialog);
    await expect(originalDialog.locator("header")).toContainText("1 / 3");
    await originalDialog.getByRole("button", { name: "返回衣架", exact: true }).tap();
    await expect(originalDialog).toHaveCount(0);
    await expect(rack).toBeVisible(); await expect(first).toBeFocused();
    await capture("rack-after-close", rack);
    await page.getByRole("button", { name: "搭配", exact: true }).tap();
    const editor = page.getByRole("region", { name: "搭配编辑" });
    await expect(editor).toBeVisible();
    for (const item of cases) await expect(editor.getByRole("button", { name: `移除${item.name}`, exact: true })).toBeVisible();
    await capture("three-item-local-draft", editor);
    await editor.getByRole("button", { name: "移除测试运动鞋", exact: true }).scrollIntoViewIfNeeded();
    await capture("three-item-local-draft-lower", editor);
    await page.getByRole("button", { name: "衣架", exact: true }).tap();
    await expect(rack).toBeVisible(); await settle(rack); await capture("rack-after-view-return", rack);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const pointerTypes = await page.evaluate(() => (window as unknown as { __wardrobePointerTypes: string[] }).__wardrobePointerTypes);
    const finalEnvironment = await page.evaluate(() => ({ width: innerWidth, touchPoints: navigator.maxTouchPoints, hoverNone: matchMedia("(hover: none)").matches, coarse: matchMedia("(pointer: coarse)").matches }));
    expect(finalEnvironment).toEqual(environment);
    expect(pointerTypes.length).toBeGreaterThan(0); expect(new Set(pointerTypes)).toEqual(new Set(["touch"]));
    expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.blocked).toEqual([]);
    expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
    await writeFile(`${directory}/report.json`, JSON.stringify({ schemaVersion: 1, environment, finalEnvironment, cases, captures, pointerTypes,
      inputs: "Explicit geometric fixtures; only touch interaction coverage. Does not validate real garment pixels, texture, provider results, or physical mobile hardware.",
      sequence: "tap view; hanger add; next to clips add; next to shelf add; previous twice; close; inspect three-item local draft; return rack",
      aiRequestsCreated: 0, providerCalls: 0, writes, blocked, visualAcceptance: "pending actual observation", recording: `${directory}/continuous.webm` }, null, 2));
    checksCompleted = true;
  } finally {
    await page.context().close();
    const file = `${directory}/continuous.webm`; await video.saveAs(file);
    await writeFile(`${directory}/recording.json`, JSON.stringify({ file, sha256: createHash("sha256").update(await readFile(file)).digest("hex"), checksCompleted, overallTestStatus: "see Playwright result", observed: false, normalMotion: true }, null, 2));
  }
});
