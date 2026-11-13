// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildResearchMoodboardOperations, buildTrendBrief, researchDateSummary, TrendBriefPanel } from "./TrendBriefPanel";
import { fetchWorkflow } from "../board/workflow/workflow-api";
import { importCanvasMaterials as patchWorkflow } from "../board/workflow/import-canvas-materials";
import { createAgentConversation } from "../board/agent/agent-api";
vi.mock("../board/workflow/import-canvas-materials", () => ({ importCanvasMaterials: vi.fn() }));
vi.mock("../board/agent/agent-api", () => ({ createAgentConversation: vi.fn() }));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import type { TrendItem } from "../trends/trend-types";
vi.mock("../board/workflow/workflow-api", () => ({
  fetchWorkflow: vi.fn(),
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
  vi.mocked(patchWorkflow).mockResolvedValue(undefined);
  vi.mocked(createAgentConversation).mockResolvedValue({ id: "research-chat" } as never);
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
it("marks a wide publication span as a time-window conflict", () => {
  expect(researchDateSummary([
    { ...article, publishedAt: "2025-01-01T00:00:00.000Z" },
    { ...article, id: "trend-2", publishedAt: "2026-11-01T00:00:00.000Z" },
  ])).toContain("不要直接合并为同一时点趋势");
});
it("把研究来源、封面图和结构化色彩保存在同一份 moodboard 工作流中", () => {
  const operations = buildResearchMoodboardOperations(
    "通勤衬衫",
    [{
      ...article,
      coverImageUrl: "https://cdn.example.com/cover.jpg",
      extracted: {
        fabricMentions: ["亚麻"],
        keyColors: ["#234567"],
        keywords: ["肌理"],
        silhouettes: ["宽松"],
      },
    }],
    "尝试宽松短袖",
    undefined,
  );
  expect(operations.map((operation) => operation.type)).toEqual([
    "add_node",
    "add_node",
    "add_node",
  ]);
  expect(operations).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "add_node", node: expect.objectContaining({ type: "reference_text" }) }),
    expect.objectContaining({ type: "add_node", node: expect.objectContaining({ type: "reference_image", payload: expect.objectContaining({ imageUrl: "https://cdn.example.com/cover.jpg", sourceUrl: article.sourceUrl }) }) }),
    expect.objectContaining({ type: "add_node", node: expect.objectContaining({ type: "swatch", payload: expect.objectContaining({ color: "#234567" }) }) }),
  ]));
});
it("在研究分析中展示可回到原文的来源级依据", async () => {
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({
        colors: [],
        evidence: [{ sourceId: article.id, claims: ["来源提到自然肌理与轻薄结构"] }],
        fabrics: ["轻薄面料"],
        hypotheses: [],
        keywords: ["肌理"],
        mode: "EXTRACTED",
        silhouettes: [],
        summary: "来源级结构化分析",
        unknowns: ["真实物性仍需核对"],
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ items: [article] }), { status: 200 }));
  }));
  render(<TrendBriefPanel projectId="project-1" brands={[]} />);
  await screen.findByText(article.title);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("设计任务"), { target: { value: "开发通勤衬衫" } });
  fireEvent.click(screen.getByRole("button", { name: "整理研究分析" }));
  await screen.findByText("来源级结构化分析");
  expect(screen.getByText("来源提到自然肌理与轻薄结构")).toBeTruthy();
  expect(within(screen.getByLabelText("结构化研究分析")).getByRole("link", { name: "查看原文" })).toHaveProperty("href", article.sourceUrl);
});
it("保存同一研究版本后阻止重复创建一组 moodboard 节点", async () => {
  render(<TrendBriefPanel projectId="project-1" brands={[]} />);
  await screen.findByText(article.title);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("设计任务"), { target: { value: "开发通勤衬衫" } });
  fireEvent.click(screen.getByRole("button", { name: "存入工作流" }));
  await screen.findByText(/任务简报已保存到画布/);
  expect(patchWorkflow).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "研究报告已保存" })).toHaveProperty("disabled", true);
  expect(vi.mocked(patchWorkflow)).toHaveBeenCalledTimes(1);
});
it("把研究报告、moodboard 和色卡一起带入设计助手", async () => {
  const richArticle = {
    ...article,
    coverImageUrl: "https://cdn.example.com/research.jpg",
    extracted: {
      fabricMentions: ["技术尼龙"],
      keyColors: ["#123456"],
      keywords: ["通勤"],
      silhouettes: ["宽松"],
    },
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [richArticle] }), { status: 200 })));
  render(<TrendBriefPanel projectId="project-1" brands={[]} />);
  await screen.findByText(richArticle.title);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("设计任务"), { target: { value: "开发通勤衬衫" } });
  fireEvent.click(screen.getByRole("button", { name: "存入工作流" }));
  await screen.findByText(/任务简报已保存到画布/);
  fireEvent.click(screen.getByRole("button", { name: "继续到设计助手" }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(push.mock.calls[0]?.[0]).toContain("referenceNodeIds=");
  expect(push.mock.calls[0]?.[0]).not.toContain("referenceNodeId=");
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

it("把已保存的趋势简报交给设计助手，但不自动发送或生成", async () => {
  render(<TrendBriefPanel projectId="project-1" brands={[]} />);
  await screen.findByText(article.title);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("设计任务"), {
    target: { value: "开发通勤衬衫" },
  });
  fireEvent.click(screen.getByRole("button", { name: "存入工作流" }));
  await screen.findByText(/任务简报已保存到画布/);
  fireEvent.click(screen.getByRole("button", { name: "继续到设计助手" }));
  fireEvent.click(screen.getByRole("button", { name: "继续到设计助手" }));
  await waitFor(() =>
    expect(createAgentConversation).toHaveBeenCalledWith("project-1", {
      mode: "workflow",
    }),
  );
  const operation = vi.mocked(patchWorkflow).mock.calls[0]?.[1].operations[0];
  const briefNodeId = operation?.type === "add_node" ? operation.node.id : undefined;
  expect(briefNodeId).toBeTruthy();
  expect(push).toHaveBeenCalledWith(
    `/project-1?conversationId=research-chat&starter=research&referenceNodeId=${briefNodeId}`,
  );
  expect(createAgentConversation).toHaveBeenCalledTimes(1);
  expect(patchWorkflow).toHaveBeenCalledTimes(1);
});
