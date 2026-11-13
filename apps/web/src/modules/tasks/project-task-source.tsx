"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ProjectTaskPage } from "@fashion/shared";
import { useAuth } from "../auth/AuthProvider";
import { privateFetch } from "../auth/private-fetch";

export async function taskRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await privateFetch(url, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) throw new Error("任务状态暂不可用，请重试");
  return response.json() as Promise<T>;
}

export async function fetchTaskPage(url: string, signal: AbortSignal): Promise<ProjectTaskPage> {
  const value = await taskRequest<ProjectTaskPage>(url, { signal });
  if (!value || !Array.isArray(value.items) || !value.counts || !Number.isInteger(value.counts.running) || !Number.isInteger(value.counts.attention)) throw new Error("任务状态响应无效，请重新读取");
  const activity = value.activity;
  if (activity && (![activity.preparing, activity.queued, activity.executing, activity.awaitingUser, activity.waiting?.input, activity.waiting?.confirmation, activity.waiting?.resume].every(count => Number.isInteger(count) && count >= 0) || !Array.isArray(activity.recent) || activity.recent.length > 20 || activity.recent.some(item => !item.id || !["assistant", "workflow", "generation", "agent", "export", "runway", "review"].includes(item.domain) || !["completed", "failed", "canceled"].includes(item.outcome) || !Number.isFinite(Date.parse(item.updatedAt))))) throw new Error("项目活动响应无效，请重新读取");
  return value;
}

type ProjectTaskSource = { projectId: string; summary: UseQueryResult<ProjectTaskPage, Error> };
const ProjectTasksContext = createContext<ProjectTaskSource | null>(null);

/** Exactly one polling observer per project surface; consumers only read context. */
export function ProjectTaskProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { session } = useAuth();
  const summary = useQuery({
    queryKey: ["project-tasks", session?.user.id, projectId, "active"],
    enabled: Boolean(session),
    queryFn: ({ signal }) => fetchTaskPage(`/api/projects/${encodeURIComponent(projectId)}/tasks?activity=1`, signal),
    refetchInterval: query => query.state.data?.counts.running ? 3000 : 15000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 3000,
  });
  return <ProjectTasksContext value={{ projectId, summary }}>{children}</ProjectTasksContext>;
}

export function useProjectTaskSource() { return useContext(ProjectTasksContext); }
