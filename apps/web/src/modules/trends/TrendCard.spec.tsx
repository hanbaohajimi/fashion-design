/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(cleanup);

describe("TrendCard", () => {
  it("显眼展示分析整理边界、明确平台、日期与原文入口", () => {
    render(<TrendCard importing={false} onImport={vi.fn()} trend={trend} />);

    const sourceLink = screen.getByRole("link", {
      name: "查看原文 - Vogue",
    });
    expect(screen.getByText("AI整理，建议结合原文判断")).toBeTruthy();
    expect(screen.getByText("2026年8月1日")).toBeTruthy();
    expect(document.body.textContent).not.toContain("AI推荐");
    expect(sourceLink.getAttribute("href")).toBe(trend.sourceUrl);
    expect(sourceLink.getAttribute("rel")).toBe("noreferrer");
    expect(sourceLink.getAttribute("target")).toBe("_blank");
  });

  it("提供可访问色卡并触发存入白板", () => {
    const onImport = vi.fn();
    render(<TrendCard importing={false} onImport={onImport} trend={trend} />);

    expect(screen.getByLabelText("色彩 #FDB462")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "存入白板" }));
    expect(onImport).toHaveBeenCalledWith(trend);
  });
});
