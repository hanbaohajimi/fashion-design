"use client";

import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  createProject,
  deleteProject,
  duplicateProject,
  fetchProjects,
  updateProject,
} from "./projects-api";
import type {
  Project,
  ProjectPage,
  ProjectStatusFilter,
} from "./project-types";

const projectKeys = {
  all: ["projects"] as const,
  list: (search: string, status: ProjectStatusFilter) =>
    ["projects", { search, status }] as const,
};

type ProjectCache = InfiniteData<ProjectPage, number>;
type CacheSnapshot = readonly [QueryKey, ProjectCache | undefined];

interface ProjectListOptions {
  readonly search: string;
  readonly status: ProjectStatusFilter;
}

function getProjectListOptions(
  queryKey: QueryKey,
): ProjectListOptions | null {
  const value = queryKey[1] as Partial<ProjectListOptions> | undefined;

  if (
    queryKey[0] !== "projects" ||
    !value ||
    typeof value.search !== "string" ||
    (value.status !== "active" && value.status !== "archived")
  ) {
    return null;
  }

  return {
    search: value.search,
    status: value.status,
  };
}

function projectMatchesList(
  project: Project,
  options: ProjectListOptions,
): boolean {
  const hasExpectedStatus =
    project.archived === (options.status === "archived");
  const normalizedSearch = options.search.trim().toLocaleLowerCase();

  return (
    hasExpectedStatus &&
    (!normalizedSearch ||
      project.name.toLocaleLowerCase().includes(normalizedSearch))
  );
}

function mapProjects(
  cache: ProjectCache | undefined,
  mapItem: (project: Project) => Project | null,
): ProjectCache | undefined {
  if (!cache) {
    return cache;
  }

  let itemDelta = 0;
  const pages = cache.pages.map((page) => {
    const items = page.items.flatMap((project) => {
      const next = mapItem(project);
      return next ? [next] : [];
    });
    itemDelta += items.length - page.items.length;

    return {
      ...page,
      items,
    };
  });

  return {
    ...cache,
    pages: pages.map((page) => ({
      ...page,
      total: Math.max(0, page.total + itemDelta),
    })),
  };
}

function prependProject(
  cache: ProjectCache | undefined,
  project: Project,
): ProjectCache | undefined {
  if (!cache?.pages[0]) {
    return cache;
  }

  const firstPage = cache.pages[0];
  return {
    ...cache,
    pages: [
      {
        ...firstPage,
        items: [project, ...firstPage.items],
        total: firstPage.total + 1,
      },
      ...cache.pages.slice(1).map((page) => ({
        ...page,
        total: page.total + 1,
      })),
    ],
  };
}

function restoreSnapshots(
  queryClient: QueryClient,
  snapshots: readonly CacheSnapshot[],
): void {
  for (const [queryKey, data] of snapshots) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function useProjects(
  search: string,
  status: ProjectStatusFilter,
  enabled = true,
) {
  return useInfiniteQuery({
    enabled,
    queryKey: projectKeys.list(search, status),
    queryFn: ({ pageParam }) => fetchProjects(pageParam, search, status),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      idempotencyKey,
      name,
    }: {
      readonly idempotencyKey: string;
      readonly name: string;
    }) => createProject(name, idempotencyKey),
    onMutate: async ({ idempotencyKey, name }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.all });
      const snapshots = queryClient.getQueriesData<ProjectCache>({
        queryKey: projectKeys.all,
      });
      const optimisticId = `temp-${idempotencyKey}`;
      const now = new Date().toISOString();
      const optimisticProject: Project = {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: now,
        id: optimisticId,
        name,
        optimistic: true,
        updatedAt: now,
      };

      for (const [queryKey, cache] of snapshots) {
        const options = getProjectListOptions(queryKey);

        if (options && projectMatchesList(optimisticProject, options)) {
          queryClient.setQueryData(
            queryKey,
            prependProject(cache, optimisticProject),
          );
        }
      }

      return { optimisticId, snapshots };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        restoreSnapshots(queryClient, context.snapshots);
      }
    },
    onSuccess: (created, _variables, context) => {
      if (!context) {
        return;
      }

      queryClient.setQueriesData<ProjectCache>(
        { queryKey: projectKeys.all },
        (cache) =>
          mapProjects(cache, (project) =>
            project.id === context.optimisticId ? created : project,
          ),
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      readonly id: string;
      readonly input: { readonly archived?: boolean; readonly name?: string };
    }) => updateProject(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.all });
      const snapshots = queryClient.getQueriesData<ProjectCache>({
        queryKey: projectKeys.all,
      });

      for (const [queryKey, cache] of snapshots) {
        const options = getProjectListOptions(queryKey);
        queryClient.setQueryData(
          queryKey,
          mapProjects(cache, (project) => {
            if (project.id !== id) {
              return project;
            }

            const updated = {
              ...project,
              ...input,
              updatedAt: new Date().toISOString(),
            };

            if (options && !projectMatchesList(updated, options)) {
              return null;
            }

            return updated;
          }),
        );
      }

      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        restoreSnapshots(queryClient, context.snapshots);
      }
    },
    onSuccess: (updated) => {
      const caches = queryClient.getQueriesData<ProjectCache>({
        queryKey: projectKeys.all,
      });

      for (const [queryKey, cache] of caches) {
        const options = getProjectListOptions(queryKey);
        queryClient.setQueryData(
          queryKey,
          mapProjects(cache, (project) => {
            if (project.id !== updated.id) {
              return project;
            }

            return options && !projectMatchesList(updated, options)
              ? null
              : updated;
          }),
        );
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useDuplicateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      projectId,
    }: {
      readonly idempotencyKey: string;
      readonly projectId: string;
    }) => duplicateProject(projectId, idempotencyKey),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProject,
    onMutate: async (projectId) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.all });
      const snapshots = queryClient.getQueriesData<ProjectCache>({
        queryKey: projectKeys.all,
      });

      queryClient.setQueriesData<ProjectCache>(
        { queryKey: projectKeys.all },
        (cache) =>
          mapProjects(cache, (project) =>
            project.id === projectId ? null : project,
          ),
      );

      return { snapshots };
    },
    onError: (_error, _projectId, context) => {
      if (context) {
        restoreSnapshots(queryClient, context.snapshots);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}
