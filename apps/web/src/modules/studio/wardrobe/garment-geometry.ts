import type { WardrobeRevisionView } from "@fashion/shared";

type Garment = Pick<WardrobeRevisionView, "category" | "display"> & Partial<Pick<WardrobeRevisionView, "imageBounds" | "presentation">>;

export function getShelfDepthRatio(item: Garment): number {
  const fallback = (item.category === "shoes" ? 34 : item.category === "hat" ? 18 : 24) / 140;
  return Math.max(.08, Math.min(.5, item.presentation?.shelfDepthRatio ?? fallback));
}

export function garmentGeometry(item: Garment, large = false, naturalRatio = .72) {
  const bounds = item.imageBounds;
  const side = item.presentation?.sideDisplay?.reviewed ? item.presentation.sideDisplay : undefined;
  const ratio = bounds ? bounds.width / bounds.height : naturalRatio;
  const contentWidth = bounds ? bounds.contentWidth / bounds.width : 1;
  const contentHeight = bounds ? bounds.contentHeight / bounds.height : 1;
  const maxHeight = large ? 390 : item.category === "onepiece" || item.category === "outerwear" ? 310 : item.category === "top" ? 190 : 220;
  const width = Math.min((large ? 270 : 166) / contentWidth, maxHeight * ratio / contentHeight);
  const sideRatio = side ? side.imageBounds.width / side.imageBounds.height : 1;
  const sideContentHeight = side ? side.imageBounds.contentHeight / side.imageBounds.height : 1;
  const sideWidthRatio = contentHeight * sideRatio / (ratio * sideContentHeight);
  const sideVisibleWidthRatio = side ? sideWidthRatio * side.imageBounds.contentWidth / side.imageBounds.width / contentWidth : 1;
  const supportRatio = item.presentation?.supportWidthRatio ?? (item.display === "hanger" ? .62 : item.display === "clips" ? .76 : item.display === "hook" ? .48 : 1.04);
  // The shelf supports both confirmed views without resizing on hover. The image is never stretched.
  const hardwareRatio = contentWidth * supportRatio * (item.display === "shelf" ? Math.max(1, sideVisibleWidthRatio) * 140 / 130 : 1);
  return { ratio, contentWidth, contentHeight, width, sideRatio, sideWidthRatio, sideVisibleWidthRatio, hardwareRatio };
}

export function rackSlotWidth(item: Garment): number {
  if (item.display !== "hook" && item.display !== "shelf") return 76;
  const geometry = garmentGeometry(item);
  const image = geometry.width * geometry.contentWidth * Math.max(1, geometry.sideVisibleWidthRatio);
  const hardware = geometry.width * geometry.hardwareRatio;
  return Math.ceil(Math.max(image, hardware) + 24);
}

export function packRackItems<T extends { currentRevision: Garment }>(items: T[], availableWidth: number, maximumCount: number): T[][] {
  const pages: T[][] = [];
  let page: T[] = [];
  let used = 0;
  let hasWideItem = false;
  for (const item of items) {
    const width = rackSlotWidth(item.currentRevision);
    const wide = item.currentRevision.display === "hook" || item.currentRevision.display === "shelf";
    if (page.length && (page.length >= maximumCount || ((hasWideItem || wide) && used + width > availableWidth))) {
      pages.push(page); page = []; used = 0; hasWideItem = false;
    }
    page.push(item); used += width; hasWideItem ||= wide;
  }
  if (page.length) pages.push(page);
  return pages;
}
