import { privateFetch as fetch } from "../auth/private-fetch";
import type { TLEditorSnapshot, TLShape } from "tldraw";
import type { BoardElementRole } from "@fashion/shared";

import { readErrorMessage } from "../auth/auth-api";

export interface BoardElementRow {
  readonly deleted: boolean;
  readonly record: TLShape | null;
  readonly role: string;
  readonly roleConfidence: number | null;
  readonly roleInferenceState: RoleInferenceResult["state"];
  readonly roleLabel: string | null;
  readonly roleSource: RoleInferenceResult["source"];
  readonly shapeId: string;
  readonly shapeType: string;
  readonly updatedAt: string;
}

export interface BoardLoadResponse {
  readonly elements: readonly BoardElementRow[];
  readonly revision: number;
  readonly snapshot: TLEditorSnapshot | null;
}

export type BoardElementPatch =
  | {
      readonly deleted: true;
      readonly shapeId: string;
    }
  | {
      readonly deleted: false;
      readonly record: TLShape;
      readonly role: string;
      readonly roleConfidence?: number | null;
      readonly roleInferenceState?: RoleInferenceResult["state"];
      readonly roleLabel?: string | null;
      readonly roleSource?: RoleInferenceResult["source"];
      readonly shapeId: string;
      readonly shapeType: string;
    };

export interface BoardPatchPayload {
  readonly baseRevision: number;
  readonly batchId: string;
  readonly patches: readonly BoardElementPatch[];
  readonly snapshot: TLEditorSnapshot;
}

export interface BoardPatchResponse {
  readonly batchId: string;
  readonly revision: number;
  readonly savedAt: string;
}

interface BoardErrorBody {
  readonly code?: string;
  readonly currentRevision?: number;
  readonly message?: string;
}

export class BoardApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly currentRevision: number | undefined,
  ) {
    super(message);
    this.name = "BoardApiError";
  }
}

async function boardApiError(
  response: Response,
  fallback: string,
): Promise<BoardApiError> {
  try {
    const body = (await response.json()) as BoardErrorBody;
    return new BoardApiError(
      body.message ?? fallback,
      body.code ?? "BOARD_REQUEST_FAILED",
      response.status,
      body.currentRevision,
    );
  } catch {
    return new BoardApiError(
      fallback,
      "BOARD_REQUEST_FAILED",
      response.status,
      undefined,
    );
  }
}

export interface RoleInferenceResult {
  readonly confidence: number | null;
  readonly label: string | null;
  readonly role: BoardElementRole;
  readonly shapeId: string;
  readonly source: "default" | "inferred" | "manual";
  readonly state: "none" | "pending" | "ready" | "failed";
}

export async function fetchBoard(
  projectId: string,
): Promise<BoardLoadResponse> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board`,
    {
      cache: "no-store",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "画布加载失败，请重试"));
  }

  return (await response.json()) as BoardLoadResponse;
}

export async function patchBoard(
  projectId: string,
  payload: BoardPatchPayload,
): Promise<BoardPatchResponse> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw await boardApiError(response, "画布保存失败");
  }

  return (await response.json()) as BoardPatchResponse;
}

export async function registerRoleInference(
  projectId: string,
  shapeId: string,
  fileId: string,
): Promise<RoleInferenceResult> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board-elements/${encodeURIComponent(shapeId)}/infer`,
    {
      method: "POST",
      body: JSON.stringify({ fileId }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "角色推断任务启动失败"));
  }
  return (await response.json()) as RoleInferenceResult;
}

export async function fetchElementRole(
  projectId: string,
  shapeId: string,
): Promise<RoleInferenceResult> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board-elements/${encodeURIComponent(shapeId)}/role`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "角色推断状态读取失败"));
  }
  return (await response.json()) as RoleInferenceResult;
}

export async function bindSketchReference(
  projectId: string,
  shapeId: string,
  input: {
    readonly fileId: string;
    readonly fingerprint: string;
    readonly record: TLShape;
  },
): Promise<RoleInferenceResult> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board-elements/${encodeURIComponent(shapeId)}/sketch-reference`,
    {
      method: "POST",
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "草图 AI 引用保存失败"));
  }
  return (await response.json()) as RoleInferenceResult;
}

export async function setElementRoles(
  projectId: string,
  shapeIds: readonly string[],
  role: BoardElementRole,
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board-elements/roles`,
    {
      method: "PATCH",
      body: JSON.stringify({ role, shapeIds }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "元素角色保存失败"));
  }
}
