// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AUTH_EXPIRED_EVENT } from "../auth/auth-api";
import { setPrivateRequestUser } from "../auth/private-fetch";
import { signImageUpload } from "./file-upload-api";

const signed = {
  deduplicated: false,
  file: { id: "file-a", status: "PENDING" },
  upload: { method: "PUT", url: "https://storage.test/signed", headers: {} },
};
const fetch = vi.fn();
const file = new File(["image"], "参考图.png", { type: "image/png" });
const arrayBuffer = vi.fn(async () => new TextEncoder().encode("image").buffer);
Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", fetch);
  setPrivateRequestUser(crypto.randomUUID());
  fetch.mockReset();
  arrayBuffer.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("signs a new upload with its original name, type, size, and SHA256", async () => {
  fetch.mockResolvedValue(Response.json(signed, { status: 201 }));

  await expect(signImageUpload("project-a", file)).resolves.toEqual(signed);

  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("/api/files/sign-upload", expect.objectContaining({
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType: "image/png",
      name: "参考图.png",
      projectId: "project-a",
      sha256: createHash("sha256").update("image").digest("hex"),
      size: 5,
    }),
  }));
});

it.each([500, 502, 503, 504])("recovers from a transient HTTP %s proxy failure without hashing again", async (status) => {
  fetch.mockResolvedValueOnce(new Response("Internal Server Error", { status }))
    .mockResolvedValueOnce(Response.json(signed, { status: 201 }));
  const result = signImageUpload("project-a", file);

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(750);
  await expect(result).resolves.toEqual(signed);

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1].body).toBe(fetch.mock.calls[0]?.[1].body);
  expect(arrayBuffer).toHaveBeenCalledOnce();
});

it("recovers from a temporary network disconnect", async () => {
  fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(Response.json(signed));
  const result = signImageUpload("project-a", file);

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(750);
  await expect(result).resolves.toEqual(signed);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("bounds retries and explains persistent proxy unavailability", async () => {
  fetch.mockImplementation(async () => new Response("Internal Server Error", { status: 500 }));
  const result = signImageUpload("project-a", file);
  const check = expect(result).rejects.toThrow("上传服务暂时不可用，请稍后重新上传");

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5_250);
  await check;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds retries after persistent network errors", async () => {
  fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  const result = signImageUpload("project-a", file);
  const check = expect(result).rejects.toThrow("上传服务暂时不可用");

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5_250);
  await check;
  expect(fetch).toHaveBeenCalledTimes(4);
});

it.each([400, 401, 403, 409, 429, 500])("preserves HTTP %s application errors without retrying", async (status) => {
  fetch.mockResolvedValue(Response.json({ message: "原始业务错误" }, { status }));
  const expired = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  try {
    await expect(signImageUpload("project-a", file)).rejects.toThrow("原始业务错误");
    expect(fetch).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }
});

it.each(["cancel", "account"])("cancels the retry delay on %s without sending another request", async (reason) => {
  fetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
  const controller = new AbortController();
  const result = signImageUpload("project-a", file, controller.signal);
  const check = expect(result).rejects.toMatchObject({ name: "AbortError" });

  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  if (reason === "cancel") controller.abort();
  else setPrivateRequestUser("another-account");
  await check;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not hash or send an already cancelled upload", async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(signImageUpload("project-a", file, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
  expect(arrayBuffer).not.toHaveBeenCalled();
});
