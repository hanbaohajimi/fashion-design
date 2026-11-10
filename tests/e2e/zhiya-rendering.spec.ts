import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { elementBox, emptyActivity, hit, loadZhiya, openZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.skip(!process.env.ZHIYA_CLIP_AUDIT, "指定桌面界面的 clip-audit.js 检查脚本");
test.setTimeout(60_000);

test("默认、悬停、展开与落定四种状态的边缘与投影", async ({ page }) => {
  const auditPath = process.env.ZHIYA_CLIP_AUDIT;
  if (!auditPath) throw new Error("缺少阴影检查脚本");
  const audit = await readFile(auditPath, "utf8");
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await expect(zhiya(page)).toHaveAttribute("data-body-surface", "mesh");
  const reports: Record<string, unknown> = {};
  const inspect = async (name: string, root = "[data-zhiya]") => {
    const result = await page.evaluate(`(${audit})(${JSON.stringify({ root, tol: 1 })})`) as { ok: boolean; cut: number; hidden: number };
    reports[name] = result;
    expect(result.ok, name).toBe(true);
    expect(result.cut, name).toBe(0);
  };
  await inspect("idle");
  await hit(page).hover({ position: { x: 48, y: 80 } });
  await expect(zhiya(page)).toHaveAttribute("data-action", "hello");
  await inspect("hover");
  await page.screenshot({ path: "output/playwright/zhiya/hover.png" });
  await openZhiya(page);
  await inspect("chat-open", "#assistant");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  const box = await elementBox(hit(page));
  await page.mouse.move(box.x + 48, box.y + 80); await page.mouse.down();
  await expect(zhiya(page)).toHaveAttribute("data-held", "true");
  await page.mouse.move(box.x - 90, box.y, { steps: 8 }); await page.mouse.up();
  await expect(zhiya(page)).toHaveAttribute("data-action", "land");
  await expect(zhiya(page)).toHaveAttribute("data-action", "idle");
  await inspect("landed");
  state.activity = { ...emptyActivity(), executing: 1 };
  // Focus refresh reads a new controlled task snapshot without a second polling source.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(zhiya(page)).toHaveAttribute("data-scene", "working", { timeout: 20_000 });
  await expect.poll(() => zhiya(page).locator(".pp-work-kit").evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(.95);
  await inspect("working");
  await mkdir("output/playwright/zhiya", { recursive: true });
  await writeFile("output/playwright/zhiya/clipping.json", JSON.stringify(reports, null, 2), "utf8");
});
