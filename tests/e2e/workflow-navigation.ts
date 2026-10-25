import { expect, type Page } from "@playwright/test";

export async function openImageDetails(page: Page) {
  const image = page.getByRole("dialog", { name: "图片工作区", exact: true });
  await expect(image).toBeVisible();
  await image.getByRole("button", { name: "图像", exact: true }).click();
  await image.getByRole("button", { name: "来源与设计决策", exact: true }).click();
}

export async function closeNodeDetails(page: Page) {
  const image = page.getByRole("dialog", { name: "图片工作区", exact: true });
  if (await image.isVisible()) await image.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  else await page.getByRole("button", { name: /返回画布/ }).click();
}

/** Hide only Next's development chrome; runtime errors remain observable by tests. */
export async function hideDevelopmentChrome(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
}
