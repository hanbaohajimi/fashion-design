import chroma from "chroma-js";
import { describe, expect, it } from "vitest";
import {
  colorForeground,
  explorePalette,
  fitPaletteColor,
  paletteWarnings,
  type PaletteStrategy,
} from "./color-exploration";

const existing = [
  { hex: "#40536D", name: "雾蓝" },
  { hex: "#E6D8C6", name: "暖象牙" },
] as const;

describe("配色探索", () => {
  it("生成确定性的追加建议，不修改原色或重复基准色", () => {
    const before = structuredClone(existing);
    const input = {
      baseHex: "#40536D",
      existing,
      strategy: "tonal" as const,
      count: 3,
    };
    const first = explorePalette(input);
    expect(explorePalette(input)).toEqual(first);
    expect(existing).toEqual(before);
    expect(first.suggestions).toHaveLength(3);
    const hexes = [...existing, ...first.suggestions].map((color) =>
      color.hex.toLowerCase(),
    );
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it.each(["tonal", "analogous", "complementary"] as PaletteStrategy[])(
    "%s 产生有效 sRGB 颜色并保持预期色相关系",
    (strategy) => {
      const baseHex = "#597a65";
      const result = explorePalette({
        baseHex,
        existing: [{ hex: baseHex, name: "绿" }],
        strategy,
        count: 3,
      });
      const baseHue = chroma(baseHex).oklch()[2];
      const targetOffset =
        strategy === "tonal" ? 0 : strategy === "analogous" ? 30 : 180;
      const firstHue = chroma(result.suggestions[0]?.hex ?? "").oklch()[2];
      const difference =
        ((firstHue - baseHue - targetOffset + 540) % 360) - 180;
      expect(Math.abs(difference)).toBeLessThan(3);
      for (const color of result.suggestions) {
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(
          chroma(color.hex)
            .rgb()
            .every((channel) => channel >= 0 && channel <= 255),
        ).toBe(true);
      }
    },
  );

  it.each(["#000000", "#ffffff", "#808080"])(
    "无彩色 %s 用明度梯度，不引入色相",
    (baseHex) => {
      const result = explorePalette({
        baseHex,
        existing: [{ hex: baseHex, name: "中性色" }],
        strategy: "complementary",
        count: 5,
      });
      expect(result.suggestions).toHaveLength(5);
      result.suggestions.forEach(({ hex }) => {
        const [r, g, b] = chroma(hex).rgb();
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
      });
    },
  );

  it("高饱和候选通过降低色度映射入色域，尽量保留明度和色相", () => {
    expect(chroma.oklch(0.7, 0.4, 35).clipped()).toBe(true);
    const mapped = chroma(fitPaletteColor(0.7, 0.4, 35)).oklch();
    expect(mapped[0]).toBeCloseTo(0.7, 2);
    expect(mapped[1]).toBeLessThan(0.4);
    expect(Math.abs(mapped[2] - 35)).toBeLessThan(1);
    const result = explorePalette({
      baseHex: "#ff0000",
      existing: [],
      strategy: "analogous",
      count: 5,
    });
    expect(result.suggestions).toHaveLength(5);
  });

  it("限制追加数量和总容量，并拒绝无效色号", () => {
    const eleven = Array.from({ length: 11 }, () => existing[0]);
    const result = explorePalette({
      baseHex: "#40536D",
      existing: eleven,
      strategy: "tonal",
      count: 5,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.message).toContain("12 色上限");
    expect(
      explorePalette({
        baseHex: "#40536D",
        existing: [...eleven, existing[0]],
        strategy: "tonal",
        count: 3,
      }).suggestions,
    ).toEqual([]);
    expect(
      explorePalette({ baseHex: "bad", existing, strategy: "tonal", count: 3 })
        .message,
    ).toContain("无效色号");
    expect(
      explorePalette({
        baseHex: "#40536D",
        existing,
        strategy: "tonal",
        count: 100,
      }).suggestions.length,
    ).toBeLessThanOrEqual(5);
  });

  it("候选不足时说明原因，重复颜色按大小写无关方式排除", () => {
    const input = { baseHex: "#808080", strategy: "tonal" as const, count: 5 };
    const first = explorePalette({ ...input, existing: [] }).suggestions;
    const second = explorePalette({ ...input, existing: first }).suggestions;
    const all = [...first, ...second].map((color) => ({
      ...color,
      hex: color.hex.toUpperCase(),
    }));
    const final = explorePalette({ ...input, existing: all });
    expect(final.suggestions).toEqual([]);
    expect(final.message).toContain("去除重复");
  });

  it("只提示 ΔE 小于 5 的色对，重复原色不被删除", () => {
    const colors = [
      { hex: "#808080", name: "灰" },
      { hex: "#818181", name: "近灰" },
      { hex: "#ffffff", name: "白" },
    ];
    expect(paletteWarnings(colors)).toEqual([
      { left: 0, right: 1, deltaE: expect.any(Number) },
    ]);
    expect(paletteWarnings(colors)[0]?.deltaE).toBeLessThan(5);
    expect(colors).toHaveLength(3);
  });

  it.each(["#000000", "#ffffff", "#40536d", "#ff0000", "#808080"])(
    "%s 的文字前景具有足够对比度",
    (hex) => {
      expect(chroma.contrast(hex, colorForeground(hex))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});
