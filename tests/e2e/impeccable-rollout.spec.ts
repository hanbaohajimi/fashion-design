import { expect, test } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { contrastFailures } from "./review-accessibility";
import { expectValue } from "./choice-control";

test("从选定款式继续技术包保持确切修订，未保存内容仍受保护", async ({
  page,
}) => {
  await seedVisualApp(page);
  const data = workspaceFixture();
  const first = data.styles[0];
  if (!first) throw new Error("测试资料缺少初始款式");
  const second = structuredClone(first);
  second.id = "style-second";
  second.name = "长款通勤风衣";
  second.code = "CT-102";
  second.currentRevision.id = "style-second-r3";
  second.currentRevision.revision = 3;
  second.currentRevision.payload.name = second.name;
  second.currentRevision.payload.code = second.code;
  second.revisions = [second.currentRevision];
  data.styles.push(second);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.locator("summary").filter({ hasText: "切换款式" }).click();
  await page.getByRole("button", { name: /CT-102 长款通勤风衣/ }).click();
  await page.getByRole("button", { name: "继续技术包", exact: true }).click();
  await expect(page).toHaveURL(/styleRevisionId=style-second-r3/);
  await expectValue(page.getByLabel("对应款式修订"), "style-second-r3");
  const object = page.getByRole("region", { name: "当前关联作品" });
  await expect(object).toContainText("长款通勤风衣");
  await expect(object).toContainText("款式修订 r3");
  await page.getByLabel("技术包名称", { exact: true }).fill("风衣生产资料草稿");
  await page.getByRole("link", { name: "设计工作台", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "保留未保存的修改" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue(
    "风衣生产资料草稿",
  );
});

test("修订深链恢复到对应技术包，待复核项可定位原章节", async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.goto(`/${PROJECT}/studio?tab=tech&styleRevisionId=style-r1`);
  await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue(
    "褶线夹克技术资料",
  );
  const readiness = page.getByRole("region", { name: "发布准备情况" });
  await page
    .getByRole("navigation", { name: "技术包章节" })
    .getByRole("button", { name: "复核发布", exact: true })
    .click();
  await readiness.getByRole("button", { name: /BOM/ }).click();
  await expect(
    page.getByRole("heading", { name: "材料与辅料 BOM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "当前关联作品" }),
  ).toContainText("褶线夹克");
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 720, height: 450 },
]) {
  test(`档案导航、对象和表单在 ${viewport.width} 可达且没有文字对比度回退`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seedVisualApp(page);
    await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
      route.fulfill({ json: workspaceFixture() }),
    );
    for (const path of ["/", `/${PROJECT}/studio?tab=tech`]) {
      await page.goto(path);
      if (path === "/")
        await expect(
          page.getByRole("navigation", { name: "工作区导航", exact: true }),
        ).toBeVisible();
      else if (viewport.width < 1200)
        await expect(
          page.getByLabel("当前功能", { exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("tablist", { name: "设计工作室功能" }),
        ).toBeVisible();
      await expect(page.locator("main h1, main h2").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await contrastFailures(page)).toEqual([]);
    }
  });
}
