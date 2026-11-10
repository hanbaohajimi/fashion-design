// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectGeneratedFile } from "@fashion/shared";
import { downloadGeneratedFile, fetchGeneratedFiles } from "./generated-files-api";

vi.mock("../../auth/private-fetch", () => ({
  privateFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  privateRequestSignal: (signal: AbortSignal) => signal,
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const file = (): ProjectGeneratedFile => ({
  id: "asset:look-1", domain: "asset", resourceId: "look-1", kind: "image", title: "初稿", operation: "生成设计",
  createdAt: "2026-11-10T00:00:00.000Z", archived: true, status: "ready", mimeType: null, width: 600, height: 800,
  durationMs: null, sizeBytes: null, expiresAt: null, previewUrl: "/api/design-assets/look-1/thumbnail",
  contentUrl: "/api/design-assets/look-1/content", sourceHref: null, nodeId: null,
});
const list = () => fetchGeneratedFiles("project", "all", "", undefined, new AbortController().signal);

it("接受空页及完整的历史文件响应，保留分页边界", async () => {
  const result = { items: [file()], nextCursor: "next" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(result)).mockResolvedValueOnce(Response.json({ items: [], nextCursor: null })));
  expect(await list()).toEqual(result);
  expect(await list()).toEqual({ items: [], nextCursor: null });
});

it("拒绝缺失身份、未知状态和错误数据类型，提供可重试错误", async () => {
  const invalid = [null, { ...file(), resourceId: undefined }, { ...file(), id: "asset:other" }, { ...file(), title: {} }, { ...file(), domain: ["asset"] }, { ...file(), kind: ["image"] }, { ...file(), status: "success" }, { ...file(), expiresAt: "bad" }, { ...file(), sizeBytes: -1 }, { ...file(), archived: "yes" }];
  for (const item of invalid) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [item], nextCursor: null })));
    await expect(list()).rejects.toThrow("生成文件响应无效");
  }
});

it("来源链接限定当前项目，媒体地址只接受普通文件地址", async () => {
  for (const overrides of [{ sourceHref: "/other/studio" }, { sourceHref: "//outside.example/project" }, { contentUrl: "javascript:alert(1)" }, { contentUrl: "https://user:password@example.com/file" }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [{ ...file(), ...overrides }], nextCursor: null })));
    await expect(list()).rejects.toThrow("生成文件响应无效");
  }
  const item = { ...file(), sourceHref: "/project/studio?tab=tech&documentId=doc", contentUrl: "https://storage.example/result.png" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [item], nextCursor: null })));
  expect((await list()).items).toEqual([item]);
});

it("下载响应不完整或读取期间取消时不触发浏览器下载", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  for (const response of [null, {}, { url: "/result" }, { url: "javascript:alert(1)", fileName: "test.png" }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
    await expect(downloadGeneratedFile("project", file(), new AbortController())).rejects.toThrow("下载地址无效");
  }
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); return Response.json({ url: "/result", fileName: "设计.png" }); }));
  await expect(downloadGeneratedFile("project", file(), controller)).rejects.toMatchObject({ name: "AbortError" });
  expect(click).not.toHaveBeenCalled();
});

it("有效下载由浏览器处理，保留中文文件名", async () => {
  let name = "", href = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { name = this.download; href = this.href; });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ url: "https://storage.example/original?signature=test", fileName: "设计原图.png" })));
  await downloadGeneratedFile("project", file(), new AbortController());
  expect(name).toBe("设计原图.png"); expect(href).toBe("https://storage.example/original?signature=test");
});
