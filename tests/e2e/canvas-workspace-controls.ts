import type { Page } from "@playwright/test";

export async function canvasAction(page: Page, name: string) {
  await page.getByRole("button", { name: "更多白板操作", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
