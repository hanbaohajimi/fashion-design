import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { Project, ProjectPage, ProjectStatusFilter } from "./project-types";

export type ProjectCache = InfiniteData<ProjectPage, number>;
export const projectKeys = {
  all: ["projects"] as const,
  list: (search: string, status: ProjectStatusFilter, userId: string | undefined) =>
    ["projects", { search, status, userId }] as const,
};
export function listOptions(key: QueryKey) {
  const value = key[1] as { search?: string; status?: string; userId?: string } | undefined;
  return key[0] === "projects" && typeof value?.search === "string" &&
    (value.status === "active" || value.status === "archived")
    ? { search: value.search, status: value.status, userId: value.userId } : null;
}
export function matchesList(project: Project, key: QueryKey) {
  const options = listOptions(key);
  return options && project.archived === (options.status === "archived") &&
    project.name.toLocaleLowerCase().includes(options.search.trim().toLocaleLowerCase());
}
export function latestProjectCache(client: QueryClient, userId: string | undefined, status: ProjectStatusFilter) {
  if (!userId) return undefined;
  return client.getQueryCache().findAll({ predicate: (query) => {
    const options = listOptions(query.queryKey);
    return options?.userId === userId && options.status === status && Boolean(query.state.data);
  } }).reverse().sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0]?.state.data as ProjectCache | undefined;
}
interface Position { page: number; index: number }
function locate(cache: ProjectCache | undefined, id: string) {
  for (const [page, data] of (cache?.pages ?? []).entries()) {
    const index = data.items.findIndex((item) => item.id === id);
    const item = data.items[index];
    if (item) return { page, index, item };
  }
  return undefined;
}
/** 只补偿本次操作涉及的记录，不用旧整页覆盖另一项目的成功操作。 */
export function replaceProject(cache: ProjectCache | undefined, id: string, next?: Project, position?: Position): ProjectCache | undefined {
  if (!cache?.pages.length) return cache;
  const old = locate(cache, id);
  if (!old && !next) return cache;
  const destination = position ?? old ?? { page: 0, index: 0 };
  const targetPage = Math.min(destination.page, cache.pages.length - 1);
  const delta = Number(Boolean(next)) - Number(Boolean(old));
  return {
    ...cache,
    pages: cache.pages.map((page, pageIndex) => {
      const items = page.items.filter((item) => item.id !== id && item.id !== next?.id);
      if (next && pageIndex === targetPage) items.splice(Math.min(destination.index, items.length), 0, next);
      return { ...page, items, total: Math.max(0, page.total + delta) };
    }),
  };
}
interface Coordinator {
  queues: Map<string, Promise<unknown>>;
  tokens: Map<string, symbol>;
  pending: number;
}
const coordinators = new WeakMap<QueryClient, Coordinator>();
function coordinator(client: QueryClient) {
  let state = coordinators.get(client);
  if (!state) {
    state = { queues: new Map(), tokens: new Map(), pending: 0 };
    coordinators.set(client, state);
  }
  return state;
}
export function projectTransaction<T>(
  client: QueryClient,
  userId: string | undefined,
  id: string,
  optimistic: (source: Project | undefined) => Project | undefined,
  request: () => Promise<T>,
  result: (value: T, original: Project | undefined) => Project | undefined,
  source?: Project,
): Promise<T> {
  const state = coordinator(client);
  const previous = state.queues.get(id) ?? Promise.resolve();
  state.pending += 1;
  const filter = { predicate: (query: { queryKey: QueryKey }) => {
    const options = listOptions(query.queryKey);
    return Boolean(options && options.userId === userId);
  } };
  const task = previous.catch(() => undefined).then(async () => {
    const token = Symbol(id);
    state.tokens.set(id, token);
    await client.cancelQueries(filter);
    const caches = client.getQueriesData<ProjectCache>(filter);
    const snapshots = caches.map(([key, data]) => ({ key, before: locate(data, id) }));
    const original = snapshots.find((entry) => entry.before)?.before?.item ?? source;
    const next = optimistic(original);
    for (const [key] of caches) {
      client.setQueryData<ProjectCache>(key, (data) =>
        replaceProject(data, id, next && matchesList(next, key) ? next : undefined));
    }
    try {
      const value = await request();
      if (state.tokens.get(id) === token) {
        const saved = result(value, original);
        for (const [key] of client.getQueriesData<ProjectCache>(filter)) {
          client.setQueryData<ProjectCache>(key, (data) =>
            replaceProject(data, id, saved && matchesList(saved, key) ? saved : undefined));
        }
      }
      return value;
    } catch (error) {
      if (state.tokens.get(id) === token) {
        for (const { key, before } of snapshots) {
          client.setQueryData<ProjectCache>(key, (data) =>
            replaceProject(data, id, before?.item, before));
        }
      }
      throw error;
    } finally {
      if (state.tokens.get(id) === token) state.tokens.delete(id);
    }
  });
  state.queues.set(id, task);
  return task.finally(() => {
    if (state.queues.get(id) === task) state.queues.delete(id);
    state.pending -= 1;
    if (!state.pending) void client.invalidateQueries({ queryKey: projectKeys.all });
  });
}
