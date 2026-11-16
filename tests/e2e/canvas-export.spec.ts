import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";

test.setTimeout(60_000);

async function exportCanvas(page: Page, name: string) {

  const pending = page.waitForEvent("download");
  await openCanvasFunction(page, "导出画布 PNG");
  const download = await pending;
  const path = `output/playwright/canvas-visibility/${name}.png`;
  await download.saveAs(path);
  return readFile(path);
}

test("图片便签色卡导出不含编辑控件，缩放不降质且不修改文档", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 10 });
  await loadZhiya(page);
  await openCanvasFunction(page, "画布对象");
  const panel = page.getByRole("region", { name: "画布对象", exact: true });
  await panel.locator('[data-canvas-object-id="shape:canvas-material-0"]').getByRole("button", { name: /^锁定/ }).click();
  await panel.getByRole("button", { name: "关闭画布对象" }).click();
  await expect.poll(() => state.saves.length).toBeGreaterThan(0);
  const savedDocument = () => JSON.stringify(state.saves.at(-1)?.snapshot.document);
  const before = savedDocument();
  await mkdir("output/playwright/canvas-visibility", { recursive: true });
  await page.evaluate(() => {
    const audit = { observations: 0, controls: [] as string[], noteValues: [] as string[] };
    const inspect = () => {
      const elements = document.querySelectorAll(".tl-shape-foreign-object");
      if (!elements.length) return;
      audit.observations++;
      for (const element of elements) {
        for (const control of element.querySelectorAll('button[aria-label="添加颜色"], button[aria-label="局部更改成衣"], input[type="color"], textarea')) {
          audit.controls.push(control.getAttribute("aria-label") ?? "颜色输入");
        }
        const content = element.textContent ?? "";
        if (content.includes("宽松廓形")) audit.noteValues.push(content);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { canvasExportAudit: audit, stopCanvasExportAudit: () => observer.disconnect() });
  });
  const original = await exportCanvas(page, "mixed-board");
  for (let index = 0; index < 6; index++) await canvasAction(page, "缩小画布");
  const zoomedOut = await exportCanvas(page, "mixed-board-zoomed-out");
  expect(zoomedOut).toEqual(original);
  expect(savedDocument()).toBe(before);
  const audit = await page.evaluate(() => {
    const state = window as unknown as { canvasExportAudit: { observations: number; controls: string[]; noteValues: string[] }; stopCanvasExportAudit: () => void };
    state.stopCanvasExportAudit();
    return state.canvasExportAudit;
  });
  expect(audit.observations).toBeGreaterThan(0);
  expect(audit.controls).toEqual([]);
  expect(audit.noteValues.some(value => value.includes("宽松廓形与轻盈结构，保留织物的自然肌理。"))).toBe(true);
  await writeFile("output/playwright/canvas-visibility/export-audit.json", JSON.stringify(audit, null, 2), "utf8");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});
