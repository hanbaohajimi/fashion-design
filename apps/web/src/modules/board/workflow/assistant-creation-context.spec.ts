import { expect, it, vi } from "vitest";
import {
  emptyCanvasCreationDraft,
  type CanvasCreation,
  type CanvasCreationDraft,
} from "@fashion/shared";
import {
  mergeAssistantConnectionDraft,
  syncAssistantCreationDraft,
} from "./assistant-creation-context";

it("助手连接回填合并后续文字与引用，重复回执不重复添加，移除仅作用于指定引用", () => {
  const base = {
    ...emptyCanvasCreationDraft(),
    prompt: "初始要求",
    inputs: [{ id: "first", nodeId: "a" }],
    basedOnInputId: "first",
  };
  const saved = {
    ...base,
    inputs: [...base.inputs, { id: "assistant", creationId: "upstream" }],
  };
  const local = {
    ...base,
    prompt: "请求期间的新文字",
    inputs: [...base.inputs, { id: "later", nodeId: "b" }],
  };
  const merged = mergeAssistantConnectionDraft(local, base, saved);
  expect(merged).toMatchObject({
    prompt: local.prompt,
    inputs: [{ id: "first" }, { id: "later" }, { id: "assistant" }],
  });
  expect(mergeAssistantConnectionDraft(merged, base, saved)).toEqual(merged);
  expect(
    mergeAssistantConnectionDraft(base, base, {
      ...saved,
      prompt: "服务端后续要求",
    }).prompt,
  ).toBe("服务端后续要求");
  const disconnected = mergeAssistantConnectionDraft(merged, saved, {
    ...saved,
    inputs: [],
    basedOnInputId: null,
  });
  expect(disconnected.inputs).toEqual([{ id: "later", nodeId: "b" }]);
  expect(disconnected.basedOnInputId).toBeNull();
  expect(disconnected.prompt).toBe(local.prompt);
});

it("连接回填超过16项时拒绝截断，本机原文和引用不被修改", () => {
  const base = emptyCanvasCreationDraft();
  const local = {
    ...base,
    prompt: "原文",
    inputs: Array.from({ length: 16 }, (_, i) => ({
      id: `local-${i}`,
      nodeId: `source-${i}`,
    })),
  };
  expect(() =>
    mergeAssistantConnectionDraft(local, base, {
      ...base,
      inputs: [{ id: "new", nodeId: "new-source" }],
    }),
  ).toThrow("超过16项");
  expect(local.inputs).toHaveLength(16);
  expect(local.prompt).toBe("原文");
});

const target: CanvasCreation = {
  id: "target",
  projectId: "project",
  title: "风衣",
  module: "image",
  revision: 3,
  draft: { ...emptyCanvasCreationDraft(), prompt: "旧要求" },
  position: null,
  currentResult: null,
  currentResultNodeId: null,
  runs: [],
  resource: null,
  removed: false,
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
};
function setup() {
  const draft = {
    ...target.draft,
    prompt: "最新要求",
    inputs: [{ id: "input-2", nodeId: "reference-2" }],
  };
  return {
    target,
    draft,
    revision: 3,
    canEdit: true,
    assertCurrent: vi.fn(),
    flush: vi.fn(async () => {}),
    save: vi.fn(
      async (value: CanvasCreationDraft): Promise<CanvasCreation> => ({
        ...target,
        draft: value,
        revision: 4,
      }),
    ),
    accepted: vi.fn(async () => {}),
  };
}
it("先保存要求与有序引用，返回已保存版本，未执行任何生成", async () => {
  const input = setup();
  expect(await syncAssistantCreationDraft(input)).toEqual({
    focusCreationId: "target",
    focusCreationRevision: 4,
  });
  expect(input.save).toHaveBeenCalledExactlyOnceWith(input.draft, 3);
  expect(input.flush.mock.invocationCallOrder[0]).toBeLessThan(
    input.save.mock.invocationCallOrder[0] ?? 0,
  );
});
it("没有修改时不发起保存，只读也可以读取现有要求", async () => {
  const input = { ...setup(), draft: target.draft, canEdit: false };
  expect(await syncAssistantCreationDraft(input)).toEqual({
    focusCreationId: "target",
    focusCreationRevision: 3,
  });
  expect(input.save).not.toHaveBeenCalled();
});
it("保存失败和版本冲突不交付上下文，不确认本机草稿", async () => {
  const input = setup();
  input.save.mockRejectedValue(new Error("版本冲突"));
  await expect(syncAssistantCreationDraft(input)).rejects.toThrow("版本冲突");
  expect(input.accepted).not.toHaveBeenCalled();
});
it("迟到保存回执不能确认已切换的目标或工作区", async () => {
  const input = setup();
  let active = true;
  input.assertCurrent.mockImplementation(() => {
    if (!active) throw new Error("已切换");
  });
  input.save.mockImplementation(async (draft) => {
    active = false;
    return { ...target, draft, revision: 4 };
  });
  await expect(syncAssistantCreationDraft(input)).rejects.toThrow("已切换");
  expect(input.accepted).not.toHaveBeenCalled();
});
it("等待布局保存时继续编辑不会改写已捕获请求", async () => {
  const input = setup();
  input.flush.mockImplementation(async () => {
    input.draft.prompt = "发送后的新输入";
    input.draft.inputs.push({ id: "later", nodeId: "reference-3" });
  });
  await syncAssistantCreationDraft(input);
  expect(input.save.mock.calls[0]?.[0]).toMatchObject({
    prompt: "最新要求",
    inputs: [{ id: "input-2", nodeId: "reference-2" }],
  });
  expect(input.draft.prompt).toBe("发送后的新输入");
});
it("只读下的未保存修改和不匹配回执都不能作为最新草稿发送", async () => {
  const denied = { ...setup(), canEdit: false };
  await expect(syncAssistantCreationDraft(denied)).rejects.toThrow("编辑权限");
  expect(denied.save).not.toHaveBeenCalled();
  const stale = setup();
  stale.save.mockResolvedValue({
    ...target,
    draft: { ...stale.draft, prompt: "不同内容" },
    revision: 4,
  });
  await expect(syncAssistantCreationDraft(stale)).rejects.toThrow("引用已变化");
});
