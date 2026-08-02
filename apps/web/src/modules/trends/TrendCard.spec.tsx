import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { TrendCard } from "./TrendCard";
import type { TrendItem } from "./trend-types";

const trend: TrendItem = {
  category: "women",
  coverImageUrl: "https://assets.example.com/trend.webp",
  curatedAt: "2026-08-02T08:00:00.000Z",
  extracted: {
    fabricMentions: ["雪纺"],
    keyColors: ["#FDB462", "#8DD3C7"],
    keywords: ["轻盈叠穿", "流线廓形"],
    silhouettes: ["cocoon"],
  },
  id: "trend-a",
  platform: "vogue",
  publishedAt: "2026-08-01T08:00:00.000Z",
  sourceUrl: "https://www.vogue.com/article/fluid-layers",
  status: "published",
  summary: "轻盈半透明材质成为本周重点，流线型叠穿强化空气感。",
  tags: ["轻盈叠穿", "流线廓形"],
  title: "Fluid layers",
};

describe("TrendCard", () => {
  it("显眼展示 AI 整理边界、明确平台、日期与原文入口", async () => {
    let renderer: ReactTestRenderer | null = null;
    await act(() => {
      renderer = create(
        <TrendCard importing={false} onImport={vi.fn()} trend={trend} />,
      );
    });

    const mounted = renderer as ReactTestRenderer | null;
    if (!mounted) throw new Error("TrendCard test renderer 未挂载");
    const output = JSON.stringify(mounted.toJSON());
    const sourceLink = mounted.root
      .findAllByType("a")
      .find((link) => link.props.href === trend.sourceUrl);

    expect(output).toContain("AI整理，建议结合原文判断");
    expect(
      sourceLink?.children.filter((child) => typeof child === "string").join(""),
    ).toContain("查看原文 - Vogue");
    expect(output).toContain("2026年8月1日");
    expect(output).not.toContain("AI推荐");
    expect(sourceLink?.props).toMatchObject({
      rel: "noreferrer",
      target: "_blank",
    });
  });

  it("提供可访问色卡并触发存入白板", async () => {
    const onImport = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(() => {
      renderer = create(
        <TrendCard importing={false} onImport={onImport} trend={trend} />,
      );
    });

    const mounted = renderer as ReactTestRenderer | null;
    if (!mounted) throw new Error("TrendCard test renderer 未挂载");
    expect(
      mounted.root.findAll(
        (node) => node.props["aria-label"] === "色彩 #FDB462",
      ),
    ).toHaveLength(1);

    await act(() => {
      mounted.root
        .findAllByType("button")
        .find((button) => button.children.includes("存入白板"))
        ?.props.onClick();
    });
    expect(onImport).toHaveBeenCalledWith(trend);
  });
});
