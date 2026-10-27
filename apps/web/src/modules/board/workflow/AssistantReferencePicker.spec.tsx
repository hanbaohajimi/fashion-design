// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AssistantReferencePicker } from "./AssistantReferencePicker";
import type { WorkflowGraph } from "./workflow-api";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
const graph = {
  nodes: Array.from({ length: 18 }, (_, index) => ({
    id: `candidate-${index}`,
    type: "candidate",
    kind: "asset",
    title: index < 2 ? "同名风衣" : `方案 ${index}`,
    payload: {},
  })),
  edges: [],
} as unknown as WorkflowGraph;
function picker(ids: readonly string[] = []) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const onAddMaterial = vi.fn();
  render(
    <AssistantReferencePicker
      graph={graph}
      selectedIds={ids}
      onApply={onApply}
      onClose={onClose}
      onAddMaterial={onAddMaterial}
    />,
  );
  return { onApply, onClose, onAddMaterial };
}

it("区分同名对象，搜索不会丢失已选引用，确认前不提交", () => {
  const { onApply } = picker();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "同名风衣 服装方案 candidate-1" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "搜索项目对象" }), {
    target: { value: "方案 3" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "方案 3 服装方案" }));
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用所选引用" }));
  expect(onApply).toHaveBeenCalledWith(["candidate-1", "candidate-3"]);
});

it("16 项时说明上限，取消选择后允许添加", () => {
  const { onApply } = picker(graph.nodes.slice(0, 16).map((node) => node.id));
  const next = screen.getByRole("checkbox", {
    name: "方案 17 服装方案",
  }) as HTMLInputElement;
  expect(next.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "请先取消一项再添加",
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "方案 2 服装方案" }));
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  fireEvent.click(screen.getByRole("button", { name: "使用所选引用" }));
  const ids = onApply.mock.calls[0]?.[0] as string[];
  expect(ids).toHaveLength(16);
  expect(ids).toContain("candidate-17");
  expect(ids).not.toContain("candidate-2");
});

it("取消不改变引用，去添加素材有明确回调", () => {
  const { onApply, onClose, onAddMaterial } = picker();
  fireEvent.click(screen.getByRole("checkbox", { name: "方案 2 服装方案" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "去添加素材" }));
  expect(onAddMaterial).toHaveBeenCalledOnce();
});

it("过滤已删除对象，不将失效 id 发送给助手", () => {
  const { onApply } = picker(["deleted", "candidate-0"]);
  fireEvent.click(screen.getByRole("button", { name: "使用所选引用" }));
  expect(onApply).toHaveBeenCalledWith(["candidate-0"]);
});
