import { valueControl, chooseValue } from "./choice-control";
import { test, expect } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
});

for (const width of [1738, 1440, 1280, 1200, 1199, 1024, 390]) {
  test(`展示工作区在 ${width}px 保持资料与操作可达`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto(`/${PROJECT}/studio?tab=presentation`);
    await expect(
      page.getByRole("heading", { name: "夹克商品展示", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("展示包名称", { exact: true })).toBeVisible();
    if (width < 1200) {
      const navigation = valueControl(page, "当前功能");
      await expect(navigation).toBeVisible();
      await chooseValue(navigation, "styles");
      await expect(page).toHaveURL(/tab=styles/);
      // The responsive variant is intentionally scoped to this page.
      await page.goto(`/${PROJECT}/studio?tab=presentation`);
      await expect(page).toHaveURL(/tab=presentation/);
    } else {
      await expect(
        page.getByRole("tab", { name: "商品展示", exact: true }),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "逐图核对", exact: true }).click();
    await expect(
      page.getByAltText("展示图片 1", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("展示说明", { exact: true })
      .fill("保持真实服装结构与完整轮廓。".repeat(100));
    await page
      .getByRole("button", { name: "保存修订", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "保存修订", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/presentation-redesign/test-fixture-review-${width}.png`,
      fullPage: true,
    });
  });
}

test("查看原图不改变选择，Escape 后恢复焦点", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const trigger = page.getByRole("button", { name: /查看大图：/ }).first();
  const selected = page.getByRole("button", {
    name: "选择图片 1",
    exact: true,
  });
  const before = await selected.getAttribute("aria-pressed");
  await trigger.click();
  await expect(page.getByRole("dialog", { name: /查看大图：/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(before).not.toBeNull();
  await expect(selected).toHaveAttribute("aria-pressed", before ?? "false");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
});

test("原生校验能从整理视图定位隐藏的逐图必填说明", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  await page.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByLabel("图片 2 说明", { exact: true })).toBeVisible();
  await expect(page.getByLabel("图片 2 说明", { exact: true })).toBeFocused();
  await page.getByLabel("图片 2 说明", { exact: true }).fill("背面结构展示");
  await page.getByRole("checkbox", { name: /已人工核对图片 2/ }).check();
  await chooseValue(valueControl(page, "图片 2 视图"), "back");
  await expect(
    page.getByRole("checkbox", { name: /已人工核对图片 2/ }),
  ).not.toBeChecked();
});

test("无款式时允许整理、说明缺项，前往款式仍保护未保存修改", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studioFixture() }),
  );
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  await expect(page.getByText("新展示包尚未保存")).toBeVisible();
  await page.getByRole("button", { name: "选择图片 1", exact: true }).click();
  await page
    .getByRole("button", { name: "核对并完成展示包", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "商品展示包工作区" }).getByRole("alert"),
  ).toContainText("关联款式");
  await page.getByRole("button", { name: "前往款式档案", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "保留未保存的修改" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "逐图核对", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("只读资料常驻且仍可浏览图片", async ({ page }) => {
  const data = workspaceFixture();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: {
        ...data,
        role: "VIEWER",
        capabilities: { edit: false, review: false, manageMembers: false },
      },
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  await expect(page.getByLabel("展示包名称", { exact: true })).toBeVisible();
  await expect(page.getByLabel("展示包名称", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "保存修订", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "逐图核对", exact: true }).click();
  await page.getByRole("button", { name: "查看大图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /查看大图：/ })).toBeVisible();
});

test("父级导航层级在工作室子页间保持一致", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const parent = page
    .getByRole("navigation", { name: "工作区导航" })
    .getByRole("link", { name: "款式与交付", exact: true });
  await expect(parent).toHaveAttribute("data-current-parent", "true");
  await page.getByRole("tab", { name: "款式档案", exact: true }).click();
  await expect(parent).toHaveAttribute("data-current-parent", "true");
});
