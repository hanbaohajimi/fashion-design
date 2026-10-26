import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { NOW, PROJECT, seedVisualApp } from "../visual/fixtures";

const artifacts = "output/playwright/project-motion";
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mkdir(artifacts, { recursive: true });
});
async function mockProjects(page: Page) {
  const projects = [
    { id: PROJECT, name: "秋冬通勤服装设计", archived: false, assetCount: 2, coverAssetId: "cover", coverUrl: "/visual-garment.svg", createdAt: NOW, updatedAt: NOW },
    { id: "second", name: "针织系列探索", archived: false, assetCount: 0, coverAssetId: null, coverUrl: null, createdAt: NOW, updatedAt: NOW },
  ];
  const searches: string[] = [];
  const writes: Array<{ id: string; archived: boolean }> = [];
  await page.route("**/api/projects**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/projects" && route.request().method() === "GET") {
      const search = url.searchParams.get("search") ?? "";
      searches.push(search);
      if (search) await new Promise((resolve) => setTimeout(resolve, 600));
      const items = projects.filter((item) => item.archived === (url.searchParams.get("archived") === "archived") && item.name.includes(search));
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 50, hasMore: false } });
    }
    const project = projects.find((item) => url.pathname === `/api/projects/${item.id}`);
    if (project && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { archived: boolean };
      project.archived = body.archived;
      writes.push({ id: project.id, archived: body.archived });
      return route.fulfill({ json: project });
    }
    return route.fallback();
  });
  return { searches, writes };
}

test("项目搜索等待IME提交并保留旧结果，归档批次可真实恢复", async ({ page }) => {
  const { searches, writes } = await mockProjects(page);
  await page.goto("/");
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  const search = page.getByRole("searchbox", { name: "搜索项目" });
  await search.dispatchEvent("compositionstart");
  await search.fill("zhen");
  await page.waitForTimeout(350);
  expect(searches.every((value) => value === "")).toBe(true);
  await search.fill("针织");
  await search.dispatchEvent("compositionend");
  await expect.poll(() => searches.includes("针织")).toBe(true);
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  await expect(page.getByText("正在搜索，暂显示上次结果…")).toBeVisible();
  await expect(page.locator("[data-project-id]")).toHaveCount(1);
  await search.fill("");
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  for (const id of [PROJECT, "second"]) {
    const card = page.locator(`[data-project-id="${id}"]`);
    await card.locator("summary").click();
    await card.getByRole("button", { name: "归档", exact: true }).click();
  }
  await expect(page.getByText("已归档 2 个项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "项目列表", exact: true }).locator(':scope > [aria-hidden="true"]')).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/archive-undo.png` });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  expect(writes.filter((write) => write.archived)).toHaveLength(2);
  expect(writes.filter((write) => !write.archived)).toHaveLength(2);
});

for (const width of [390, 375]) {
  test(`手机面料筛选草稿保留、应用与焦点返回 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/fabrics");
    await expect(page.getByText("6 项面料", { exact: true })).toBeVisible();
    const trigger = page.getByRole("button", { name: /^规格筛选/u });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "面料规格筛选" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-phase", "open");
    await sheet.getByRole("textbox", { name: "成分", exact: true }).fill("未应用草稿");
    await sheet.getByRole("button", { name: "取消", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(sheet).toHaveAttribute("data-phase", "open");
    await expect(sheet.getByRole("textbox", { name: "成分", exact: true })).toHaveValue("未应用草稿");
    await sheet.getByRole("textbox", { name: "成分", exact: true }).fill("棉");
    await page.screenshot({ path: `${artifacts}/filters-${width}.png` });
    const applied = page.waitForRequest((request) => new URL(request.url()).searchParams.get("fiber") === "棉");
    await sheet.getByRole("button", { name: "应用筛选", exact: true }).click();
    await applied;
    await expect(sheet).not.toBeVisible();
    await expect(page.getByRole("button", { name: "移除成分筛选" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await trigger.click();
    await expect(sheet).toHaveAttribute("data-phase", "open");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const handle = sheet.locator("[data-sheet-handle]");
    const drag = async (x: number, y: number, distance: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + distance * step / 8 }] });
        await page.waitForTimeout(25);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    let bounds = await handle.boundingBox();
    if (!bounds) throw new Error("筛选把手不可见");
    await drag(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 18);
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate((element) => Math.abs(new DOMMatrix(getComputedStyle(element).transform).m42))).toBeLessThan(1);
    const sheetBounds = await sheet.boundingBox();
    if (!sheetBounds) throw new Error("筛选面板不可见");
    await drag(sheetBounds.x + 12, sheetBounds.y + 220, -70);
    await expect(sheet).toBeVisible();
    await sheet.evaluate((element) => { element.scrollTop = 0; });
    bounds = await handle.boundingBox();
    if (!bounds) throw new Error("筛选把手不可见");
    await drag(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, sheetBounds.height * .4);
    await expect(sheet).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await cdp.detach();
  });
}
