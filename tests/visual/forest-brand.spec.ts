import { test, expect, seedVisualApp, settleImages } from "./fixtures";
import {
  contrastFailures,
  controlFontFailures,
} from "../e2e/review-accessibility";

test.beforeEach(async ({ page }) => seedVisualApp(page));

for (const width of [1440, 1024, 390, 320]) {
  test(`森织登录 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 900 });
    await page.goto("/login");
    await expect(page).toHaveTitle("森织");
    await expect(
      page.getByRole("complementary", { name: "森织 设计工作室" }),
    ).toBeVisible();
    await settleImages(page);
    const logo = page.locator('main img[src*="/branding/"]');
    expect(
      await logo.evaluate((element: HTMLImageElement) => ({
        loaded: element.complete && element.naturalWidth > 0,
        square: Math.abs(element.width - element.height) < 1,
      })),
    ).toEqual({ loaded: true, square: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await controlFontFailures(page)).toEqual([]);
    expect(await contrastFailures(page)).toEqual([]);
    const button = page.getByRole("button", { name: "发送登录链接" });
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page).toHaveScreenshot(`forest-login-${width}.png`, {
      fullPage: true,
    });
  });
}

test("森织登录：窄屏长邮箱、发送中、失败重试与键盘操作", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const email = `${"design".repeat(9)}@${"studio".repeat(8)}.example.com`;
  const recipients: string[] = [];
  let respond: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    respond = resolve;
  });
  await page.route("**/api/auth/login", async (route) => {
    recipients.push(route.request().postDataJSON().email as string);
    if (recipients.length === 1) {
      await gate;
      return route.abort("failed");
    }
    if (recipients.length === 3) {
      return route.fulfill({
        status: 503,
        json: { message: "邮件服务暂时不可用，请稍后重试。" },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/login");
  const input = page.getByRole("textbox", { name: "邮箱地址" });
  await input.fill(email);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "正在发送…" })).toBeDisabled();
  await expect(input).toBeDisabled();
  respond();
  const error = page.getByRole("region", { name: "登录或注册" }).getByRole("alert");
  await expect(error).toContainText("无法连接认证服务");
  await expect(input).toBeEnabled();
  await settleImages(page);
  await expect(page).toHaveScreenshot("forest-login-network-error-320.png", {
    fullPage: true,
  });
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await expect(error).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await contrastFailures(page)).toEqual([]);
  await expect(page).toHaveScreenshot("forest-login-sent-320.png", {
    fullPage: true,
  });
  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(error).toContainText("邮件服务暂时不可用");
  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(error).toHaveCount(0);
  await page.getByRole("button", { name: "换个邮箱" }).click();
  await expect(input).toBeFocused();
  await input.fill("another@example.com");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "发送登录链接" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("another@example.com");
  expect(recipients).toEqual([
    email,
    email,
    email,
    email,
    "another@example.com",
  ]);
});

test("森织登录：标识加载失败仍可发送链接", async ({ page }) => {
  await page.route("**/branding/**", (route) => route.abort());
  await page.goto("/login");
  await expect(page.getByText("森织", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "邮箱地址" })
    .fill("designer@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("designer@example.com");
});

test("森织品牌：图标、导航、确认页与公开分享", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("森织");
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
    "content",
    "森织",
  );
  const home = page.getByRole("link", { name: "森织 设计工作室 首页" });
  await expect(home).toHaveAttribute("href", "/");
  await expect(home.locator("img")).toHaveAttribute("alt", "");
  await settleImages(page);
  expect(
    await home
      .locator("img")
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBe(256);
  for (const selector of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
    const links = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLLinkElement).href),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const url of links) {
      const response = await page.evaluate(async (href) => {
        const result = await fetch(href);
        return { ok: result.ok, contentType: result.headers.get("content-type") };
      }, url);
      expect(response.ok).toBe(true);
      expect(response.contentType).toMatch(/image\//);
    }
  }
  await page.getByRole("link", { name: "面料库", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "工作区导航" })
      .getByRole("link", { name: "面料库" }),
  ).toHaveAttribute("aria-current", "page");
  await home.click();
  await expect(
    page.getByRole("heading", { name: "项目库", exact: true }),
  ).toBeVisible();
  await page.goto("/auth/confirm");
  await expect(
    page.getByText("森织 设计工作室", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "重新发送登录链接" }),
  ).toHaveAttribute("href", "/login");
  await page.route("**/api/image-shares/forest-brand", (route) =>
    route.fulfill({ json: { imageUrl: "/visual-garment.svg" } }),
  );
  await page.goto("/share/forest-brand");
  await expect(
    page.getByText("森织 · 分享的设计", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "分享的设计图片" })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入工作室" })).toHaveAttribute(
    "href",
    "/",
  );
});
