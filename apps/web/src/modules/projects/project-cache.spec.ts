import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { latestProjectCache, projectKeys, projectTransaction, type ProjectCache } from "./project-cache";
import type { Project } from "./project-types";

const item = (id: string): Project => ({ id, name: `设计项目 ${id}`, archived: false, assetCount: 0,
  coverAssetId: null, coverUrl: null, createdAt: "2026-10-20", updatedAt: "2026-10-20" });
const page = (items: Project[]): ProjectCache => ({ pageParams: [1], pages: [{ items, total: items.length,
  page: 1, pageSize: 20, hasMore: false, stats: { activeProjects: items.length, coverRate: 0, totalAssets: 0 } }] });
const key = projectKeys.list("", "active", "user-a");
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function current(client: QueryClient) { return client.getQueryData<ProjectCache>(key)?.pages[0]; }
describe("项目缓存按操作隔离", () => {
  it("失败后仅选择同用户同归档范围的上次成功数据", () => {
    const client = new QueryClient();
    const data = page([item("active")]);
    client.setQueryData(key, data);
    client.setQueryData(projectKeys.list("", "archived", "user-a"), page([{ ...item("archived"), archived: true }]));
    client.setQueryData(projectKeys.list("", "active", "user-b"), page([item("private")]));
    expect(latestProjectCache(client, "user-a", "active")).toEqual(data);
    expect(latestProjectCache(client, "user-c", "active")).toBeUndefined();
    expect(latestProjectCache(client, undefined, "active")).toBeUndefined();
  });
  it("A归档失败不会恢复已经成功归档的B，且总数准确", async () => {
    const client = new QueryClient();
    client.setQueryData(key, page([item("a"), item("b")]));
    const first = deferred<Project>();
    const a = projectTransaction(client, "user-a", "a", (old) => old && { ...old, archived: true }, () => first.promise, (value) => value).catch(() => undefined);
    await vi.waitFor(() => expect(current(client)?.items.map((value) => value.id)).toEqual(["b"]));
    await projectTransaction(client, "user-a", "b", (old) => old && { ...old, archived: true }, async () => ({ ...item("b"), archived: true }), (value) => value);
    first.reject(new Error("归档失败"));
    await a;
    expect(current(client)?.items.map((value) => value.id)).toEqual(["a"]);
    expect(current(client)?.total).toBe(1);
  });
  it("创建失败仅移除自己的临时记录，不覆盖并发重命名", async () => {
    const client = new QueryClient();
    client.setQueryData(key, page([item("a")]));
    const pending = deferred<Project>();
    const create = projectTransaction(client, "user-a", "temp", () => item("temp"), () => pending.promise, (value) => value).catch(() => undefined);
    await vi.waitFor(() => expect(current(client)?.total).toBe(2));
    await projectTransaction(client, "user-a", "a", (old) => old && { ...old, name: "新的名称" }, async () => ({ ...item("a"), name: "新的名称" }), (value) => value);
    pending.reject(new Error("创建失败"));
    await create;
    expect(current(client)?.items).toEqual([{ ...item("a"), name: "新的名称" }]);
    expect(current(client)?.total).toBe(1);
  });
  it("同ID写操作串行，恢复等待归档确认；其他用户缓存不变", async () => {
    const client = new QueryClient();
    const other = projectKeys.list("", "active", "user-b");
    client.setQueryData(key, page([item("a")])); client.setQueryData(other, page([item("a")]));
    const pending = deferred<Project>();
    const archive = projectTransaction(client, "user-a", "a", (old) => old && { ...old, archived: true }, () => pending.promise, (value) => value);
    const request = vi.fn(async () => item("a"));
    const restore = projectTransaction(client, "user-a", "a", (old) => ({ ...(old ?? item("a")), archived: false }), request, (value) => value);
    await vi.waitFor(() => expect(current(client)?.total).toBe(0));
    expect(request).not.toHaveBeenCalled();
    pending.resolve({ ...item("a"), archived: true });
    await Promise.all([archive, restore]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(current(client)?.total).toBe(1);
    expect(client.getQueryData(other)).toEqual(page([item("a")]));
  });
  it("删除失败按原索引恢复，保留其他记录的新状态", async () => {
    const client = new QueryClient();
    client.setQueryData(key, page([item("a"), item("b"), item("c")]));
    const pending = deferred<undefined>();
    const remove = projectTransaction(client, "user-a", "b", () => undefined, () => pending.promise, () => undefined).catch(() => undefined);
    await vi.waitFor(() => expect(current(client)?.total).toBe(2));
    await projectTransaction(client, "user-a", "c", (old) => old && { ...old, name: "并发新名称" }, async () => ({ ...item("c"), name: "并发新名称" }), (value) => value);
    pending.reject(new Error("删除失败")); await remove;
    expect(current(client)?.items.map((value) => value.id)).toEqual(["a", "b", "c"]);
    expect(current(client)?.items[2]?.name).toBe("并发新名称");
    expect(current(client)?.total).toBe(3);
  });
});
