// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowExecutionResult } from "@fashion/shared";
import { AssistantResultGallery } from "./AssistantResultGallery";
import type { WorkflowGraph } from "./workflow-api";
afterEach(cleanup);
const result: WorkflowExecutionResult = {
  version: 1,
  executionId: "batch",
  toolNodeId: "tool",
  status: "partial_failed",
  completedAt: "2026-11-10T08:00:00Z",
  attempts: { completed: 2, failed: 1, canceled: 0 },
  images: [
    {
      assetId: "a",
      nodeId: "node-a",
      title: "外套 A",
      width: 600,
      height: 800,
    },
    {
      assetId: "b",
      nodeId: "node-b",
      title: "外套 B",
      width: 1200,
      height: 400,
    },
  ],
};
const graph = {
  nodes: result.images.map((image) => ({
    id: image.nodeId,
    kind: "asset",
    type: "candidate",
    payload: { assetId: image.assetId },
  })),
} as unknown as WorkflowGraph;
it("真实部分结果展示缩略图，查看比较和继续分别调用正确身份", () => {
  const onOpen = vi.fn(),
    onContinue = vi.fn(),
    onCompare = vi.fn();
  render(
    <AssistantResultGallery
      result={result}
      graph={graph}
      disabled={false}
      onOpen={onOpen}
      onContinue={onContinue}
      onCompare={onCompare}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getByText("1 项操作未完成")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看大图：外套 B" }));
  expect(onOpen).toHaveBeenCalledWith(result.images[1]);
  fireEvent.click(screen.getByRole("button", { name: "继续修改：外套 A" }));
  expect(onContinue).toHaveBeenCalledWith(result.images[0]);
  fireEvent.click(screen.getByRole("button", { name: "比较本次结果" }));
  expect(onCompare).toHaveBeenCalledWith(result.images);
});
it("失效缩略图可以重试，节点被替换时仍保留预览但不引用错误图片", () => {
  const changed = {
    nodes: [
      {
        id: "node-a",
        kind: "asset",
        type: "candidate",
        payload: { assetId: "replacement" },
      },
    ],
  } as unknown as WorkflowGraph;
  render(
    <AssistantResultGallery
      result={{ ...result, images: result.images.slice(0, 1) }}
      graph={changed}
      disabled
      onOpen={vi.fn()}
      onContinue={vi.fn()}
      onCompare={vi.fn()}
    />,
  );
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("缩略图暂不可用")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试缩略图：外套 A" }));
  expect(screen.getByRole("img")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "继续修改：外套 A" })).toBeNull();
  expect(screen.getByRole("button", { name: "查看大图：外套 A" })).toBeTruthy();
});
it("没有真实图片时不渲染结果画廊，已有任务期间只限制继续修改", () => {
  const view = render(
    <AssistantResultGallery
      result={{ ...result, images: [] }}
      graph={graph}
      disabled
      onOpen={vi.fn()}
      onContinue={vi.fn()}
      onCompare={vi.fn()}
    />,
  );
  expect(screen.queryByRole("region", { name: "本次图片结果" })).toBeNull();
  view.rerender(
    <AssistantResultGallery
      result={result}
      graph={graph}
      disabled
      onOpen={vi.fn()}
      onContinue={vi.fn()}
      onCompare={vi.fn()}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "继续修改：外套 A",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "查看大图：外套 A",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
