import { chooseValue } from "./choice-control";
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { seedVisualApp, settleImages, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { contrastFailures } from "./review-accessibility";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
});

for (const width of [1440, 1366, 1024, 390, 375])
  test(`统一导航 ${width}：跨页外观、账户位置和当前入口保持一致`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({
      width,
      height:
        width === 1366 ? 768 : width === 375 ? 812 : width < 768 ? 844 : 900,
    });
    const pages = [
      ["projects", "/"],
      ["design", `/${PROJECT}`],
      ["tech", `/${PROJECT}/studio?tab=tech`],
      ["fabrics", `/fabrics?from=board&boardId=${PROJECT}`],
      ["trends", `/trends?from=board&boardId=${PROJECT}`],
    ] as const;
    let baseline: unknown;
    for (const [name, url] of pages) {
      await page.goto(url);
      if (name === "fabrics")
        await expect(
          page
            .getByRole("img", { name: "棉布、哑光、通勤", exact: true })
            .first(),
        ).toBeVisible();
      if (name === "trends")
        await expect(
          page.getByRole("heading", {
            name: "克制的都市通勤廓形",
            exact: true,
          }),
        ).toBeVisible();
      const rail = page.getByRole("complementary", { name: "工作区目录" });
      await expect(rail).toBeVisible();
      await expect(rail.locator("img")).toHaveAttribute(
        "src",
        /logo-original-transparent/,
      );
      const account = rail.getByRole("button", { name: "designer@example.com", exact: true });
      await expect(account).toBeInViewport();
      await expect(account).toHaveCSS("min-height", "44px");
      await account.click();
      await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(account).toBeFocused();
      const geometry = await rail.evaluate((element) => {
        const style = getComputedStyle(element),
          bounds = element.getBoundingClientRect();
        const account = element.querySelector('summary[aria-label="designer@example.com"]')
          ?.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          color: style.color,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          accountY: account?.y,
        };
      });
      const expectedSurface = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.background = "var(--color-navigation)";
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      expect(geometry.background).toBe(expectedSurface);
      if (baseline) expect(geometry).toEqual(baseline);
      else baseline = geometry;
      if (width < 1200) {
        const menu = rail.locator('summary[aria-label="切换工作区"]');
        await menu.click();
        await expect(
          page.getByRole("group", { name: "切换工作区选项", exact: true }).locator('a[aria-current="page"]:visible'),
        ).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      } else
        await expect(
          rail.locator('a[aria-current="page"]:visible'),
        ).toHaveCount(1);
      expect(
        await contrastFailures(page, true, "[data-archive-navigation]"),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (name === "tech") {
        await expect(
          page.getByLabel("技术包名称", { exact: true }),
        ).toHaveValue("褶线夹克技术资料");
        if (width >= 1200)
          await expect(
            page.getByRole("tab", { name: "技术包", exact: true }),
          ).toBeInViewport();
      }
      if (process.env.CAPTURE_NAVIGATION) {
        await settleImages(page);
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          (document.activeElement as HTMLElement)?.blur();
        });
        await mkdir("output/unified-navigation/screens", { recursive: true });
        await page.screenshot({
          path: `output/unified-navigation/screens/${name}-${width}.png`,
          animations: "disabled",
        });
      }
    }
  });

test("工作室导航离开保护与面料返回保留项目", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=styles&styleRevisionId=style-r1`);
  await page.getByLabel("款式名称", { exact: true }).fill("仍在编辑的款式");
  const navigation = page.getByRole("navigation", {
    name: "工作区导航",
    exact: true,
  });
  await navigation.getByRole("link", { name: "面料库", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "仍在编辑的款式",
  );
  await navigation.getByRole("link", { name: "面料库", exact: true }).click();
  await guard.getByRole("button", { name: "丢弃并离开", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/fabrics\\?from=board&boardId=${PROJECT}`),
  );
  await expect(
    navigation.getByRole("link", { name: "设计工作台", exact: true }),
  ).toHaveAttribute("href", `/${PROJECT}`);
});

for (const width of [1440, 390])
  test(`连续进入项目、工作台和技术包 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("link", { name: "继续创作", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
    const navigation = page.getByRole("navigation", {
      name: "工作区导航",
      exact: true,
    });
    if (width < 1200) {
      await navigation.locator("summary").click();
      if (process.env.CAPTURE_NAVIGATION)
        await page.screenshot({
          path: "output/unified-navigation/screens/navigation-menu-390.png",
        });
    }
    await (width < 1200 ? page.getByRole("group", { name: "切换工作区选项", exact: true }) : navigation)
      .getByRole("link", { name: "款式与交付", exact: true })
      .click();
    if (width < 1200)
      await chooseValue(page.getByLabel("当前功能", { exact: true }), "tech");
    else await page.getByRole("tab", { name: "技术包", exact: true }).click();
    await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue(
      "褶线夹克技术资料",
    );
    await expect(page).toHaveURL(new RegExp(`/${PROJECT}/studio\\?tab=tech`));
    const account = page
      .getByRole("complementary", { name: "工作区目录" })
      .getByRole("button", { name: "designer@example.com", exact: true });
    await account.click();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeInViewport();
    if (width < 1200 && process.env.CAPTURE_NAVIGATION)
      await page.screenshot({
        path: "output/unified-navigation/screens/account-menu-390.png",
      });
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
  });
