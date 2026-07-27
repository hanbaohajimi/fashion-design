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
  fetchProjects,
  updateProject,
} from "./projects-api";
import type { Project, ProjectPage } from "./project-types";

const projectKeys = {
  all: ["projects"] as const,
  list: (search: string) => ["projects", { search }] as const,
};

type ProjectCache = InfiniteData<ProjectPage, number>;
type CacheSnapshot = readonly [QueryKey, ProjectCache | undefined];

function mapProjects(
  cache: ProjectCache | undefined,
  mapItem: (project: Project) => Project | null,
): ProjectCache | undefined {
  if (!cache) {
    return cache;
  }

  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((project) => {
        const next = mapItem(project);
        return next ? [next] : [];
      }),
    })),
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

export function useProjects(search: string, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: projectKeys.list(search),
    queryFn: ({ pageParam }) => fetchProjects(pageParam, search),
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

      queryClient.setQueriesData<ProjectCache>(
        { queryKey: projectKeys.all },
        (cache) => {
          if (!cache?.pages[0]) {
            return cache;
          }

          const firstPage = cache.pages[0];
          return {
            ...cache,
            pages: [
              {
                ...firstPage,
                items: [optimisticProject, ...firstPage.items],
                total: firstPage.total + 1,
              },
              ...cache.pages.slice(1),
            ],
          };
        },
      );

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

      queryClient.setQueriesData<ProjectCache>(
        { queryKey: projectKeys.all },
        (cache) =>
          mapProjects(cache, (project) => {
            if (project.id !== id) {
              return project;
            }

            if (input.archived) {
              return null;
            }

            return {
              ...project,
              ...input,
              updatedAt: new Date().toISOString(),
            };
          }),
      );

      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        restoreSnapshots(queryClient, context.snapshots);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<ProjectCache>(
        { queryKey: projectKeys.all },
        (cache) =>
          mapProjects(cache, (project) =>
            project.id === updated.id ? updated : project,
          ),
      );
    },
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
