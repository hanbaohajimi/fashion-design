import {
  createStudioStyleSchema,
  updateStudioStyleSchema,
  studioDocumentInputSchema,
  type StudioSummary,
  type StudioStyleInput,
  type StudioStyleView,
  type StudioDocumentInput,
  type StudioDocumentView,
  type StudioMemberView,
} from "@fashion/shared";
import { privateFetch } from "../auth/private-fetch";
import { readErrorMessage } from "../auth/auth-api";

export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}
function base(projectId: string) {
  return "/api/projects/" + encodeURIComponent(projectId) + "/studio";
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await privateFetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw new StudioApiError(
      await readErrorMessage(response, "工作室操作失败，请重试"),
      response.status,
    );
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function fetchStudio(projectId: string, signal?: AbortSignal) {
  return request<StudioSummary>(
    base(projectId),
    signal ? { signal } : undefined,
  );
}
export function saveStyle(
  projectId: string,
  payload: StudioStyleInput,
  requestKey: string,
  existing?: StudioStyleView,
) {
  const body = existing
    ? updateStudioStyleSchema.parse({
        ...payload,
        requestKey,
        expectedVersion: existing.version,
      })
    : createStudioStyleSchema.parse({ ...payload, requestKey });
  return request<StudioStyleView>(
    base(projectId) +
      "/styles" +
      (existing ? "/" + encodeURIComponent(existing.id) : ""),
    { method: existing ? "PATCH" : "POST", body: JSON.stringify(body) },
  );
}
export function saveStudioDocument(
  projectId: string,
  input: Omit<StudioDocumentInput, "requestKey">,
  requestKey: string,
  existing?: StudioDocumentView,
) {
  const body = studioDocumentInputSchema.parse({
    ...input,
    requestKey,
    ...(existing
      ? { documentId: existing.id, expectedVersion: existing.version }
      : {}),
  });
  return request<StudioDocumentView>(base(projectId) + "/documents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function saveMember(
  projectId: string,
  email: string,
  role: "EDITOR" | "REVIEWER" | "VIEWER",
  requestKey: string,
) {
  return request<StudioMemberView>(base(projectId) + "/members", {
    method: "POST",
    body: JSON.stringify({ email, role, requestKey }),
  });
}
export function updateMember(
  projectId: string,
  member: StudioMemberView,
  role: "EDITOR" | "REVIEWER" | "VIEWER",
  requestKey: string,
) {
  return request<StudioMemberView>(
    base(projectId) + "/members/" + encodeURIComponent(member.id),
    {
      method: "PATCH",
      body: JSON.stringify({
        role,
        expectedVersion: member.version,
        requestKey,
      }),
    },
  );
}
export function removeMember(
  projectId: string,
  member: StudioMemberView,
  requestKey: string,
) {
  return request<unknown>(
    base(projectId) + "/members/" + encodeURIComponent(member.id),
    {
      method: "DELETE",
      body: JSON.stringify({ expectedVersion: member.version, requestKey }),
    },
  );
}
export function techPackExportUrl(projectId: string, revisionId: string) {
  return (
    base(projectId) +
    "/tech-packs/" +
    encodeURIComponent(revisionId) +
    "/export"
  );
}

export function fetchBrandLibrary(projectId: string, signal?: AbortSignal) {
  return request<StudioDocumentView[]>(
    base(projectId) + "/brands/library",
    signal ? { signal } : undefined,
  );
}
export function importBrand(
  projectId: string,
  revisionId: string,
  requestKey: string,
) {
  return request<StudioDocumentView>(base(projectId) + "/brands/import", {
    method: "POST",
    body: JSON.stringify({ revisionId, requestKey }),
  });
}
