import type {
  CanvasCommand,
  CanvasDocumentView,
  CanvasSave,
} from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import type { WorkflowGraph } from "./workflow-api";

export class CanvasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function isRejectedCanvasCommand(error: unknown): boolean {
  return error instanceof CanvasApiError && [400, 403, 404, 422].includes(error.status);
}
async function request<T>(
  projectId: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/canvas${path}`,
    {
      method,
      credentials: "include",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  if (!response.ok) {
    const value = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new CanvasApiError(
      value.message ?? "白板操作未完成，请重试",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export const initializeCanvas = (projectId: string) =>
  request<CanvasDocumentView>(projectId, "/initialize", "POST");
export const fetchCanvas = (projectId: string) =>
  request<CanvasDocumentView>(projectId, "", "GET");
export const saveCanvas = (projectId: string, input: CanvasSave) =>
  request<CanvasDocumentView>(projectId, "", "PATCH", input);
export const runCanvasCommand = (projectId: string, input: CanvasCommand) =>
  request<{ nodeId: string; graph: WorkflowGraph; canvas: CanvasDocumentView }>(
    projectId,
    "/commands",
    "POST",
    input,
  );
