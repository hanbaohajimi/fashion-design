// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestTryOnCamera, stopMediaStream } from "./camera-controller";

const getUserMedia = vi.fn();
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("requests video without a microphone only after explicit invocation", async () => {
  const stream = {} as MediaStream;
  getUserMedia.mockResolvedValue(stream);
  expect(await requestTryOnCamera()).toBe(stream);
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.any(Object) }));
});

it("rejects insecure contexts without prompting for media", async () => {
  vi.stubGlobal("isSecureContext", false);
  await expect(requestTryOnCamera()).rejects.toMatchObject({ code: "CAMERA_INSECURE_CONTEXT" });
  expect(getUserMedia).not.toHaveBeenCalled();
});

it.each([
  ["NotAllowedError", "CAMERA_DENIED"], ["NotFoundError", "CAMERA_NOT_FOUND"],
  ["NotReadableError", "CAMERA_BUSY"], ["AbortError", "CAMERA_BUSY"],
])("maps %s to a readable and safe device error", async (name, code) => {
  getUserMedia.mockRejectedValue(new DOMException("sensitive browser detail", name));
  await expect(requestTryOnCamera()).rejects.toMatchObject({ code });
  await expect(requestTryOnCamera()).rejects.not.toHaveProperty("message", "sensitive browser detail");
});

it("continues releasing tracks when one track stop throws", () => {
  const second = vi.fn();
  stopMediaStream({ getTracks: () => [{ stop: () => { throw new Error("device unplugged"); } }, { stop: second }] } as unknown as MediaStream);
  expect(second).toHaveBeenCalledOnce();
});
