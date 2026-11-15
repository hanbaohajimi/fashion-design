import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { generateMaterialAppearance } from "../../apps/web/src/modules/board/shapes/material-appearance";
import { useCanvasPhotograph } from "./canvas-photo-fixture";

test.setTimeout(90_000);
for (const width of [1440, 390]) test(`${width}px 旧用途和装裱数据统一呈现原比例纯图片`, async ({ page }) => {
  const state = await prepareZhiya(page, { count: 3, realClock: true, viewport: { width, height: width < 700 ? 844 : 900 } });
  await useCanvasPhotograph(page);
  state.setCanvasSnapshot({ legacyRecords: ["style_ref", "fabric_ref", "silhouette_ref"].map((role, index) => ({ id: `shape:canvas-material-${index}`, typeName: "shape", type: "fashion-image", x: index * 400, y: 100, props: {
    w: 340, h: 260, role, appearance: generateMaterialAppearance(index === 0 ? "editorial-photo" : index === 1 ? "fabric-swatch" : "sketch-paper", index + 1),
    url: "/visual-garment.svg", title: `通勤外套 ${index + 1}`, uploadStatus: "ready",
  } })) });
  await loadZhiya(page);
  const surfaces = page.locator('[data-canvas-image="plain"]'); await expect(surfaces).toHaveCount(3);
  await expect(page.locator('[data-material]')).toHaveCount(0);
  const metrics = await surfaces.evaluateAll((elements) => elements.map((element) => {
    const picture = element.lastElementChild; const image = picture?.querySelector("img");
    if (!picture || !image) throw new Error("缺少图片内容");
    const bounds = picture.getBoundingClientRect(), style = getComputedStyle(picture), imageStyle = getComputedStyle(image);
    return { ratio: bounds.width / bounds.height, shadow: style.boxShadow, padding: style.padding, radius: style.borderRadius, filter: imageStyle.filter, fit: imageStyle.objectFit, caption: element.querySelector("[data-image-caption]")?.textContent };
  }));
  for (const metric of metrics) {
    expect(metric.ratio).toBeCloseTo(600 / 800, 2); expect(metric.shadow).toBe("none"); expect(metric.padding).toBe("0px");
    expect(metric.radius).toBe("16px"); expect(metric.filter).toBe("none"); expect(metric.fit).toBe("contain");
  }
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true }); const box = await image.boundingBox(); if (!box) throw new Error("图片不可见");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: "选择图片参考", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择图片参考", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "可引用素材" })).toBeVisible();
  await page.getByRole("button", { name: "关闭素材选择" }).click();
  await mkdir("output/unified-canvas", { recursive: true });
  await page.screenshot({ path: `output/unified-canvas/plain-images-${width}.png` });
  await writeFile(`output/unified-canvas/plain-image-metrics-${width}.json`, JSON.stringify(metrics, null, 2));
  expect(state.errors).toEqual([]);
});

test("减弱动态下图片和标题保持稳定，100个素材可以平移浏览", async ({ page }) => {
  const state = await prepareZhiya(page, { count: 100, realClock: true }); await page.emulateMedia({ reducedMotion: "reduce" }); await loadZhiya(page);
  await expect(page.locator(".tl-shape")).toHaveCount(100);
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true }); const box = await image.boundingBox(); if (!box) throw new Error("图片不可见");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const before = await image.boundingBox();
  await page.getByRole("switch", { name: /显示连接关系/ }).click(); expect(await image.boundingBox()).toEqual(before);
  await page.keyboard.down("Space"); await page.mouse.move(850, 450); await page.mouse.down(); await page.mouse.move(1050, 530, { steps: 15 }); await page.mouse.up(); await page.keyboard.up("Space");
  const intervals = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const samples: number[] = []; let previous = performance.now();
    const frame = (now: number) => { samples.push(now - previous); previous = now; if (samples.length < 30) requestAnimationFrame(frame); else resolve(samples); }; requestAnimationFrame(frame);
  }));
  const sorted = intervals.slice().sort((a, b) => a - b);
  await writeFile("output/unified-canvas/100-materials-performance.json", JSON.stringify({ medianMs: sorted[15], p95Ms: sorted[28], intervals }, null, 2));
  expect(sorted[15]).toBeLessThan(50); expect(state.errors).toEqual([]);
  await page.screenshot({ path: "output/unified-canvas/100-materials-reduced-motion.png" });
});
