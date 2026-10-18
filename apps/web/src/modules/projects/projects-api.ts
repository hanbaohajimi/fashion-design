import { readErrorMessage } from "../auth/auth-api";
import type {
  Project,
  ProjectPage,
  ProjectStatusFilter,
} from "./project-types";

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "项目操作失败，请重试"));
  }

  return (await response.json()) as T;
}

export function fetchProjects(
  page: number,
  search: string,
  status: ProjectStatusFilter,
  signal?: AbortSignal,
): Promise<ProjectPage> {
  const params = new URLSearchParams({
    archived: status,
    limit: "50",
    page: String(page),
  });

  if (search) {
    params.set("search", search);
  }

  return requestJson<ProjectPage>(`/api/projects?${params.toString()}`, signal ? { signal } : undefined);
}

export function fetchProject(projectId: string): Promise<Project> {
  return requestJson<Project>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      cache: "no-store",
    },
  );
}

export function createProject(
  name: string,
  idempotencyKey: string,
): Promise<Project> {
  return requestJson<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
  });
}

export function updateProject(
  projectId: string,
  input: { readonly archived?: boolean; readonly name?: string },
): Promise<Project> {
  return requestJson<Project>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function duplicateProject(
  projectId: string,
  idempotencyKey: string,
): Promise<Project> {
  return requestJson<Project>(
    `/api/projects/${encodeURIComponent(projectId)}/duplicate`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "删除项目失败，请重试"));
  }
}
