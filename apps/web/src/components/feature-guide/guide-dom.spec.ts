// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasGuideBlocker } from "./guide-dom";

beforeEach(() => {
  const box = new DOMRect(10, 10, 400, 600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([box] as unknown as DOMRectList);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("功能指引的弹窗阻塞", () => {
  it("允许助手的非模态展示容器与指引共存", () => {
    document.body.innerHTML = '<dialog open role="presentation" data-floating="true"><aside>设计助手</aside></dialog>';
    expect(hasGuideBlocker()).toBe(false);
  });

  it.each([
    '<dialog open>保存确认</dialog>',
    '<section role="dialog" aria-modal="true">业务弹窗</section>',
    '<div data-popup-kind="sheet">选择面板</div>',
  ])("业务弹窗仍阻止指引抢焦点：%s", html => {
    document.body.innerHTML = html;
    expect(hasGuideBlocker()).toBe(true);
  });

  it("已隐藏的业务弹窗和指引自己的容器不阻塞", () => {
    document.body.innerHTML = '<dialog open hidden>已关闭</dialog><div data-feature-guide><dialog open>功能指引</dialog></div>';
    expect(hasGuideBlocker()).toBe(false);
  });
});
