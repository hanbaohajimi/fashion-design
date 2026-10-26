import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { seedVisualApp } from "../visual/fixtures";

const artifacts = "output/playwright/system-motion";
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mkdir(artifacts, { recursive: true });
});

test("弹窗退场、返回焦点和运行中减弱动态", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "新建项目", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "给新系列一个名字" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-phase", "open");
  await page.screenshot({ path: `${artifacts}/dialog-open.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("data-phase", "closing");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog).toHaveAttribute("data-phase", "open");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("登录格式校验和真实返回驱动的等待结果", async ({ page }) => {
  await page.route("**/api/auth/login", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: "邮箱地址" });
  await email.fill("bad-address");
  await expect(page.getByText("请输入有效的邮箱地址。", { exact: true })).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await email.fill("motion@example.com");
  await expect(email).not.toHaveAttribute("aria-invalid");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  const send = page.locator('button[type="submit"]');
  await expect(send).toHaveAttribute("aria-busy", "true");
  await expect(send).toHaveAttribute("data-feedback", "pending");
  await expect(page.getByRole("status")).toContainText("motion@example.com");
  await expect(send).toHaveAttribute("data-feedback", "success");
  await page.screenshot({ path: `${artifacts}/login-success.png` });
});

test("断网提示保留页面并只报告连接恢复", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("[data-project-id]").first()).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("status", { name: "网络已断开，已加载的内容仍可查看" })).toBeVisible();
  await expect(page.locator("[data-project-id]").first()).toBeVisible();
  await page.screenshot({ path: `${artifacts}/offline.png` });
  await context.setOffline(false);
  await expect(page.getByRole("status", { name: "连接已恢复" })).toBeVisible();
  await expect(page.getByRole("status", { name: "连接已恢复" })).not.toBeVisible();
});

for (const width of [1600, 1440, 1024, 390, 375]) {
  test(`共享弹层与导航 ${width}px 边界`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "给新系列一个名字" });
    await expect(dialog).toHaveAttribute("data-phase", "open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${artifacts}/dialog-${width}.png` });
    await page.emulateMedia({ forcedColors: "active" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "新建项目", exact: true })).toBeFocused();
  });
}
