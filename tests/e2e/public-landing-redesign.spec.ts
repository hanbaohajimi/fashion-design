import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { contrastFailures, controlFontFailures } from "./review-accessibility";
import { hideDevelopmentChrome } from "./workflow-navigation";
import { settleImages } from "../visual/fixtures";

const screens = "output/public-landing-redesign/screens";

async function anonymousLanding(page: Page) {
  await hideDevelopmentChrome(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { message: "未登录" } }),
  );
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "未登录" } }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({ status: 401, json: { message: "未登录" } }),
  );
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

for (const viewport of [
  { width: 1568, height: 1003 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 900, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
]) {
  test(`服装公开页 ${viewport.width}：完整影像、清晰文案和响应式布局`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await anonymousLanding(page);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const headline = page.getByRole("heading", {
      name: /让灵感，\s*穿上形状/u,
    });
    await expect(headline).toBeVisible();
    await expect(
      page.getByRole("link", { name: "开始创作", exact: true }).first(),
    ).toBeInViewport();
    await expect(
      page.getByRole("link", { name: "开始创作", exact: true }).first(),
    ).toHaveAttribute("href", "/login");
    await expect(
      page.getByRole("img", { name: /象牙白.*外套/ }).first(),
    ).toBeVisible();
    await settleImages(page);
    for (const figure of await page.locator("main figure").all())
      await figure.scrollIntoViewIfNeeded();
    await page.locator("main > footer").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleImages(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const titleMetrics = await headline.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(titleMetrics.height).toBeLessThanOrEqual(
      titleMetrics.lineHeight * (viewport.width > 900 ? 1.3 : 2.3),
    );
    if (viewport.width < 768) {
      const frames = await page
        .locator("#process figure")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            x: element.getBoundingClientRect().x,
            y: element.getBoundingClientRect().y,
          })),
        );
      expect(frames).toHaveLength(3);
      expect(frames[1]?.x).toBe(frames[0]?.x);
      expect(frames[1]?.y).toBeGreaterThan(frames[0]?.y ?? 0);
      expect(frames[2]?.y).toBeGreaterThan(frames[1]?.y ?? 0);
    }
    expect(
      await page
        .locator("main img")
        .evaluateAll((images) =>
          images
            .filter(
              (image) =>
                image instanceof HTMLImageElement &&
                (!image.complete || image.naturalWidth === 0),
            )
            .map((image) => image.getAttribute("src")),
        ),
    ).toEqual([]);
    expect(await contrastFailures(page, true)).toEqual([]);
    expect(await controlFontFailures(page)).toEqual([]);
    expect(errors).toEqual([]);
    await mkdir(screens, { recursive: true });
    await page.screenshot({
      path: `${screens}/public-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (viewport.width === 1568)
      await page.screenshot({
        path: `${screens}/first-viewport.png`,
        animations: "disabled",
      });
  });
}

test("作品方向可用指针和键盘切换，不会触发创作请求", async ({ page }) => {
  await anonymousLanding(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      /^\/api\/(?:projects|generations|agent-conversations)(?:\/|$)/u.test(
        new URL(request.url()).pathname,
      ) &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      writes.push(request.url());
  });
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "设计方向", exact: true });
  await tabs.scrollIntoViewIfNeeded();
  const natural = tabs.getByRole("tab", { name: "自然肌理", exact: true });
  const silhouette = tabs.getByRole("tab", { name: "流动廓形", exact: true });
  const palette = tabs.getByRole("tab", { name: "克制色彩", exact: true });
  await expect(natural).toHaveAttribute("aria-selected", "true");
  await settleImages(page);
  await page.locator("#inspiration figure").scrollIntoViewIfNeeded();
  await mkdir(screens, { recursive: true });
  await page.screenshot({
    path: screens + "/look-natural.png",
    animations: "disabled",
  });
  await silhouette.click();
  await expect(silhouette).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: screens + "/look-silhouette.png",
    animations: "disabled",
  });
  await silhouette.press("ArrowRight");
  await expect(palette).toHaveAttribute("aria-selected", "true");
  await expect(palette).toBeFocused();
  await page.screenshot({
    path: screens + "/look-palette.png",
    animations: "disabled",
  });
  await palette.press("Home");
  await expect(natural).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "自然肌理", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("手机导航可关闭和跳转，创作入口保留登录交接", async ({ page }) => {
  await anonymousLanding(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "页面导航", exact: true });
  const nav = page.getByRole("navigation", {
    name: "公开页面导航",
    exact: true,
  });
  await settleImages(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    nav.getByRole("link", { name: "创作方式", exact: true }),
  ).toBeVisible();
  await mkdir(screens, { recursive: true });
  await page.screenshot({
    path: screens + "/mobile-navigation-open.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    nav.getByRole("link", { name: "作品与灵感", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: screens + "/mobile-navigation-focus.png",
    animations: "disabled",
  });
  await page.keyboard.press("Tab");
  await expect(
    nav.getByRole("link", { name: "创作方式", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    nav.getByRole("link", { name: "设计工具", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("link", { name: "开始创作", exact: true }).first(),
  ).toBeFocused();
  await toggle.click();
  await nav.getByRole("link", { name: "创作方式", exact: true }).click();
  await expect(page).toHaveURL(/#process$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", { name: "从一块面料，到一个系列", exact: true }),
  ).toBeInViewport();
  await expect(page.getByRole("link", { name: /以面料开始/ })).toHaveAttribute(
    "href",
    "/login?starter=material",
  );
  await expect(page.getByRole("link", { name: /做一个系列/ })).toHaveAttribute(
    "href",
    "/login?starter=collection",
  );
  await expect(
    page.getByRole("link", { name: /准备视觉提案/ }),
  ).toHaveAttribute("href", "/login?starter=lookbook");
});

test("减少动态时保持内容可见，图片失败时仍可开始创作", async ({ page }) => {
  await anonymousLanding(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/_next/image?**", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /让灵感，\s*穿上形状/u }),
  ).toBeVisible();
  const action = page
    .getByRole("link", { name: "开始创作", exact: true })
    .first();
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", "/login");
  await page.locator("#tools").scrollIntoViewIfNeeded();
  await expect(page.locator("#tools h2")).toBeVisible();
});

test("内容渐入会完成，切换为减少动态后全部内容保持可读", async ({ page }) => {
  await anonymousLanding(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("heading", { name: /让灵感，/ }).waitFor();
  await page.locator("#tools").scrollIntoViewIfNeeded();
  const feature = page.locator("#tools li").first();
  await expect(feature).toHaveAttribute("data-revealed", "true");
  await expect(feature).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator("[data-reveal]")
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element).opacity === "1" &&
              getComputedStyle(element).transform === "none",
          ),
        ),
    )
    .toBe(true);
});
