// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { draftRepository } from "../../components/drafts/draft-repository";
import { StudioApiError } from "./studio-api";
import { styleFixture, techPackFixture } from "./studio-test-fixtures";
import {
  carryStudioSaveDraft,
  confirmStudioSave,
  pendingStudioSaves,
  saveStudioOperation,
  studioSaveKey,
  type StudioSaveContext,
  type StudioSaveOperation,
} from "./studio-save-recovery";

afterEach(() => vi.restoreAllMocks());
const context = (): StudioSaveContext => ({
  accountId: crypto.randomUUID(),
  projectId: "project",
  editor: "studio:styles",
  objectKey: "style-1",
  draft: { name: "草稿" },
  isActive: () => true,
});
const style = (name = "保存的款式"): StudioSaveOperation => ({
  kind: "style",
  styleId: "style-1",
  input: {
    ...styleFixture().currentRevision.payload,
    name,
    requestKey: crypto.randomUUID(),
    expectedVersion: 1,
  },
});
const lost = () => Promise.reject(new TypeError("网络响应丢失"));

it("刷新后读取完整提交，复用原请求、目标与版本；不自动重发", async () => {
  const scope = context();
  const operation = style();
  await expect(
    saveStudioOperation(scope.projectId, operation, scope, lost),
  ).rejects.toThrow();
  const [record] = await pendingStudioSaves(scope.accountId, scope.projectId);
  if (!record) throw new Error("缺少恢复记录");
  expect(record.value.operation).toEqual(operation);
  const send = vi.fn(async () => styleFixture());
  expect(send).not.toHaveBeenCalled();
  await confirmStudioSave(record, send);
  expect(send).toHaveBeenCalledExactlyOnceWith(operation);
  expect(await pendingStudioSaves(scope.accountId, scope.projectId)).toEqual(
    [],
  );
});

it("同样内容重试采用持久化请求编号，后来的新内容不能替换未确认提交", async () => {
  const scope = context();
  const operation = style();
  await expect(
    saveStudioOperation(scope.projectId, operation, scope, lost),
  ).rejects.toThrow();
  const send = vi.fn(async () => styleFixture());
  await expect(
    saveStudioOperation(scope.projectId, style("新内容"), scope, send),
  ).rejects.toThrow("上一份保存尚未确认");
  expect(send).not.toHaveBeenCalled();
  await saveStudioOperation(scope.projectId, style(), scope, send);
  expect(send).toHaveBeenCalledExactlyOnceWith(operation);
});

it("成功只清理提交时的草稿，后续版本保留", async () => {
  const scope = context();
  const key = JSON.stringify([
    scope.accountId,
    scope.projectId,
    scope.editor,
    scope.objectKey,
  ]);
  const original = await draftRepository.write(
    { key, accountId: scope.accountId, baseline: "null", value: scope.draft },
    0,
  );
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, lost),
  ).rejects.toThrow();
  await draftRepository.write(
    {
      key,
      accountId: scope.accountId,
      baseline: "null",
      value: { name: "后来编辑" },
    },
    original.revision,
  );
  const [record] = await pendingStudioSaves(scope.accountId, scope.projectId);
  if (!record) throw new Error("缺少记录");
  await confirmStudioSave(record, async () => styleFixture());
  expect((await draftRepository.read(key))?.value).toEqual({
    name: "后来编辑",
  });
});

it("同时重试只发送一次；竞争写入不会遗留假草稿冲突", async () => {
  const scope = context();
  let finish!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = saveStudioOperation(scope.projectId, style(), scope, send);
  const second = saveStudioOperation(scope.projectId, style(), scope, send);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  finish();
  await Promise.all([first, second]);
  expect(await draftRepository.conflicts(studioSaveKey(scope))).toEqual([]);
  expect(await pendingStudioSaves(scope.accountId, scope.projectId)).toEqual(
    [],
  );
});

it.each([400, 404, 409, 422])(
  "明确拒绝 %i 释放提交记录，但保留输入",
  async (status) => {
    const scope = context();
    const key = JSON.stringify([
      scope.accountId,
      scope.projectId,
      scope.editor,
      scope.objectKey,
    ]);
    await draftRepository.write(
      { key, accountId: scope.accountId, baseline: "null", value: scope.draft },
      0,
    );
    await expect(
      saveStudioOperation(scope.projectId, style(), scope, () =>
        Promise.reject(new StudioApiError("请求被拒绝", status)),
      ),
    ).rejects.toThrow();
    expect(await pendingStudioSaves(scope.accountId, scope.projectId)).toEqual(
      [],
    );
    expect((await draftRepository.read(key))?.value).toEqual(scope.draft);
  },
);

it.each([401, 403, 500, 503])(
  "无法确认提交结果 %i 仍保留原操作",
  async (status) => {
    const scope = context();
    await expect(
      saveStudioOperation(scope.projectId, style(), scope, () =>
        Promise.reject(new StudioApiError("暂无法确认", status)),
      ),
    ).rejects.toThrow();
    expect(
      await pendingStudioSaves(scope.accountId, scope.projectId),
    ).toHaveLength(1);
  },
);

it("存储写入失败时不发送，账号退出后的迟到保存也不能发送", async () => {
  const scope = context();
  const send = vi.fn(async () => styleFixture());
  vi.spyOn(draftRepository, "write").mockRejectedValueOnce(
    new Error("存储空间不足"),
  );
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, send),
  ).rejects.toThrow("尚未发送");
  await draftRepository.clearAccount(scope.accountId);
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, send),
  ).rejects.toThrow("尚未发送");
  expect(send).not.toHaveBeenCalled();
});

it("账号、项目和对象分别隔离，未知记录不能重放", async () => {
  const scope = context();
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, lost),
  ).rejects.toThrow();
  expect(await pendingStudioSaves("other", scope.projectId)).toEqual([]);
  expect(await pendingStudioSaves(scope.accountId, "another")).toEqual([]);
  await draftRepository.write(
    {
      key: studioSaveKey({ ...scope, objectKey: "broken" }),
      accountId: scope.accountId,
      baseline: "null",
      value: { schema: 99 },
    },
    0,
  );
  await expect(
    pendingStudioSaves(scope.accountId, scope.projectId),
  ).rejects.toThrow("无法读取");
});

it("文档保留发布操作、documentId和原版本，不转为新草稿", async () => {
  const scope = { ...context(), editor: "studio:tech", objectKey: "tech-1" };
  const operation: StudioSaveOperation = {
    kind: "document",
    input: {
      type: "TECH_PACK",
      documentId: "tech-1",
      expectedVersion: 3,
      requestKey: crypto.randomUUID(),
      payload: techPackFixture().currentRevision.payload as Extract<
        StudioSaveOperation,
        { kind: "document" }
      >["input"]["payload"],
    } as Extract<StudioSaveOperation, { kind: "document" }>["input"],
  };
  await expect(
    saveStudioOperation(scope.projectId, operation, scope, lost),
  ).rejects.toThrow();
  const [record] = await pendingStudioSaves(scope.accountId, scope.projectId);
  expect(record?.value.operation).toEqual(operation);
});

it("确认后新建表单的后续草稿转到已保存款式，保留原请求直到完成转移", async () => {
  const scope = { ...context(), objectKey: "new:asset" };
  const key = JSON.stringify([
    scope.accountId,
    scope.projectId,
    scope.editor,
    scope.objectKey,
  ]);
  const first = await draftRepository.write(
    { key, accountId: scope.accountId, baseline: "null", value: scope.draft },
    0,
  );
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, lost),
  ).rejects.toThrow();
  const later = { name: "新写的名字" };
  await draftRepository.write(
    { key, accountId: scope.accountId, baseline: "null", value: later },
    first.revision,
  );
  const [record] = await pendingStudioSaves(scope.accountId, scope.projectId);
  if (!record) throw new Error("缺少恢复记录");
  const saved = await confirmStudioSave(record, async () => styleFixture());
  expect(
    await pendingStudioSaves(scope.accountId, scope.projectId),
  ).toHaveLength(1);
  await carryStudioSaveDraft(record, saved);
  expect(await pendingStudioSaves(scope.accountId, scope.projectId)).toEqual(
    [],
  );
  expect(await draftRepository.read(key)).toBeUndefined();
  expect(
    (
      await draftRepository.read(
        JSON.stringify([
          scope.accountId,
          scope.projectId,
          scope.editor,
          saved.id,
        ]),
      )
    )?.value,
  ).toEqual(later);
});

it("目标款式已有不同草稿时保留两份输入，不覆盖也不清除原请求", async () => {
  const scope = { ...context(), objectKey: "new:asset" };
  const key = JSON.stringify([
    scope.accountId,
    scope.projectId,
    scope.editor,
    scope.objectKey,
  ]);
  await expect(
    saveStudioOperation(scope.projectId, style(), scope, lost),
  ).rejects.toThrow();
  await draftRepository.write(
    {
      key,
      accountId: scope.accountId,
      baseline: "null",
      value: { name: "原页面草稿" },
    },
    0,
  );
  const saved = styleFixture();
  const target = JSON.stringify([
    scope.accountId,
    scope.projectId,
    scope.editor,
    saved.id,
  ]);
  await draftRepository.write(
    {
      key: target,
      accountId: scope.accountId,
      baseline: "null",
      value: { name: "目标页面草稿" },
    },
    0,
  );
  const [record] = await pendingStudioSaves(scope.accountId, scope.projectId);
  if (!record) throw new Error("缺少记录");
  await expect(carryStudioSaveDraft(record, saved)).rejects.toThrow(
    "另一份本机草稿",
  );
  expect((await draftRepository.read(key))?.value).toEqual({
    name: "原页面草稿",
  });
  expect((await draftRepository.read(target))?.value).toEqual({
    name: "目标页面草稿",
  });
  expect(
    await pendingStudioSaves(scope.accountId, scope.projectId),
  ).toHaveLength(1);
});
