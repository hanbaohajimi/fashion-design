import type { TLEditorSnapshot, TLShape } from "tldraw";

import { readErrorMessage } from "../auth/auth-api";

export interface BoardElementRow {
  readonly deleted: boolean;
  readonly record: TLShape | null;
  readonly role: string;
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
      readonly shapeId: string;
      readonly shapeType: string;
    };

export interface BoardPatchPayload {
  readonly batchId: string;
  readonly patches: readonly BoardElementPatch[];
  readonly snapshot: TLEditorSnapshot;
}

export async function fetchBoard(projectId: string): Promise<BoardLoadResponse> {
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
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/board`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "画布保存失败"));
  }
}
