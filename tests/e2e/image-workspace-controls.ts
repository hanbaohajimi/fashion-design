import { expect, type Locator } from "@playwright/test";

export async function openImageComparison(workspace: Locator) {
  await workspace.getByRole("button", { name: "版本与对比", exact: true }).click();
  await workspace.getByRole("button", { name: "对比图片", exact: true }).click();
}

export async function imageScale(workspace: Locator) {
  return workspace.getByLabel("图片查看区域", { exact: true }).getByRole("img").first().evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width / image.naturalWidth);
}

export async function zoomImageToDetail(workspace: Locator) {
  await workspace.getByLabel("图片查看区域", { exact: true }).dblclick();
  await expect.poll(() => imageScale(workspace)).toBeCloseTo(2, 2);
}
