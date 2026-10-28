import { describe, expect, it } from "vitest";
import {
  guideVisibleRect,
  placeGuideCard,
  type GuideRect,
  type GuideViewport,
} from "./guide-layout";

const desktop: GuideViewport = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  mobile: false,
};
const card = { width: 320, height: 200 };

function expectInside(rect: GuideRect, viewport: GuideViewport) {
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(viewport.x);
  expect(rect.y).toBeGreaterThanOrEqual(viewport.y);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.y + viewport.height);
}

function expectNotCovering(a: GuideRect, b: GuideRect) {
  expect(
    a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y,
  ).toBe(true);
}

describe("功能指引卡片定位", () => {
  it("桌面目标左右靠边时选择可用侧边，不遮挡目标", () => {
    for (const target of [
      { x: 16, y: 160, width: 150, height: 44 },
      { x: 1274, y: 160, width: 150, height: 44 },
    ]) {
      const result = placeGuideCard(target, card, desktop);
      expectInside(result, desktop);
      expectNotCovering(result, target);
    }
  });

  it("宽操作条靠近视口底部时把说明放在上方", () => {
    const target = { x: 32, y: 800, width: 1376, height: 64 };
    const result = placeGuideCard(target, card, desktop);

    expectInside(result, desktop);
    expect(result.y + result.height).toBeLessThanOrEqual(target.y);
  });

  it.each([320, 390])("在 %dpx 手机上避开顶部和底部目标", (width) => {
    const viewport: GuideViewport = {
      x: 0,
      y: 0,
      width,
      height: 720,
      mobile: true,
    };
    for (const target of [
      { x: 20, y: 24, width: width - 40, height: 44 },
      { x: 20, y: 652, width: width - 40, height: 44 },
    ]) {
      const result = placeGuideCard(target, card, viewport);
      expectInside(result, viewport);
      expectNotCovering(result, target);
    }
  });

  it("视口缩小并带 visualViewport 偏移时，卡片仍保留可见边界", () => {
    const viewport: GuideViewport = {
      x: 20,
      y: 310,
      width: 320,
      height: 180,
      mobile: true,
    };
    const result = placeGuideCard(
      { x: 35, y: 330, width: 275, height: 44 },
      { width: 400, height: 300 },
      viewport,
    );

    expectInside(result, viewport);
    expect(result.width).toBeLessThan(320);
    expect(result.height).toBeLessThan(180);
  });
});

describe("高亮区域的可见边界", () => {
  it("短屏优先缩短说明卡，给屏幕中央的功能留出完整位置", () => {
    const viewport = { x: 0, y: 0, width: 320, height: 480, mobile: true };
    const target = { x: 20, y: 154, width: 280, height: 44 };
    const card = placeGuideCard(target, { width: 288, height: 280 }, viewport);
    expectInside(card, viewport);
    expect(card.y).toBeGreaterThanOrEqual(target.y + target.height + 16);
    expect(card.height).toBeLessThan(280);
  });

  it("对超出屏幕四边的目标裁剪高亮，不绘制到可见视口之外", () => {
    for (const target of [
      { x: -30, y: -20, width: 160, height: 80 },
      { x: 1380, y: 860, width: 160, height: 80 },
      { x: -30, y: -20, width: 1500, height: 940 },
    ]) {
      expectInside(guideVisibleRect(target, desktop), desktop);
    }
  });

  it("使用手机缩放或键盘打开后的实际视口偏移裁剪", () => {
    const viewport: GuideViewport = {
      x: 20,
      y: 300,
      width: 320,
      height: 240,
      mobile: true,
    };
    const target = { x: 10, y: 280, width: 360, height: 300 };

    expectInside(guideVisibleRect(target, viewport), viewport);
  });

  it("完全移出屏幕的目标不留下有效高亮区域", () => {
    const visible = guideVisibleRect(
      { x: 1600, y: 1100, width: 100, height: 44 },
      desktop,
    );

    expect(visible.width).toBe(0);
    expect(visible.height).toBe(0);
  });
});
