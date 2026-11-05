import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadWardrobeMask } from "./wardrobe-assets";
const mocks = vi.hoisted(() => ({ temporary: vi.fn(), register: vi.fn(), ordinary: vi.fn(), close: vi.fn() }));
vi.mock("../../board/file-upload-api", () => ({ signImageUpload: mocks.ordinary, putOriginal: mocks.ordinary, completeUpload: mocks.ordinary, waitForThumbnail: mocks.ordinary }));
vi.mock("../../board/generation/collection-api", () => ({ importDesignAsset: mocks.ordinary }));
vi.mock("../../board/generation/generation-api", () => ({ uploadTemporaryMaskReference: mocks.temporary }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: { materialMask: mocks.register } }));
const blob = new Blob(["mask"], { type: "image/png" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1024, height: 1536, close: mocks.close }));
  mocks.temporary.mockResolvedValue({ maskId: "temporary-id", maskUrl: "private-temporary-url", sha256: "a".repeat(64) });
  mocks.register.mockResolvedValue({ assetId: "permanent-mask", url: "/api/design-assets/permanent-mask/content" });
});
afterEach(() => vi.unstubAllGlobals());

it("registers an original-size mask through the private no-AI endpoint without ordinary asset processing", async () => {
  const signal = new AbortController().signal;
  expect(await uploadWardrobeMask("project", "source", blob, signal)).toEqual({ id: "permanent-mask", url: "/api/design-assets/permanent-mask/content" });
  expect(mocks.temporary).toHaveBeenCalledWith("project", blob, 1024, 1536, signal);
  expect(mocks.register).toHaveBeenCalledWith("project", { requestKey: expect.any(String), sourceAssetId: "source", maskId: "temporary-id", sha256: "a".repeat(64), operation: "transparency" }, signal);
  expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.ordinary).not.toHaveBeenCalled();
});

it("does not register a temporary upload that resolves after cancellation", async () => {
  const controller = new AbortController();
  mocks.temporary.mockImplementationOnce(async () => { controller.abort(); return { maskId: "temporary-id", sha256: "a".repeat(64) }; });
  await expect(uploadWardrobeMask("project", "source", blob, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.ordinary).not.toHaveBeenCalled();
});

it("registers correction selections with correction semantics", async () => {
  await uploadWardrobeMask("project", "source", blob, new AbortController().signal, "correction");
  expect(mocks.register.mock.calls[0]?.[1]).toMatchObject({ operation: "correction", sourceAssetId: "source" });
  expect(mocks.ordinary).not.toHaveBeenCalled();
});
