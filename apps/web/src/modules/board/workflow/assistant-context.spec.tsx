// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DesignRequirementsDrawer } from "./DesignRequirementsDrawer";
import { MessageReferenceRecord } from "./MessageReferenceRecord";
import type { WorkflowConversationContext, WorkflowMessageView } from "../agent/agent-api";
import type { WorkflowGraph } from "./workflow-api";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
const graph = { nodes: [{ id: "a", title: "改名后的风衣" }], edges: [] } as unknown as WorkflowGraph;
const context = {
  currentTask: null,
  visualCoverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [] },
  revision: 1, currentObjective: "秋冬通勤", focusNodeIds: [], requirements: [{ id: "r", text: "保留立领", origin: "explicit", scope: "project", sourceQuote: "我要立领" }],
  preferences: [], state: { preferences: [
    { id: "p", text: "偏好哑光", status: "active", origin: "inferred", scope: "branch", branchNodeIds: ["a"] },
    { id: "off", text: "旧款偏好", status: "inactive", origin: "explicit" },
  ] }, scopedMemory: [{ id: "p", applicable: false, branchNodeIds: ["a"] }],
} as WorkflowConversationContext;
function drawer(onUpdate = vi.fn(async () => true), saving = false) {
  render(<DesignRequirementsDrawer context={context} error={null} graph={graph} saving={saving} onLocate={vi.fn()} onUpdate={onUpdate} onRetry={vi.fn()} onClose={vi.fn()} />);
  return onUpdate;
}
describe("requirements drawer", () => {
  it("separates unconfirmed inferences, preserves scope and folds inactive records", () => {
    drawer();
    expect(screen.getByText("保留立领").closest("section")?.textContent).toContain("明确要求");
    expect(screen.getByText("偏好哑光").closest("section")?.textContent).toContain("助手推测");
    expect(screen.getByText("偏好哑光").closest("li")?.textContent).toContain("当前讨论对象不适用");
    expect(screen.getByText("旧款偏好").closest("details")?.open).toBe(false);
    expect(screen.getByText("我要立领")).toBeTruthy();
  });
  it("keeps goal input after a failed correction and closes only after a successful retry", async () => {
    const save = drawer(vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true));
    fireEvent.click(screen.getByRole("button", { name: "更正项目目标" }));
    fireEvent.change(screen.getByRole("textbox", { name: "更正项目目标" }), { target: { value: "春季轻量风衣" } });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("textbox", { name: "更正项目目标" }) as HTMLTextAreaElement).value).toBe("春季轻量风衣");
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "更正项目目标" })).toBeNull());
    expect(save).toHaveBeenLastCalledWith({ currentObjective: "春季轻量风衣" });
  });
  it("keeps item corrections on failure and preserves original branch scope", async () => {
    const save = drawer(vi.fn(async () => false));
    fireEvent.click(screen.getByRole("button", { name: "更正这条偏好" }));
    fireEvent.change(screen.getByRole("textbox", { name: "更正内容" }), { target: { value: "仅此分支使用哑光" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ updatedItems: [{ id: "p", text: "仅此分支使用哑光", scope: "branch", confirm: true }] }));
    expect((screen.getByRole("textbox", { name: "更正内容" }) as HTMLTextAreaElement).value).toBe("仅此分支使用哑光");
  });
  it("retains confirmation and disabling operations", () => {
    const save = drawer();
    fireEvent.click(screen.getByRole("button", { name: "确认这条理解" }));
    expect(save).toHaveBeenCalledWith({ updatedItems: [{ id: "p", confirm: true }] });
    fireEvent.click(screen.getByRole("button", { name: "停用这条偏好" }));
    expect(save).toHaveBeenCalledWith({ disabledPreferenceIds: ["p"] });
  });
  it("disables modifications while read-only or saving", () => {
    drawer(undefined, true);
    for (const name of ["更正项目目标", "确认这条理解", "停用这条偏好"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
describe("reply reference records", () => {
  function record(value: WorkflowMessageView["context"]) {
    const onLocate = vi.fn();
    const view = render(<MessageReferenceRecord context={value} graph={graph} onLocate={onLocate} />);
    const details = view.container.querySelector("details");
    if (!details) throw new Error("引用记录详情未渲染");
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("查看引用记录"));
    return { details, onLocate };
  }
  it("uses historical names and disables locating deleted nodes", () => {
    const { onLocate } = record({ referenceSummary: { version: 1, explicit: [{ nodeId: "a", title: "当时的风衣" }], discussion: [{ nodeId: "gone", title: "已删除的候选" }], images: [] } });
    fireEvent.click(screen.getByRole("button", { name: "当时的风衣" }));
    expect(onLocate).toHaveBeenCalledWith("a");
    expect((screen.getByRole("button", { name: "已删除的候选" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("改名后的风衣")).toBeNull();
  });
  it("labels current fallback names and does not invent missing categories", () => {
    record({ referencedNodeIds: ["a", "gone"] });
    expect(screen.getByRole("button", { name: "改名后的风衣（当前名称）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "名称未记录" })).toBeTruthy();
    const discussion = screen.getByRole("heading", { name: "讨论对象" }).parentElement;
    if (!discussion) throw new Error("讨论对象容器未渲染");
    expect(within(discussion).getByText("未记录")).toBeTruthy();
    expect(screen.queryByText("整个项目")).toBeNull();
  });
  it.each([null, {}])("shows no saved record without filling in today's context: %s", (value) => {
    render(<MessageReferenceRecord context={value} graph={graph} onLocate={vi.fn()} />);
    expect(screen.getByText("这条回复未保存引用记录")).toBeTruthy();
    expect(screen.queryByText("查看引用记录")).toBeNull();
    expect(screen.queryByText("改名后的风衣")).toBeNull();
  });
  it("distinguishes a recorded empty turn and collapses image failure details", () => {
    const { details } = record({ referencedNodeIds: [], focusNodeIds: [], visualCoverage: { total: 2, ready: 0, pending: 1, failed: 1, attachedNodeIds: [] } });
    expect(screen.getByText("整个项目")).toBeTruthy();
    expect(screen.getByText("本轮没有传入图片")).toBeTruthy();
    expect(details.querySelector("details")?.open).toBe(false);
    expect(details.textContent).toContain("读取失败 1 张");
    expect(details.textContent).not.toContain("已理解");
  });
});
