import { expect, type Page } from "@playwright/test";

export async function openCanvasFunction(page: Page, name: string) {
  const catalog = page.getByRole("dialog", {
    name: "全部功能模块",
    exact: true,
  });
  if (!(await catalog.isVisible()))
    await page
      .getByRole("button", { name: "全部功能模块", exact: true })
      .click();
  await catalog.getByRole("searchbox", { name: "搜索功能" }).fill(name);
  await catalog.getByRole("button", { name, exact: true }).last().click();
  await expect(catalog).toBeHidden();
}

export async function returnCanvasHome(page: Page) {
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "回到主页", exact: true }).click();
}
