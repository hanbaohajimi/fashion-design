import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: { id: "prototype", email: "designer@example.com", name: "设计师" }, credits: { limit: 100, used: 0, remaining: 100 } } }));
  await page.route("**/prototype-missing-image", (route) => route.fulfill({ status: 404, body: "missing" }));
});

test("三个结果原型可切换、保留选择、查看来源、重试且不写入真实接口", async ({ page }) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/prototypes/result-selection");
  await page.getByRole("button", { name: "选择候选", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("已选择 1 张");
  const picker = page.getByRole("navigation", { name: "Prototype variants" });
  await mkdir("output/playwright/optimization", { recursive: true });
  for (const [index, name] of ["矩阵", "比较", "队列"].entries()) {
    await picker.getByRole("button", { name }).click();
    await expect(page.getByRole("status")).toContainText("已选择 1 张");
    await expect(page).toHaveURL(new RegExp(`v=${index + 1}`));
    await page.getByRole("button", { name: "查看原图与来源" }).first().click();
    await expect(page.getByRole("dialog", { name: "候选原图与来源" })).toContainText("来源");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "查看原图与来源" }).first()).toBeFocused();
    await page.screenshot({ path: `output/playwright/optimization/result-${index + 1}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/optimization/result-${index + 1}-mobile.png` });
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已选择 0 张");
  await page.getByRole("button", { name: "撤销上一步" }).click();
  await expect(page.getByRole("status")).toContainText("已选择 1 张");
  await picker.getByRole("button", { name: "矩阵" }).click();
  await page.getByRole("button", { name: "演示重试" }).click();
  await expect(page.getByRole("button", { name: "选择候选", exact: true })).toHaveCount(5);
  await page.getByRole("button", { name: "查看款式保存预览" }).click();
  await expect(page.getByRole("dialog")).toContainText("尚未创建任何正式款式");
  await page.keyboard.press("Escape");
  await page.getByLabel("只读权限").check();
  await expect(page.getByRole("button", { name: "选择候选", exact: true }).first()).toBeDisabled();
  await page.keyboard.press("2");
  await expect(picker.getByRole("button", { name: "矩阵" })).toHaveAttribute("aria-current", "true");
  await picker.getByRole("button", { name: "矩阵" }).focus();
  await page.keyboard.press("2");
  await expect(picker.getByRole("button", { name: "比较" })).toHaveAttribute("aria-current", "true");
  await page.reload();
  await expect(picker.getByRole("button", { name: "比较" })).toHaveAttribute("aria-current", "true");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("最坏数据与空单条状态在 320px 可达，技术表保留输入", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 740 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/prototypes/ui-boundaries");
  for (const mode of ["empty", "one", "worst"]) {
    await page.getByLabel("边界数据").selectOption(mode);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.getByText("图片暂时无法加载").first()).toBeVisible();
  const quantity = page.getByLabel("BOM 1 用量");
  await quantity.fill("1.");
  await expect(quantity).toHaveValue("1.");
  await mkdir("output/playwright/optimization", { recursive: true });
  await page.screenshot({ path: "output/playwright/optimization/boundaries-320.png", fullPage: true });
  await page.getByLabel("边界数据").selectOption("large");
  await expect(page.getByRole("heading", { name: "面料卡片 · 1000 项" })).toBeVisible();
  await expect(page.getByLabel("BOM 100 用量")).toBeAttached();
  await expect(page.getByLabel("POM 100 公差")).toHaveValue("0");
  expect(errors).toEqual([]);
});
