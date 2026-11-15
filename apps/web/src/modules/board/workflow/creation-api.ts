import type { CanvasCreation, CreateCanvasCreationInput, RunCanvasCreationInput, UpdateCanvasCreationInput } from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import { CanvasApiError } from "./canvas-api";

async function request<T>(projectId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await privateFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/creations${path}`, {
    method, cache: "no-store", credentials: "include", ...(signal ? { signal } : {}),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new CanvasApiError(error.message ?? "创作操作未完成，请重试", response.status);
  }
  return response.json() as Promise<T>;
}
export const fetchCreations = async (projectId: string, signal?: AbortSignal) => {
  const result = await request<{ items: CanvasCreation[]; canEdit: boolean }>(projectId, "", "GET", undefined, signal);
  if (!Array.isArray(result.items) || typeof result.canEdit !== "boolean") throw new CanvasApiError("创作记录暂时无法读取，请重试", 502);
  return result;
};
export const createCreation = (projectId: string, input: CreateCanvasCreationInput) => request<CanvasCreation>(projectId, "", "POST", input);
export const updateCreation = (projectId: string, id: string, input: UpdateCanvasCreationInput) => request<CanvasCreation>(projectId, `/${encodeURIComponent(id)}`, "PATCH", input);
export const runCreation = (projectId: string, id: string, input: RunCanvasCreationInput) => request<CanvasCreation>(projectId, `/${encodeURIComponent(id)}/runs`, "POST", input);
