// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addTryOnCaptureToCanvas, loadTryOnGarment, PendingTryOnCapture, uploadTryOnGarment, validateGarment } from "./tryon-asset-flow";

const upload = vi.hoisted(() => ({ sign: vi.fn(), put: vi.fn(), complete: vi.fn(), ready: vi.fn(), import: vi.fn(), workflow: vi.fn(), patch: vi.fn() }));
vi.mock("../../board/file-upload-api", () => ({ signImageUpload: upload.sign, putOriginal: upload.put, completeUpload: upload.complete, waitForThumbnail: upload.ready }));
vi.mock("../../board/generation/collection-api", () => ({ importDesignAsset: upload.import }));
vi.mock("../../board/workflow/workflow-api", () => ({ fetchWorkflow: upload.workflow }));

const ready = { id: "file", status: "READY", thumbnail256Url: "/thumb", width: 1280, height: 720 };
const output = { assetId: "capture-asset", url: "/api/design-assets/capture-asset/content", source: "realtime-tryon-capture" as const };
const capture = () => ({ blob: new Blob(["test-remote-frame"], { type: "image/png" }), width: 1280, height: 720, sessionId: "session", garmentAssetId: "garment", garmentRevision: 3, capturedAt: "2026-10-29T12:00:00.000Z" });
beforeEach(() => {
  for (const mock of Object.values(upload)) mock.mockReset();
  upload.sign.mockResolvedValue({ file: ready, upload: { method: "PUT", url: "https://test.invalid/never-fetched", headers: {} } });
  upload.put.mockResolvedValue(undefined);
  upload.complete.mockResolvedValue(ready);
  upload.ready.mockResolvedValue(ready);
  upload.import.mockResolvedValue({ id: "imported" });
  upload.workflow.mockResolvedValue({ revision: 8, nodes: [] });
  upload.patch.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network is forbidden in asset-flow tests"); }));
  vi.stubGlobal("Image", class { src = ""; naturalWidth = 1280; naturalHeight = 720; decode = vi.fn(async () => {}); });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("retries capture registration with the same key without uploading the frame again", async () => {
  const fetch = vi.mocked(globalThis.fetch);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "数据库暂不可用" }), { status: 503 }));
  fetch.mockResolvedValue(new Response(JSON.stringify(output)));
  const item = new PendingTryOnCapture(capture(), "project");
  await expect(item.save()).rejects.toThrow("数据库暂不可用");
  const result = await item.save();
  expect(result).toEqual(output);
  expect(upload.sign).toHaveBeenCalledTimes(1);
  expect(upload.put).toHaveBeenCalledTimes(1);
  expect(upload.complete).toHaveBeenCalledTimes(1);
  expect(upload.ready).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  const requests = fetch.mock.calls.map(([, init]) => init);
  expect(requests[0]?.headers).toEqual(requests[1]?.headers);
  expect(JSON.parse(String(requests[1]?.body))).toEqual({ fileId: "file", width: 1280, height: 720, garmentAssetId: "garment", garmentRevision: 3, capturedAt: "2026-10-29T12:00:00.000Z" });
  expect(await item.save()).toEqual(output);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("shares an in-flight save for double-clicks and refreshes an expired upload signature on manual retry", async () => {
  upload.put.mockRejectedValueOnce(new Error("签名已过期"));
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(output)));
  const item = new PendingTryOnCapture(capture(), "project");
  const first = item.save();
  expect(item.save()).toBe(first);
  await expect(first).rejects.toThrow("签名已过期");
  await item.save();
  expect(upload.sign).toHaveBeenCalledTimes(2);
  expect(upload.complete).toHaveBeenCalledTimes(1);
});

it("preserves the immutable outfit snapshot on capture registration independently of the application sequence", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(output)));
  await new PendingTryOnCapture({ ...capture(), outfitSnapshotId: "outfit-snapshot-version-17" }, "project").save();
  const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({ outfitSnapshotId: "outfit-snapshot-version-17", garmentRevision: 3 });
});

it("does not re-upload while retrying thumbnail processing", async () => {
  upload.ready.mockRejectedValueOnce(new Error("缩略图超时"));
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(output)));
  const item = new PendingTryOnCapture(capture(), "project");
  await expect(item.save()).rejects.toThrow("缩略图超时");
  await item.save();
  expect(upload.put).toHaveBeenCalledTimes(1);
  expect(upload.ready).toHaveBeenCalledTimes(2);
});

it("rejects unsupported, empty, oversized and undecodable garments before upload", async () => {
  await expect(validateGarment(new File(["svg"], "a.svg", { type: "image/svg+xml" }), 50)).rejects.toThrow("仅支持");
  await expect(validateGarment(new File([], "a.png", { type: "image/png" }), 50)).rejects.toThrow("不能超过");
  await expect(uploadTryOnGarment("project", new File(["large"], "a.png", { type: "image/png" }), 3)).rejects.toThrow("不能超过");
  vi.stubGlobal("Image", class { src = ""; decode = vi.fn(async () => { throw new Error("broken"); }); });
  await expect(validateGarment(new File(["bad"], "a.png", { type: "image/png" }), 50)).rejects.toThrow("无法解码");
  expect(upload.sign).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it("reads authorized design content into a File and never hands a signed URL to the SDK", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response("decoded-by-test-image", { headers: { "Content-Type": "image/png" } }));
  const garment = await loadTryOnGarment("asset/with-space", 5_242_880);
  expect(garment.file).toBeInstanceOf(File);
  expect(garment.assetId).toBe("asset/with-space");
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/design-assets/asset%2Fwith-space/content", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it("imports uploaded garments through the existing private file and design-asset flow", async () => {
  const result = await uploadTryOnGarment("project", new File(["image"], "a.png", { type: "image/png" }), 5_242_880);
  expect(result.id).toBe("imported");
  expect(upload.import).toHaveBeenCalledWith("project", "file");
  expect(upload.complete).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("adds a saved asset to the existing workflow once and preserves unrelated nodes", async () => {
  upload.workflow.mockResolvedValueOnce({ revision: 8, nodes: [{ x: 200, payload: { assetId: "existing" } }] });
  await addTryOnCaptureToCanvas("project", output);
  expect(upload.patch).toHaveBeenCalledWith("project", expect.objectContaining({ baseRevision: 8, mode: "semantic", operations: [expect.objectContaining({ type: "add_node", node: expect.objectContaining({ kind: "asset", type: "candidate", x: 620, payload: expect.objectContaining({ assetId: output.assetId, source: output.source }) }) })] }));
  upload.workflow.mockResolvedValueOnce({ revision: 9, nodes: [{ x: 620, payload: { assetId: output.assetId } }] });
  await addTryOnCaptureToCanvas("project", output);
  expect(upload.patch).toHaveBeenCalledTimes(1);
});

vi.mock("../../board/workflow/import-canvas-materials", () => ({ importCanvasMaterials: upload.patch }));
