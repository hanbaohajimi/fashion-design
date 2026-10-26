"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createProject, deleteProject, duplicateProject, fetchProjects, updateProject } from "./projects-api";
import type { Project, ProjectStatusFilter } from "./project-types";
import { useAuth } from "../auth/AuthProvider";
import { latestProjectCache, listOptions, projectKeys, projectTransaction } from "./project-cache";

export function useProjects(search: string, status: ProjectStatusFilter, enabled = true) {
  const { session } = useAuth();
  const client = useQueryClient();
  const userId = session?.user.id;
  const result = useInfiniteQuery({
    enabled: enabled && Boolean(session),
    queryKey: projectKeys.list(search, status, userId),
    queryFn: ({ pageParam, signal }) => fetchProjects(pageParam, search, status, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    placeholderData: (previous, query) => {
      const old = query && listOptions(query.queryKey);
      return old?.userId === userId && old?.status === status ? previous : undefined;
    },
  });
  return { ...result, data: result.data ?? (result.isError ? latestProjectCache(client, userId, status) : undefined) };
}

export function useCreateProject() {
  const client = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: ({ idempotencyKey, name }: { readonly idempotencyKey: string; readonly name: string }) => {
      const id = `temp-${idempotencyKey}`;
      const now = new Date().toISOString();
      const optimistic: Project = { id, name, archived: false, assetCount: 0, coverAssetId: null,
        coverUrl: null, createdAt: now, updatedAt: now, optimistic: true };
      return projectTransaction(client, session?.user.id, id, () => optimistic,
        () => createProject(name, idempotencyKey), (created) => created);
    },
  });
}

export function useUpdateProject() {
  const client = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: ({ id, input, source }: {
      readonly id: string;
      readonly input: { readonly archived?: boolean; readonly name?: string };
      readonly source?: Project;
    }) => projectTransaction(client, session?.user.id, id,
      (old) => old ? { ...old, ...input, updatedAt: new Date().toISOString() } : undefined,
      () => updateProject(id, input), (updated) => updated, source),
  });
}

export function useDuplicateProject() {
  const client = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: ({ idempotencyKey, projectId }: { readonly idempotencyKey: string; readonly projectId: string }) =>
      projectTransaction(client, session?.user.id, projectId, (old) => old,
        () => duplicateProject(projectId, idempotencyKey), (_created, original) => original),
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  const { session } = useAuth();
  return useMutation({ mutationFn: (id: string) => projectTransaction(client, session?.user.id, id,
    () => undefined, () => deleteProject(id), () => undefined) });
}
