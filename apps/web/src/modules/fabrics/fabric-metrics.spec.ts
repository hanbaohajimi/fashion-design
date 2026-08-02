import { describe, expect, it } from "vitest";

import { getFabricMetrics } from "./fabric-types";

describe("getFabricMetrics", () => {
  it("把垂坠与弹力翻译成中文标签和刻度位置", () => {
    expect(
      getFabricMetrics({
        composition: { silk: 92, spandex: 8 },
        drape: "fluid",
        stretch: "slight",
      }),
    ).toEqual([
      { label: "流动", level: 3, name: "垂坠" },
      { label: "微弹", level: 2, name: "弹力" },
    ]);
  });

  it("最低档仍占一格，避免读成缺失数据", () => {
    expect(
      getFabricMetrics({ drape: "stiff", stretch: "none" }).map(
        (metric) => metric.level,
      ),
    ).toEqual([1, 1]);
  });

  it("省略未标注的属性，卡片不会渲染空刻度", () => {
    expect(getFabricMetrics({ drape: "moderate" })).toEqual([
      { label: "适中", level: 2, name: "垂坠" },
    ]);
    expect(getFabricMetrics({ weight: 120 })).toEqual([]);
  });

  it("忽略枚举之外的取值", () => {
    expect(getFabricMetrics({ drape: "very-fluid", stretch: 3 })).toEqual([]);
  });
});
