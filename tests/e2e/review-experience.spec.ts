import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { REVIEW_VIEWPORTS, contrastFailures, controlFontFailures } from "./review-accessibility";

test("登录样式契约、发送和失败状态", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: { ok: true } }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录或注册" })).toHaveCSS("font-size", "32px");
  const email = page.getByRole("textbox", { name: "邮箱地址" });
  await expect(email).toHaveCSS("font-size", "16px");
  await expect(email).toHaveCSS("border-bottom-width", "1px");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/review-login-after.png" });
  await email.fill("designer@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("请检查");
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 503, json: { message: "邮件服务暂不可用" } }));
  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "邮件服务暂不可用" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/review-login-error-after.png" });
});

test("后台会话变更时隔离项目缓存，旧请求不会回填新账号", async ({ page }) => {
  let identity = "a";
  let delayOld = false;
  let releaseOld: (() => void) | undefined;
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: identity, email: `${identity}@example.com`, name: identity }, credits: { limit: 600, used: 0, remaining: 600 },
  } }));
  await page.route("**/api/projects?*", async (route) => {
    const captured = identity;
    if (delayOld && captured === "a") await new Promise<void>((resolve) => { releaseOld = resolve; });
    await route.fulfill({ json: { items: [{ id: `project-${captured}`, name: `账号 ${captured} 的项目`, assetCount: 0, coverUrl: null, archived: false, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" }], page: 1, total: 1, hasMore: false } }).catch(() => undefined);
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "打开项目 账号 a 的项目" })).toBeVisible();
  await expect(page.locator("article").first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "output/playwright/review-projects-after.png" });
  delayOld = true;
  await page.getByRole("searchbox", { name: "搜索项目" }).fill("旧请求");
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  identity = "b";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("b@example.com", { exact: true })).toBeVisible();
  releaseOld?.();
  await expect(page.getByRole("link", { name: "打开项目 账号 b 的项目" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开项目 账号 a 的项目" })).toHaveCount(0);
});

test("真实项目封面优先显示，加载失败有可读回退", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "cover-user", email: "covers@example.com", name: "设计师" }, credits: { limit: 600, used: 0, remaining: 600 },
  } }));
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: Array.from({ length: 5 }, (_, index) => ({
    id: `cover-${index}`, name: `封面项目 ${index}`, assetCount: 1, coverUrl: index === 0 ? "/review-valid-cover" : index === 1 ? "/review-invalid-cover" : null,
    archived: false, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z",
  })), page: 1, total: 5, hasMore: false } }));
  await page.route("**/review-valid-cover", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#263950"/></svg>' }));
  await page.route("**/review-invalid-cover", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByRole("img", { name: "封面项目 0 封面", exact: true }).last()).toBeVisible();
  await expect(page.getByText("封面暂时无法加载", { exact: true })).toBeVisible();
  const contrastRatios = await page.locator('article [role="img"]').evaluateAll((covers) => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map((value) => Number(value) / 255) ?? [];
      return channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    };
    return covers.filter((cover) => !cover.querySelector("img")).map((cover) => {
      const text = cover.querySelector("small");
      if (!text) throw new Error("缺少封面回退说明");
      const foreground = luminance(getComputedStyle(text).color);
      const background = luminance(getComputedStyle(cover).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  });
  expect(contrastRatios).toHaveLength(4);
  expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5);
});

for (const viewport of REVIEW_VIEWPORTS) {
  for (const screen of ["login", "projects"]) {
    test(`${screen} 完整验收 ${viewport.width}×${viewport.height}：文字对比度与布局`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: "matrix", email: "designer@example.com", name: "设计师" }, credits: { limit: 600, used: 0, remaining: 600 } } }));
      await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: Array.from({ length: 5 }, (_, index) => ({
        id: `matrix-${index}`, name: `秋冬通勤服装 ${index + 1}`, assetCount: index, coverUrl: null, archived: false, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z",
      })), page: 1, total: 5, hasMore: false } }));
      await page.goto(screen === "login" ? "/login" : "/");
      if (screen === "projects") await expect(page.locator("article")).toHaveCount(5);
      else await expect(page.getByRole("heading", { name: "登录或注册" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await contrastFailures(page)).toEqual([]);
      expect(await controlFontFailures(page)).toEqual([]);
      await page.screenshot({ path: `output/playwright/review-${screen}-${viewport.width}-final.png`, fullPage: true });
      if (screen === "login") {
        await page.route("**/api/auth/login", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await route.fulfill({ json: { ok: true } });
        });
        await page.getByRole("textbox", { name: "邮箱地址" }).fill("designer@example.com");
        await page.getByRole("button", { name: "发送登录链接" }).click();
        await expect(page.getByRole("status")).toContainText("请检查");
        expect(await contrastFailures(page)).toEqual([]);
        await page.route("**/api/auth/login", (route) => route.fulfill({ status: 503, json: { message: "邮件服务暂不可用" } }));
        await page.getByRole("button", { name: "重新发送" }).click();
        await expect(page.getByRole("alert").filter({ hasText: "邮件服务暂不可用" })).toBeVisible();
      } else {
        await page.route("**/api/projects?*", (route) => route.fulfill({ status: 503, json: { message: "项目服务暂不可用" } }));
        await page.getByRole("searchbox", { name: "搜索项目" }).fill("失败状态验收");
        await expect(page.getByText("项目服务暂不可用", { exact: true })).toBeVisible();
      }
      expect(await contrastFailures(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/playwright/review-${screen}-error-${viewport.width}-final.png`, fullPage: true });
    });
  }
}
