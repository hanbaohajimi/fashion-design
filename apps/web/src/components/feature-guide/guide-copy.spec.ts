// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGuideSteps } from "./guide-dom";

beforeEach(() => {
  const rect = new DOMRect(20, 20, 300, 80);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    0: rect,
    length: 1,
    item: () => rect,
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function anchor(name: string, metadata: Record<string, string> = {}): HTMLElement {
  const target = document.createElement("div");
  target.dataset.guide = name;
  Object.assign(target.dataset, metadata);
  document.body.append(target);
  return target;
}

describe("设计助手导览与当前入口一致", () => {
  it.each([
    ["collapsed", "点击“设计助手”展开对话区"],
    ["mobile", "切换到“助手”视图"],
    ["input", "生成前再请你确认"],
    ["history", "顶部“新建对话”"],
    ["paused", "“助手设置”中选择“恢复设计助手”"],
  ])("在 %s 状态说明当前可用操作", (variant, action) => {
    anchor("workspace-assistant", { guideVariant: variant });

    expect(resolveGuideSteps("workspace")[0]).toMatchObject({
      title: "和设计助手讨论想法",
      description: expect.stringContaining(action),
    });
  });

  it("同一对话区切换为历史或暂停后，不继续介绍输入设计需求", () => {
    const target = anchor("workspace-assistant", { guideVariant: "input" });
    expect(resolveGuideSteps("workspace")[0]?.description).toContain("在这里描述设计想法");

    target.dataset.guideVariant = "history";
    const history = resolveGuideSteps("workspace")[0]?.description;
    expect(history).toContain("只读历史");
    expect(history).not.toContain("在这里描述设计想法");

    target.dataset.guideVariant = "paused";
    const paused = resolveGuideSteps("workspace")[0]?.description;
    expect(paused).toContain("恢复设计助手");
    expect(paused).not.toContain("新建对话");
  });
});

describe("款式资料导览只介绍实际提供的能力", () => {
  it("没有切换器和修订标记的功能只介绍名称与说明", () => {
    const target = anchor("studio-object", { guideTitle: "色料与改款实验" });
    target.textContent = "切换资料、修订是其他功能的说明";

    const step = resolveGuideSteps("studio")[0];
    expect(step?.title).toBe("当前功能：色料与改款实验");
    expect(step?.description).toContain("名称与说明");
    expect(step?.description).not.toContain("切换");
    expect(step?.description).not.toContain("修订");
  });

  it("进入已保存资料后补充修订说明，移除切换器后不再介绍切换", () => {
    const target = anchor("studio-object", { guideTitle: "技术包", guideSwitcher: "true" });
    const draft = resolveGuideSteps("studio")[0]?.description;
    expect(draft).toContain("切换要查看的资料");
    expect(draft).not.toContain("修订");

    target.dataset.guideRevision = "true";
    expect(resolveGuideSteps("studio")[0]?.description).toContain("修订号对应一次已保存的版本");

    target.dataset.guideSwitcher = "false";
    const saved = resolveGuideSteps("studio")[0]?.description;
    expect(saved).not.toContain("切换");
    expect(saved).toContain("修订号");
  });
});

describe("面料导览", () => {
  it("指向规格筛选入口，并在没有项目加入入口时省略加入一步", () => {
    anchor("fabrics-filters");
    anchor("fabrics-preview");

    const steps = resolveGuideSteps("fabrics");
    expect(steps.map(step => step.id)).toEqual(["filters", "preview"]);
    expect(steps[0]?.description).toContain("展开规格筛选");
    expect(steps[0]?.description).toContain("搜索框还可查");
  });
});
