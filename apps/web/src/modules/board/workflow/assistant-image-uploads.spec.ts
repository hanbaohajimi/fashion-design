// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  AssistantImageUploadQueue,
  type ImageUploadActions,
} from "./assistant-image-uploads";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { CanvasApiError } from "./canvas-api";

const api = vi.hoisted(() => ({
  hash: vi.fn(),
  sign: vi.fn(),
  put: vi.fn(),
  complete: vi.fn(),
  ready: vi.fn(),
  get: vi.fn(),
  import: vi.fn(),
}));
vi.mock("../file-upload-api", () => ({
  validateImage: (file: File) =>
    file.type === "image/png" ? null : "图片格式不支持",
  imageMimeType: (file: File) => file.type,
  sha256Hex: api.hash,
  signImageUpload: api.sign,
  putOriginal: api.put,
  completeUpload: api.complete,
  waitForThumbnail: api.ready,
  fetchUploadedFile: api.get,
}));
vi.mock("./canvas-api", async (original) => ({
  ...(await original<typeof import("./canvas-api")>()),
  runCanvasCommand: api.import,
}));
vi.mock("../../auth/private-fetch", () => ({
  privateRequestSignal: (signal: AbortSignal) => signal,
}));
const queues: AssistantImageUploadQueue[] = [];
const file = (name = "外套.png") =>
  new File(["original"], name, { type: "image/png", lastModified: 1 });
const ready = {
  id: "private-image",
  status: "READY",
  thumbnail256Url: "/thumb.png",
  width: 600,
  height: 800,
};
const result = {
  nodeId: "image-node",
  graph: { nodes: [] },
  canvas: { bindings: [] },
};
function setup() {
  const context = {
    accountId: crypto.randomUUID(),
    projectId: "p",
    editor: "workspace",
    conversationId: "chat",
  };
  const actions: ImageUploadActions = {
    enabled: true,
    slots: 16,
    beforeImport: vi.fn(async () => {}),
    apply: vi.fn(async () => {}),
    reference: vi.fn(async () => {}),
  };
  const create = () => {
    const queue = new AssistantImageUploadQueue(context, () => actions);
    queues.push(queue);
    return queue;
  };
  return { context, actions, create };
}
beforeEach(() => {
  api.hash.mockImplementation((file: File) =>
    Promise.resolve((file.name.startsWith("other") ? "b" : "a").repeat(64)),
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = vi.fn(() => "blob:local-preview");
      static override revokeObjectURL = vi.fn();
    },
  );
  api.sign.mockResolvedValue({ file: ready, upload: null });
  api.put.mockResolvedValue(undefined);
  api.complete.mockResolvedValue(ready);
  api.ready.mockResolvedValue(ready);
  api.get.mockResolvedValue(ready);
  api.import.mockResolvedValue(result);
});
afterEach(() => {
  queues.splice(0).forEach((queue) => queue.deactivate());
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("上传只加入当前引用，原操作与文件编号先持久化后接入", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  api.import.mockImplementationOnce(async (_project, command) => {
    const records = await draftRepository.list(queue.prefix);
    expect(records).toHaveLength(1);
    expect(records[0]?.value).toMatchObject({ fileId: ready.id, command });
    expect(JSON.stringify(records[0])).not.toContain("blob:");
    return result;
  });
  await queue.add([file()]);
  await waitFor(() => expect(h.actions.reference).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(queue.snapshot().items).toHaveLength(0));
  expect(api.import.mock.calls[0]?.[1]).toMatchObject({
    type: "import_reference_image",
    fileId: ready.id,
    placement: "reference",
  });
  expect(await draftRepository.list(queue.prefix)).toEqual([]);
});

it("未知回执刷新后不自动执行，继续使用同一请求和位置", async () => {
  const h = setup(),
    first = h.create();
  await first.activate();
  api.import.mockRejectedValueOnce(new Error("响应未知"));
  await first.add([file()]);
  await waitFor(() => expect(first.snapshot().items[0]?.stage).toBe("failed"));
  const command = api.import.mock.calls[0]?.[1];
  first.deactivate();
  const resumed = h.create();
  await resumed.activate();
  expect(resumed.snapshot().items[0]?.stage).toBe("waiting");
  expect(api.import).toHaveBeenCalledTimes(1);
  const item = resumed.snapshot().items[0];
  if (!item) throw new Error("缺少续办");
  resumed.retry(item.id);
  await waitFor(() => expect(resumed.snapshot().items).toHaveLength(0));
  expect(api.sign).toHaveBeenCalledTimes(1);
  expect(api.import.mock.calls[1]?.[1]).toEqual(command);
});

it("上传完成后处理失败，继续只读取处理状态而不重传文件", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  api.ready.mockRejectedValueOnce(new Error("缩略图暂不可用"));
  await queue.add([file()]);
  await waitFor(() => expect(queue.snapshot().items[0]?.stage).toBe("failed"));
  const item = queue.snapshot().items[0];
  if (!item) throw new Error("缺少附件");
  queue.retry(item.id);
  await waitFor(() => expect(queue.snapshot().items).toHaveLength(0));
  expect(api.sign).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith(ready.id, expect.any(AbortSignal));
});

it("明确处理失败可重新准备原文件，刷新后先要求重选", async () => {
  const h = setup(),
    first = h.create();
  await first.activate();
  api.ready.mockRejectedValueOnce(new Error("缩略图处理失败"));
  await first.add([file()]);
  await waitFor(() => expect(first.snapshot().items[0]?.stage).toBe("failed"));
  first.deactivate();
  const next = h.create();
  await next.activate();
  const item = next.snapshot().items[0];
  if (!item) throw new Error("缺少恢复记录");
  api.get.mockResolvedValueOnce({ ...ready, status: "FAILED" });
  next.retry(item.id);
  await waitFor(() =>
    expect(next.snapshot().items[0]?.stage).toBe("needs_file"),
  );
  expect(api.sign).toHaveBeenCalledTimes(1);
  expect(api.import).not.toHaveBeenCalled();
  await next.reselect(item.id, file());
  await waitFor(() => expect(next.snapshot().items).toHaveLength(0));
  expect(api.sign).toHaveBeenCalledTimes(2);
});

it("重新选择原图读取失败有提示，重载后迟到的文件读取不执行", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  api.sign.mockRejectedValueOnce(new Error("暂不可上传"));
  await queue.add([file()]);
  await waitFor(() => expect(queue.snapshot().items[0]?.stage).toBe("failed"));
  const item = queue.snapshot().items[0];
  if (!item) throw new Error("缺少附件");
  api.hash.mockRejectedValueOnce(new Error("读取失败"));
  await queue.reselect(item.id, file());
  expect(queue.snapshot().error).toContain("无法读取");
  expect(api.sign).toHaveBeenCalledTimes(1);
  let resolve!: (hash: string) => void;
  api.hash.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = queue.reselect(item.id, file());
  await queue.reload();
  resolve("a".repeat(64));
  await pending;
  expect(api.sign).toHaveBeenCalledTimes(1);
  expect(queue.snapshot().items[0]?.stage).toBe("needs_file");
});

it("部分上传刷新需要原文件，重新选择核对字节且不接受另一张图", async () => {
  const h = setup(),
    first = h.create();
  await first.activate();
  api.sign.mockResolvedValueOnce({
    file: { ...ready, status: "PENDING" },
    upload: { url: "https://upload.test", method: "PUT", headers: {} },
  });
  api.put.mockRejectedValueOnce(new Error("直传中断"));
  await first.add([file()]);
  await waitFor(() => expect(first.snapshot().items[0]?.stage).toBe("failed"));
  first.deactivate();
  const next = h.create();
  await next.activate();
  const item = next.snapshot().items[0];
  if (!item) throw new Error("缺少原文件记录");
  expect(item.stage).toBe("needs_file");
  await next.reselect(item.id, file("other.png"));
  expect(next.snapshot().error).toContain("与原图片不同");
  expect(api.import).not.toHaveBeenCalled();
  await next.reselect(item.id, file());
  await waitFor(() => expect(next.snapshot().items).toHaveLength(0));
});

it("切换会话取消请求，不应用迟到结果，原会话仍可续办", async () => {
  const h = setup(),
    first = h.create();
  await first.activate();
  let resolve!: (value: unknown) => void;
  api.import.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await first.add([file()]);
  await waitFor(() => expect(api.import).toHaveBeenCalledTimes(1));
  const signal = api.import.mock.calls[0]?.[2] as AbortSignal;
  first.deactivate();
  expect(signal.aborted).toBe(true);
  resolve(result);
  await new Promise((done) => setTimeout(done, 5));
  expect(h.actions.apply).not.toHaveBeenCalled();
  expect(h.actions.reference).not.toHaveBeenCalled();
  const next = h.create();
  await next.activate();
  expect(next.snapshot().items[0]?.stage).toBe("waiting");
});

it("引用失败仍保留接入编号，修正后不重建项目素材", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  h.actions.reference = vi
    .fn()
    .mockRejectedValueOnce(new Error("引用已达上限"))
    .mockResolvedValueOnce(undefined);
  await queue.add([file()]);
  await waitFor(() =>
    expect(queue.snapshot().items[0]?.error).toContain("上限"),
  );
  const item = queue.snapshot().items[0];
  if (!item) throw new Error("缺少附件");
  queue.retry(item.id);
  await waitFor(() => expect(queue.snapshot().items).toHaveLength(0));
  expect(api.import.mock.calls[1]?.[1]).toEqual(api.import.mock.calls[0]?.[1]);
  expect(api.sign).toHaveBeenCalledTimes(1);
});

it("格式和名额按整批检查，不静默截取，不上传空文件", async () => {
  const h = setup(),
    queue = h.create();
  h.actions.slots = 1;
  await queue.activate();
  await queue.add([file("a.png"), file("b.png")]);
  expect(queue.snapshot().error).toContain("16");
  expect(queue.snapshot().items).toEqual([]);
  await queue.add([new File(["video"], "video.mp4", { type: "video/mp4" })]);
  expect(queue.snapshot().error).toContain("格式");
  await queue.add([new File([], "empty.png", { type: "image/png" })]);
  expect(queue.snapshot().error).toContain("为空");
  expect(api.sign).not.toHaveBeenCalled();
});

it("本机记录保存失败时不发送，明确接口拒绝可更正后重试", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  vi.spyOn(draftRepository, "write").mockRejectedValueOnce(
    new Error("本机存储已满"),
  );
  await queue.add([file()]);
  await waitFor(() =>
    expect(queue.snapshot().items[0]?.error).toContain("存储"),
  );
  expect(api.sign).not.toHaveBeenCalled();
  const item = queue.snapshot().items[0];
  if (!item) throw new Error("缺少附件");
  api.import.mockRejectedValueOnce(new CanvasApiError("文件不可访问", 403));
  queue.retry(item.id);
  await waitFor(() =>
    expect(queue.snapshot().items[0]?.error).toContain("不可访问"),
  );
  queue.retry(item.id);
  await waitFor(() => expect(queue.snapshot().items).toHaveLength(0));
});

it("多图顺序与选择顺序一致，准备中的重复文件不创建新项", async () => {
  const h = setup(),
    queue = h.create();
  await queue.activate();
  let resolve!: (value: unknown) => void;
  api.sign.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await queue.add([file("a.png"), file("b.png")]);
  await waitFor(() => expect(api.sign).toHaveBeenCalledTimes(1));
  await queue.add([file("a.png")]);
  expect(queue.snapshot().items).toHaveLength(2);
  expect(queue.snapshot().error).toContain("已在准备");
  queue.clearError();
  resolve({ file: ready, upload: null });
  await waitFor(() => expect(queue.snapshot().items).toHaveLength(0));
  expect(api.sign.mock.calls.map((call) => call[1].name)).toEqual([
    "a.png",
    "b.png",
  ]);
});

it("等待中的多张图片均保留恢复记录，刷新不丢排队项目", async () => {
  const h = setup(),
    first = h.create();
  await first.activate();
  let done!: (value: unknown) => void;
  api.sign.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  await first.add([file("a.png"), file("b.png")]);
  await waitFor(() => expect(api.sign).toHaveBeenCalledTimes(1));
  await waitFor(async () =>
    expect(await draftRepository.list(first.prefix)).toHaveLength(2),
  );
  first.deactivate();
  done({ file: ready, upload: null });
  const next = h.create();
  await next.activate();
  expect(next.snapshot().items.map((item) => item.name)).toEqual([
    "a.png",
    "b.png",
  ]);
  expect(
    next.snapshot().items.every((item) => item.stage === "needs_file"),
  ).toBe(true);
  expect(api.import).not.toHaveBeenCalled();
});
