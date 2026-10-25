// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceDraftProvider,
  WorkspaceDraftStore,
  useWorkspaceDraft,
} from "./workspace-drafts";
import { nodeSize } from "./workflow-graph";

afterEach(cleanup);

function Editor({ value, dirty }: { value: string; dirty: boolean }) {
  useWorkspaceDraft("tool", { prompt: value }, dirty);
  return null;
}

describe("画布工作区草稿", () => {
  it("登记修改、保留基准版本，在后台更新后阻止静默覆盖", () => {
    const store = new WorkspaceDraftStore();
    const view = (baseline: string, value: string, dirty: boolean) => (
      <WorkspaceDraftProvider
        store={store}
        owner="project:tool"
        baseline={baseline}
      >
        <Editor value={value} dirty={dirty} />
      </WorkspaceDraftProvider>
    );
    const { rerender } = render(view("v1", "原始内容", false));
    rerender(view("v1", "我的草稿", true));
    expect(store.hasDirty()).toBe(true);
    rerender(view("v2", "我的草稿", true));
    expect(store.get("project:tool:tool")).toMatchObject({
      value: { prompt: "我的草稿" },
      baseline: "v1",
      conflict: true,
    });
    rerender(view("v2", "最新内容", false));
    expect(store.hasDirty()).toBe(false);
    expect(store.ownerConflict("project:tool")).toBe(false);
  });

  it("不同节点和编辑模式独立保存；删除一个节点不清除其他草稿", () => {
    const store = new WorkspaceDraftStore();
    const add = (owner: string, mode: string) =>
      store.update(`${owner}:${mode}`, {
        owner,
        value: mode,
        baseline: "v1",
        dirty: true,
        conflict: false,
        locked: mode === "inpaint",
      });
    act(() => {
      add("a", "inpaint");
      add("a", "variation");
      add("b", "tool");
    });
    expect(store.ownerLocked("a")).toBe(true);
    store.removeOwner("a");
    expect(store.ownerDirty("a")).toBe(false);
    expect(store.ownerDirty("b")).toBe(true);
    store.clear();
    expect(store.hasDirty()).toBe(false);
  });

  it("工具宽度跟随显示名称，长标题有上限，素材尺寸独立", () => {
    expect(nodeSize({ kind: "tool", type: "generate_design" })).toEqual({
      w: 112,
      h: 44,
    });
    expect(nodeSize({ kind: "tool", type: "analyze_brief" })).toEqual({
      w: 112,
      h: 44,
    });
    expect(nodeSize({ kind: "tool", type: "generate_design", title: "方案生成" }).w).toBe(96);
    expect(nodeSize({ kind: "tool", type: "generate_design", title: "方案生成 1" }).w).toBe(104);
    expect(nodeSize({ kind: "tool", type: "generate_design", title: "超长工具名称".repeat(10) }).w).toBe(224);
    expect(nodeSize({ kind: "tool", type: "generate_design", title: "a".repeat(32) }).w).toBe(112);
    expect(nodeSize({ kind: "asset", type: "brief" }).h).toBeGreaterThan(44);
  });
});
