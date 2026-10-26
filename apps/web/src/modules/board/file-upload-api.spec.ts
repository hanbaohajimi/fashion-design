// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { putOriginal, waitForThumbnail } from "./file-upload-api";
import { setPrivateRequestUser } from "../auth/private-fetch";

class UploadRequest {
  static last: UploadRequest;
  status = 200;
  headers: Record<string, string> = {};
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() { UploadRequest.last = this; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
}
const upload = { method: "PUT" as const, url: "https://storage.test/signed", headers: { "Content-Type": "image/png", "x-amz-checksum-sha256": "checksum" } };
const file = new File(["image"], "image.png", { type: "image/png" });
beforeEach(() => { setPrivateRequestUser(crypto.randomUUID()); vi.stubGlobal("XMLHttpRequest", UploadRequest); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("reports actual byte progress, retains signed headers, and only resolves on successful PUT", async () => {
  const progress = vi.fn();
  const result = putOriginal(upload, file, { onProgress: progress });
  const request = UploadRequest.last;
  request.upload.onprogress?.({ loaded: 2, total: 5, lengthComputable: true } as ProgressEvent);
  expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 5, lengthComputable: true });
  expect(request.open).toHaveBeenCalledWith("PUT", upload.url);
  expect(request.headers).toEqual(upload.headers);
  expect(request.send).toHaveBeenCalledWith(file);
  request.onload?.();
  await result;
  expect(request.upload.onprogress).toBeNull();
});

it("propagates unknown totals and does not retry a rejected PUT", async () => {
  const progress = vi.fn();
  const result = putOriginal(upload, file, { onProgress: progress });
  const check = expect(result).rejects.toThrow("原图直传失败");
  UploadRequest.last.upload.onprogress?.({ loaded: 2, total: 0, lengthComputable: false } as ProgressEvent);
  UploadRequest.last.status = 403;
  UploadRequest.last.onload?.();
  await check;
  expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 0, lengthComputable: false });
  expect(UploadRequest.last.send).toHaveBeenCalledTimes(1);
});

it.each(["cancel", "account"])("aborts active transfer on %s and removes listeners", async (reason) => {
  const controller = new AbortController();
  const result = putOriginal(upload, file, { signal: controller.signal, onProgress: vi.fn() });
  const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
  if (reason === "cancel") controller.abort(); else setPrivateRequestUser("another-account");
  await check;
  expect(UploadRequest.last.abort).toHaveBeenCalledOnce();
  expect(UploadRequest.last.onload).toBeNull();
});

it("cancels thumbnail waiting immediately without issuing the next poll", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const result = waitForThumbnail("file", { id: "file", status: "PROCESSING" } as never, 60_000, controller.signal);
  const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await check;
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).not.toHaveBeenCalled();
});
