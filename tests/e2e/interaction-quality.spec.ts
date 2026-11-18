import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { seedVisualApp, NOW, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

const artifacts = "output/playwright/interaction-quality";
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mkdir(artifacts, { recursive: true });
});

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("交互目标不可见");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("桌面项目列表支持鼠标反馈与键盘打开创建窗口", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects");
  await expect(page.locator("[data-project-id]")).toHaveCount(2);
  const create = page.getByRole("button", { name: "新建项目", exact: true });
  const createPosition = await center(create);
  await page.mouse.move(createPosition.x, createPosition.y);
  await page.mouse.down();
  const ripple = create.locator("[aria-hidden] > span").last();
  await expect(ripple).toHaveCount(1);
  await ripple.evaluate((node) =>
    node.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = 120;
    }),
  );
  await page.screenshot({ path: `${artifacts}/desktop-ripple.png` });
  await ripple.evaluate((node) =>
    node.getAnimations().forEach((animation) => animation.play()),
  );
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "给新系列一个名字" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "创建项目", exact: true }),
  ).toHaveAttribute("data-interaction", "ripple");
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
});

for (const width of [1440, 1024, 390, 375]) {
  test(`内容与布局 ${width}：长名称、无封面、图片失败、空项目`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let variant = "long";
    await page.route("**/api/projects?*", (route) =>
      route.fulfill({
        json: {
          items:
            variant === "empty"
              ? []
              : [
                  {
                    id: PROJECT,
                    name: "服装系列设计与修订资料".repeat(8),
                    archived: false,
                    assetCount: 0,
                    coverAssetId: null,
                    coverUrl:
                      variant === "failed" ? "/missing-cover.png" : null,
                    createdAt: NOW,
                    updatedAt: NOW,
                  },
                ],
          total: variant === "empty" ? 0 : 1,
          page: 1,
          hasMore: false,
        },
      }),
    );
    await page.route("**/missing-cover.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    for (const state of ["long", "failed", "empty"]) {
      variant = state;
      await page.goto("/projects");
      if (state === "empty") {
        const start = page.getByRole("button", {
          name: "创建第一个项目",
          exact: true,
        });
        await expect(start).toHaveAttribute("data-interaction", "magnetic");
        await expect(
          page.locator("[data-project-card]"),
        ).toHaveCount(0);
        await start.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        const card = page.locator("[data-project-card]");
        await expect(card).toBeVisible();
        await expect(card.locator("img")).toHaveCount(0);
      }
      await assertNoOverflow(page);
      await page.screenshot({
        path: `${artifacts}/${state}-${width}.png`,
        fullPage: true,
      });
    }
    const selected = page.getByRole("button", { name: "进行中", exact: true });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(
      await selected.evaluate((node) => getComputedStyle(node).boxShadow),
    ).toContain("inset");
    await page.getByRole("button", { name: "已归档", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "已归档", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("偏好动态切换与高对比度保留操作、焦点和选择", async ({ page }) => {
  await page.goto("/projects");
  const link = page.getByRole("link", { name: /^打开项目 / }).first();
  await expect(link).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const create = page.getByRole("button", { name: "新建项目", exact: true });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(create.locator("[aria-hidden] > span")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await page.emulateMedia({
    reducedMotion: "no-preference",
    forcedColors: "active",
  });
  await link.focus();
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await page.screenshot({ path: `${artifacts}/forced-colors.png` });
  await assertNoOverflow(page);
});

test("保存按钮保留表单、失败草稿、重试与一次提交", async ({ page }) => {
  const studio = workspaceFixture();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studio }),
  );
  let writes = 0;
  await page.route(
    `**/api/projects/${PROJECT}/studio/styles/*`,
    async (route) => {
      writes++;
      if (writes === 1)
        return route.fulfill({
          status: 503,
          json: { message: "暂时无法保存，请重试" },
        });
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: { ...studio.styles[0], ...body, version: 2 },
      });
    },
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  const name = page.getByLabel("款式名称", { exact: true });
  await name.fill("保留完整轮廓的修订");
  const save = page.getByRole("button", { name: "保存修订", exact: true });
  await expect(save).toHaveAttribute("data-interaction", "spring");
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "暂时无法保存" }),
  ).toBeVisible();
  await expect(name).toHaveValue("保留完整轮廓的修订");
  await save.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => writes).toBe(2);
  await expect(save).toBeDisabled();
});

test.describe("触屏", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  test("轻触项目列表的创建按钮可打开窗口", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: /^打开项目 / }).first()).toBeVisible();
    await page.getByRole("button", { name: "新建项目", exact: true }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${artifacts}/touch-dialog.png` });
    await assertNoOverflow(page);
  });
});
