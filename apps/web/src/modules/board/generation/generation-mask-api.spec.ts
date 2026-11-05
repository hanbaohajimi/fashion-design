import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { uploadTemporaryMask, uploadTemporaryMaskReference } from "./generation-api";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../auth/private-fetch", () => ({ privateFetch: mocks.fetch }));
const blob = new Blob(["unchanged-mask-bytes"], { type: "image/png" });
const checksum = createHash("sha256").update("unchanged-mask-bytes");
const hash = checksum.digest();
const signed = { maskId: "mask-id", maskUrl: "private-mask-url", upload: { method: "PUT", url: "https://storage.example/mask", headers: { "x-amz-checksum-sha256": hash.toString("base64") } } };
beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValueOnce(Response.json(signed)).mockResolvedValueOnce(new Response(null, { status: 200 })); });
afterEach(() => vi.unstubAllGlobals());

it("uploads unchanged bytes with matching base64 checksum and exposes the hex registration reference", async () => {
  expect(await uploadTemporaryMaskReference("project", blob, 1024, 1536)).toEqual({ maskId: "mask-id", maskUrl: "private-mask-url", sha256: hash.toString("hex") });
  expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toEqual({ projectId: "project", width: 1024, height: 1536, size: blob.size, checksumSha256: hash.toString("base64") });
  expect(mocks.fetch.mock.calls[1]?.[1].body).toBe(blob);
  expect(mocks.fetch.mock.calls[0]?.[1].signal).toBe(mocks.fetch.mock.calls[1]?.[1].signal);
});

it("preserves the existing inpaint URL-only upload API", async () => {
  expect(await uploadTemporaryMask("project", blob, 100, 200)).toBe("private-mask-url");
});

it("cancels an in-flight original PUT and does not return a usable reference", async () => {
  const controller = new AbortController();
  mocks.fetch.mockReset().mockResolvedValueOnce(Response.json(signed)).mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason)); controller.abort();
  }));
  await expect(uploadTemporaryMaskReference("project", blob, 100, 200, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

it("rejects a mismatched signed checksum before uploading", async () => {
  mocks.fetch.mockReset().mockResolvedValueOnce(Response.json({ ...signed, upload: { ...signed.upload, headers: { "x-amz-checksum-sha256": "different" } } }));
  await expect(uploadTemporaryMaskReference("project", blob, 100, 200)).rejects.toMatchObject({ code: "MASK_CHECKSUM_MISMATCH" });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
