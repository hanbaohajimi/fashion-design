// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTrendBrief, TrendBriefPanel } from "./TrendBriefPanel";
import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
import type { TrendItem } from "../trends/trend-types";
vi.mock("../board/workflow/workflow-api", () => ({
  fetchWorkflow: vi.fn(),
  patchWorkflow: vi.fn(),
}));
const article: TrendItem = {
  id: "trend-1",
  title: "自然肌理的春夏探索",
  summary: "来源摘要",
  sourceUrl: "https://vogue.com/article/example",
  publishedAt: null,
  curatedAt: "2026-10-21T02:00:00Z",
  category: "unclassified",
  platform: "vogue.com",
  coverImageUrl: null,
  status: "curated",
  tags: ["肌理"],
  extracted: null,
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [article] }), { status: 200 }),
      ),
  );
  vi.mocked(fetchWorkflow).mockResolvedValue({
    projectId: "project-1",
    revision: 7,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  });
  vi.mocked(patchWorkflow).mockResolvedValue({
    projectId: "project-1",
    revision: 8,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("preserves source URLs and unknown dates without claiming popularity", () => {
  const text = buildTrendBrief(
    "通勤衬衫",
    [article],
    "尝试宽松短袖",
    undefined,
  );
  expect(text).toContain(article.sourceUrl);
  expect(text).toContain("发布日期：未知");
  expect(text).toContain("2026-10-21T02:00:00Z");
  expect(text).toContain("没有销量、增长率或未来热度证据");
  expect(text).toContain("设计师提出的探索方向");
});
it("keeps the exact workflow patch when a saved response is lost", async () => {
  vi.mocked(patchWorkflow).mockRejectedValueOnce(new Error("响应丢失"));
  const onDirty = vi.fn();
  render(
    <TrendBriefPanel projectId="project-1" brands={[]} onDirty={onDirty} />,
  );
  await screen.findByText(article.title);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("设计任务"), {
    target: { value: "开发通勤衬衫" },
  });
  fireEvent.click(screen.getByRole("button", { name: "存入工作流" }));
  await screen.findByText("响应丢失");
  fireEvent.click(screen.getByRole("button", { name: "存入工作流" }));
  await screen.findByText(/任务简报已保存到画布/);
  expect(fetchWorkflow).toHaveBeenCalledTimes(1);
  expect(patchWorkflow).toHaveBeenCalledTimes(2);
  expect(vi.mocked(patchWorkflow).mock.calls[0]).toEqual(
    vi.mocked(patchWorkflow).mock.calls[1],
  );
  const packet = vi.mocked(patchWorkflow).mock.calls[0]?.[1];
  expect(packet).toMatchObject({
    baseRevision: 7,
    operations: [
      {
        type: "add_node",
        node: {
          type: "reference_text",
          payload: {
            sources: [
              {
                trendItemId: "trend-1",
                sourceUrl: article.sourceUrl,
                publishedAt: null,
              },
            ],
          },
        },
      },
    ],
  });
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
});
it("hides workflow writes for viewers", async () => {
  render(<TrendBriefPanel projectId="project-1" brands={[]} canEdit={false} />);
  await screen.findByText(article.title);
  expect(screen.queryByRole("button", { name: "存入工作流" })).toBeNull();
  expect((screen.getByLabelText("设计任务") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(patchWorkflow).not.toHaveBeenCalled();
});
