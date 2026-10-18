// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { navigateAfterSave, registerNavigationGuard } from "./navigation";
import { privateFetch, setPrivateRequestUser } from "./auth/private-fetch";
import { setActiveBoardUser, readActiveBoardId, writeActiveBoardId } from "./trends/active-board";

afterEach(() => vi.unstubAllGlobals());

it("程序化导航等待保存，失败保持当前页面", async () => {
  let release!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const cleanup = registerNavigationGuard(save);
  const navigate = vi.fn();
  const pending = navigateAfterSave(navigate);
  expect(navigate).not.toHaveBeenCalled();
  release();
  expect(await pending).toBe(true);
  expect(navigate).toHaveBeenCalledTimes(1);
  cleanup();
  const unregister = registerNavigationGuard(async () => { throw new Error("offline"); });
  expect(await navigateAfterSave(navigate)).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
  unregister();
});

it("账号变化取消所有私有读取、上传和外部调用者信号，旧响应不能返回", async () => {
  setPrivateRequestUser("a");
  let resolve!: (response: Response) => void;
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit) => {
    requestSignal = init.signal ?? undefined;
    return new Promise<Response>((done) => { resolve = done; });
  }));
  const pending = privateFetch("/api/private");
  setPrivateRequestUser("b");
  expect(requestSignal?.aborted).toBe(true);
  resolve(new Response("account a"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const controller = new AbortController();
  const other = privateFetch("/api/private", { signal: controller.signal });
  controller.abort();
  expect(requestSignal?.aborted).toBe(true);
  resolve(new Response("canceled"));
  await expect(other).rejects.toMatchObject({ name: "AbortError" });
});

it("最近项目按账号保存，匿名和新账号不继承上一账号", () => {
  localStorage.clear();
  setActiveBoardUser("a");
  writeActiveBoardId("private-a");
  setActiveBoardUser("b");
  expect(readActiveBoardId()).toBeNull();
  writeActiveBoardId("private-b");
  setActiveBoardUser("a");
  expect(readActiveBoardId()).toBe("private-a");
  setActiveBoardUser(null);
  expect(readActiveBoardId()).toBeNull();
});
