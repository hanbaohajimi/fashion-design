// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftScopeProvider } from "../../components/drafts/use-persistent-draft";
import { draftRepository, draftWriter, flushWorkspaceDrafts } from "../../components/drafts/draft-repository";
import { useStudioForm } from "./use-studio-form";

afterEach(cleanup);

function formHook() {
  const scope = { accountId: crypto.randomUUID(), projectId: "project", editor: "studio:styles" };
  const key = JSON.stringify([scope.accountId, scope.projectId, scope.editor, "new"]);
  const onDirty = vi.fn();
  const hook = renderHook(() => useStudioForm({ name: "" }, onDirty, { draftKey: "new" }), {
    wrapper: ({ children }) => <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>,
  });
  return { hook, key, scope, onDirty };
}

it("保存后重建编辑器不会让已提交的本机草稿复活", async () => {
  const { hook, key } = formHook();
  act(() => hook.result.current.setDraft({ name: "已保存款式" }));
  await act(async () => { await flushWorkspaceDrafts(); });
  expect((await draftRepository.read(key))?.value).toEqual({ name: "已保存款式" });
  await act(async () => { expect(await hook.result.current.submit(async () => undefined)).toBe(true); });
  hook.unmount();
  await flushWorkspaceDrafts();
  expect(await draftRepository.read(key)).toBeUndefined();
});

it("保存失败保留草稿，再次提交相同内容复用请求编号", async () => {
  const { hook, key } = formHook();
  act(() => hook.result.current.setDraft({ name: "未确认的款式" }));
  const keys: string[] = [];
  await act(async () => { await hook.result.current.submit(async requestKey => { keys.push(requestKey); throw new Error("连接中断"); }); });
  expect((await draftRepository.read(key))?.value).toEqual({ name: "未确认的款式" });
  expect(hook.result.current.dirty).toBe(true);
  await act(async () => { await hook.result.current.submit(async requestKey => { keys.push(requestKey); }); });
  expect(keys[0]).toBe(keys[1]);
  expect(await draftRepository.read(key)).toBeUndefined();
});

it("保存期间写入的新草稿不会被旧保存回执删除", async () => {
  const { hook, key, scope } = formHook();
  act(() => hook.result.current.setDraft({ name: "本页提交" }));
  let release!: () => void;
  let task!: Promise<boolean>;
  const action = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  act(() => { task = hook.result.current.submit(action); });
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  const current = await draftRepository.read(key);
  expect(current?.writer).toBe(draftWriter);
  if (!current) throw new Error("提交前草稿未写入");
  await draftRepository.write({ key, accountId: scope.accountId, baseline: JSON.stringify({ name: "" }), value: { name: "随后写入的新修改" } }, current.revision);
  await act(async () => { release(); await task; });
  hook.unmount();
  await flushWorkspaceDrafts();
  expect((await draftRepository.read(key))?.value).toEqual({ name: "随后写入的新修改" });
});

it("离开后的保存回执清理原草稿，但不清除新页面的未保存状态", async () => {
  const { hook, key, onDirty } = formHook();
  act(() => hook.result.current.setDraft({ name: "上一页面的提交" }));
  let release!: () => void;
  let task!: Promise<boolean>;
  const action = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  act(() => { task = hook.result.current.submit(action); });
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  hook.unmount();
  onDirty.mockClear();
  await act(async () => { release(); expect(await task).toBe(true); });
  expect(onDirty).not.toHaveBeenCalled();
  await flushWorkspaceDrafts();
  expect(await draftRepository.read(key)).toBeUndefined();
});
