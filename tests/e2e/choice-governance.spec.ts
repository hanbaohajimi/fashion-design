import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { chooseValue, valueControl } from "./choice-control";

const artifacts = "output/choice-governance/screenshots";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(artifacts, { recursive: true });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) => {
    const data = workspaceFixture();
    const brand = data.brandProfiles[0];
    if (!brand) throw new Error("测试资料缺少品牌");
    data.brandProfiles = Array.from({ length: 12 }, (_, index) => ({
      ...brand,
      id: `brand-${index + 1}`,
      currentRevision: {
        ...brand.currentRevision,
        id: `brand-revision-${index + 1}`,
        payload: {
          ...brand.currentRevision.payload,
          name: `品牌资料 ${index + 1}`,
        },
      },
    }));
    return route.fulfill({ json: data });
  });
});

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function boundsOf(control: Locator) {
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error("测试控件不可见");
  return bounds;
}

test("对象展开列表搜索已加载款式，取消离开仍保留当前草稿", async ({ page }) => {
  const data = workspaceFixture();
  const style = data.styles[0];
  if (!style) throw new Error("测试资料缺少款式");
  data.styles = Array.from({ length: 12 }, (_, index) => ({
    ...style,
    id: `style-${index + 1}`,
    name: `款式 ${index + 1}`,
    code: `JK-${index + 1}`,
    currentRevision: {
      ...style.currentRevision,
      id: `style-revision-${index + 1}`,
      payload: { ...style.currentRevision.payload, name: `款式 ${index + 1}` },
    },
  }));
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page
    .getByLabel("款式名称", { exact: true })
    .fill("当前款式的未保存修改");
  await page.locator("summary").filter({ hasText: "切换对象" }).click();
  await page.getByRole("textbox", { name: "搜索切换对象" }).fill("款式 12");
  const list = page.getByRole("complementary", { name: "已有款式" });
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.screenshot({ path: `${artifacts}/desktop-object-search.png` });
  await list.getByRole("button", { name: /款式 12/ }).click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "当前款式的未保存修改",
  );
});

test("桌面短选项平铺，任务类型回显但不提交，弹层最多264px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  const task = valueControl(page, "任务类型");
  await task.click();
  await expect(page.getByRole("listbox", { name: "任务类型" })).toBeVisible();
  const popup = page.locator('[data-popup-kind="anchored"]');
  expect((await boundsOf(popup)).height).toBeLessThanOrEqual(264);
  await page.screenshot({ path: `${artifacts}/desktop-task-select.png` });
  await page.getByRole("option", { name: /服装细节改款/ }).click();
  await expect(task).toContainText("服装细节改款");
  expect(writes).toEqual([]);
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.locator("summary").filter({ hasText: "视图资料" }).click();
  const view = page.getByRole("radiogroup", { name: "视图 1", exact: true });
  await expect(view.getByRole("radio")).toHaveCount(3);
  await view.getByRole("radio", { name: "背面", exact: true }).click();
  await expect(
    view.getByRole("radio", { name: "背面", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  expect(writes).toEqual([]);
  await noOverflow(page);
  await page.screenshot({
    path: `${artifacts}/desktop-style-radios.png`,
    fullPage: true,
  });
});

test("长列表搜索中文、空结果和取消不修改当前品牌", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  await page.locator("summary").filter({ hasText: "品牌关联" }).click();
  const brand = valueControl(page, "采用品牌资料");
  await brand.click();
  const search = page.getByRole("combobox", { name: "搜索采用品牌资料" });
  await expect(search).toBeFocused();
  await search.fill("品牌资料 12");
  await expect(page.getByRole("option")).toHaveCount(1);
  const popup = page.locator('[data-popup-kind="anchored"]');
  expect((await boundsOf(popup)).height).toBeLessThanOrEqual(264);
  await page.screenshot({ path: `${artifacts}/desktop-brand-search.png` });
  await search.fill("不存在的品牌");
  await expect(
    page.getByRole("status").filter({ hasText: "没有匹配的已加载选项" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(brand).toBeFocused();
  await expect(brand).toContainText("本次不关联品牌");
  await chooseValue(brand, "brand-12");
  await expect(brand).toContainText("品牌资料 12");
});

test("手机上方往下展开，底部使用Sheet且缩小视口不改变形态", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=tasks`);
  const task = valueControl(page, "任务类型");
  await expect(task).toBeVisible();
  await task.scrollIntoViewIfNeeded();
  await task.click();
  const topPopup = page.locator('[data-popup-kind="anchored"]');
  await expect(topPopup).toBeVisible();
  expect((await boundsOf(topPopup)).height).toBeLessThanOrEqual(264);
  const triggerBox = await boundsOf(task);
  expect((await boundsOf(topPopup)).y).toBeGreaterThanOrEqual(
    triggerBox.y + triggerBox.height,
  );
  await page.screenshot({ path: `${artifacts}/phone-top-select.png` });
  await page.keyboard.press("Escape");
  await page.locator("summary").filter({ hasText: "品牌关联" }).click();
  const brand = valueControl(page, "采用品牌资料");
  await brand.scrollIntoViewIfNeeded();
  await brand.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    window.scrollBy(0, bounds.bottom - innerHeight + 100);
  });
  await brand.click();
  const sheet = page.getByRole("dialog", { name: "采用品牌资料", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-popup-kind="sheet"]')).toBeVisible();
  await page
    .getByRole("combobox", { name: "搜索采用品牌资料" })
    .fill("品牌资料 12");
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(sheet.locator('[data-popup-kind="sheet"]')).toBeVisible();
  const bounds = await boundsOf(sheet);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
  await page.screenshot({
    path: `${artifacts}/phone-bottom-sheet-keyboard.png`,
  });
  await page.keyboard.press("Escape");
  await expect(brand).toBeFocused();
  await expect(brand).toContainText("本次不关联品牌");
  await noOverflow(page);
});

test("手机功能导航搜索页面并保留未保存保护", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.getByLabel("款式名称", { exact: true }).fill("保留未保存款式草稿");
  const navigation = page.getByLabel("当前功能", { exact: true });
  await navigation.click();
  await page.getByRole("searchbox", { name: "搜索当前功能" }).fill("技术包");
  await page
    .getByRole("group", { name: "当前功能选项", exact: true })
    .getByRole("button", { name: "技术包", exact: true })
    .click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(/tab=styles/);
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "保留未保存款式草稿",
  );
  await expect(
    page.getByRole("button", { name: "刷新资料", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `${artifacts}/phone-navigation-guard.png`,
    fullPage: true,
  });
});

test("关联图片在模态内搜索，取消保留绑定，确认才应用", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.locator("summary").filter({ hasText: "视图资料" }).click();
  const field = page
    .getByText("关联图片", { exact: true })
    .first()
    .locator("..");
  const open = field.getByRole("button", { name: /更换或添加图片/ });
  const proxy = field.locator("select");
  const previous = await proxy.inputValue();
  await open.click();
  const picker = page.getByRole("dialog", { name: "关联图片", exact: true });
  await picker.getByRole("textbox", { name: "搜索设计图片" }).fill("2");
  await picker.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await expect(proxy).toHaveValue(previous);
  await expect(open).toBeFocused();
  await open.click();
  await picker.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await picker.getByRole("button", { name: /确认选择 · 1 张/ }).click();
  await expect(proxy).toHaveValue("asset-back");
  await noOverflow(page);
  await page.screenshot({
    path: `${artifacts}/desktop-image-selection.png`,
    fullPage: true,
  });
});

test("成员权限平铺，失败保留原角色，重试只提交所选角色", async ({ page }) => {
  const data = workspaceFixture();
  data.members.push({
    id: "member-editor",
    userId: "colleague",
    email: "colleague@example.com",
    role: "EDITOR",
    version: 1,
  });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: data }),
  );
  const writes: Record<string, unknown>[] = [];
  await page.route(
    `**/api/projects/${PROJECT}/studio/members/member-editor`,
    (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (writes.length === 1)
        return route.fulfill({
          status: 500,
          json: { message: "权限保存失败，请重试" },
        });
      const member = data.members[1];
      if (!member) throw new Error("测试资料缺少成员");
      data.members[1] = { ...member, role: "REVIEWER", version: 2 };
      return route.fulfill({ json: data.members[1] });
    },
  );
  await page.goto(`/${PROJECT}/studio?tab=team`);
  await page.getByRole("tab", { name: "成员管理", exact: true }).click();
  const role = page.getByRole("radiogroup", {
    name: "colleague@example.com 的权限",
  });
  await expect(role.getByRole("radio")).toHaveCount(3);
  await role.getByRole("radio", { name: "评审", exact: true }).click();
  await expect(
    page.getByText("权限保存失败，请重试", { exact: true }),
  ).toBeVisible();
  await expect(
    role.getByRole("radio", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await role.getByRole("radio", { name: "评审", exact: true }).click();
  await expect(
    role.getByRole("radio", { name: "评审", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({ role: "REVIEWER", expectedVersion: 1 });
  expect(writes[1]).toMatchObject({ role: "REVIEWER", expectedVersion: 1 });
  await page.screenshot({
    path: `${artifacts}/desktop-member-role.png`,
    fullPage: true,
  });
});
