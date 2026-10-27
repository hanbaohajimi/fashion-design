// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { DraftScopeProvider, usePersistentDraft } from "./use-persistent-draft";
import { draftRepository, discardWorkspaceDrafts, flushWorkspaceDrafts } from "./draft-repository";

afterEach(cleanup);
function Editor({ id, baseline = "原值" }: { id: string; baseline?: string }) {
  const [value, setValue] = useState(baseline);
  usePersistentDraft({ value, restore: setValue, baseline: JSON.stringify(baseline), objectKey: id });
  return <input aria-label="草稿" value={value} onChange={event => setValue(event.target.value)} />;
}
const scope = { accountId: "draft-test-owner", projectId: "project", editor: "test" };

it("恢复同基线草稿，切换前刷新写入且不覆盖另一对象", async () => {
  const id = crypto.randomUUID();
  const key = JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]);
  await draftRepository.write({ key, accountId: scope.accountId, baseline: JSON.stringify("原值"), value: "恢复的内容" }, 0);
  const view = render(<DraftScopeProvider scope={scope}><Editor id={id} /></DraftScopeProvider>);
  await waitFor(() => expect(screen.getByLabelText("草稿")).toHaveProperty("value", "恢复的内容"));
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "继续编辑" } });
  await act(async () => { await flushWorkspaceDrafts(); });
  view.rerender(<DraftScopeProvider scope={scope}><Editor key="second" id="another" /></DraftScopeProvider>);
  expect((await draftRepository.read(key))?.value).toBe("继续编辑");
});
it("服务端基线变化时不自动覆盖，可选择服务端版本", async () => {
  const id = crypto.randomUUID();
  await draftRepository.write({ key: JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]), accountId: scope.accountId, baseline: JSON.stringify("旧值"), value: "本机修改" }, 0);
  render(<DraftScopeProvider scope={scope}><Editor id={id} baseline="新服务端版本" /></DraftScopeProvider>);
  await screen.findByText("本机草稿与当前资料存在差异，请核对后继续。");
  expect(screen.getByLabelText("草稿")).toHaveProperty("value", "新服务端版本");
  fireEvent.click(screen.getByRole("button", { name: "本机草稿状态" }));
  fireEvent.click(screen.getByRole("button", { name: "采用服务端版本" }));
  await waitFor(() => expect(screen.queryByText("本机草稿与当前资料存在差异，请核对后继续。")).toBeNull());
});
it("明确丢弃后不会在卸载时重新写回", async () => {
  const id = crypto.randomUUID();
  const key = JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]);
  const view = render(<DraftScopeProvider scope={scope}><Editor id={id} /></DraftScopeProvider>);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "主动丢弃的内容" } });
  await act(async () => { await flushWorkspaceDrafts(); });
  expect((await draftRepository.read(key))?.value).toBe("主动丢弃的内容");
  await act(async () => { await discardWorkspaceDrafts(); });
  view.unmount();
  await flushWorkspaceDrafts();
  expect(await draftRepository.read(key)).toBeUndefined();
});
it("冲突副本刷新后仍可读取并选择恢复", async () => {
  const id = crypto.randomUUID();
  const key = JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]);
  const input = { key, accountId: scope.accountId, baseline: JSON.stringify("原值"), value: "另一标签内容" };
  await draftRepository.write(input, 0);
  await draftRepository.write({ ...input, value: "被保留的冲突副本" }, 0).catch(() => undefined);
  render(<DraftScopeProvider scope={scope}><Editor id={id} /></DraftScopeProvider>);
  await screen.findByText("另一个版本的本机草稿已保留，请核对差异。");
  fireEvent.click(screen.getByRole("button", { name: "本机草稿状态" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复另一份草稿" }));
  await waitFor(() => expect(screen.getByLabelText("草稿")).toHaveProperty("value", "被保留的冲突副本"));
});
it("受理后立即清除对应草稿，延迟刷新和新输入不会被误删", async () => {
  const id = crypto.randomUUID();
  const key = JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]);
  const hook = renderHook(({ value }) => usePersistentDraft({ value, restore: () => undefined, baseline: JSON.stringify("原值"), objectKey: id }), {
    initialProps: { value: "原值" },
    wrapper: ({ children }) => <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>,
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  hook.rerender({ value: "已受理正文" });
  await act(async () => { await flushWorkspaceDrafts(); });
  await act(async () => { await hook.result.current.acknowledge("已受理正文"); await flushWorkspaceDrafts(); });
  expect(await draftRepository.read(key)).toBeUndefined();
  hook.rerender({ value: "请求期间的新草稿" });
  await act(async () => { await flushWorkspaceDrafts(); await hook.result.current.acknowledge("已受理正文"); });
  expect((await draftRepository.read(key))?.value).toBe("请求期间的新草稿");
});
it("发送回执绑定原会话，不会删除另一会话的相同正文", async () => {
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const hook = renderHook(({ id, value }) => usePersistentDraft({ value, restore: () => undefined, baseline: JSON.stringify("原值"), objectKey: id }), {
    initialProps: { id: first, value: "原值" },
    wrapper: ({ children }) => <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>,
  });
  hook.rerender({ id: first, value: "相同正文" });
  let receipt!: () => Promise<void>;
  await act(async () => { receipt = await hook.result.current.captureAcknowledgement("相同正文"); });
  hook.rerender({ id: second, value: "原值" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  hook.rerender({ id: second, value: "相同正文" });
  await act(async () => { await flushWorkspaceDrafts(); await receipt(); });
  expect(await draftRepository.read(JSON.stringify([scope.accountId, scope.projectId, scope.editor, first]))).toBeUndefined();
  expect((await draftRepository.read(JSON.stringify([scope.accountId, scope.projectId, scope.editor, second])))?.value).toBe("相同正文");
});

it("发送期间写出的新修订即使正文相同也不会被旧回执清理", async () => {
  const id = crypto.randomUUID();
  const hook = renderHook(({ value }) => usePersistentDraft({ value, restore: () => undefined, baseline: JSON.stringify("原值"), objectKey: id }), {
    initialProps: { value: "原值" },
    wrapper: ({ children }) => <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>,
  });
  hook.rerender({ value: "准备发送" });
  let receipt!: () => Promise<void>;
  await act(async () => { receipt = await hook.result.current.captureAcknowledgement("准备发送"); });
  hook.rerender({ value: "下一次编辑" });
  await act(async () => { await flushWorkspaceDrafts(); });
  hook.rerender({ value: "准备发送" });
  await act(async () => { await flushWorkspaceDrafts(); await receipt(); });
  const record = await draftRepository.read(JSON.stringify([scope.accountId, scope.projectId, scope.editor, id]));
  expect(record?.value).toBe("准备发送");
  expect(record?.revision).toBeGreaterThan(1);
});
