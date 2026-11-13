import { privateFetch } from "../auth/private-fetch";

export interface StudioShareCreateResult {
  readonly expiresAt: string;
  readonly id: string;
  readonly path: string;
  readonly revisionId: string;
  readonly targetType: "STYLE" | "TECH_PACK";
}
export interface StudioShareRecord {
  readonly createdAt: string;
  readonly expired: boolean;
  readonly expiresAt: string;
  readonly id: string;
  readonly revokedAt: string | null;
  readonly studioDocumentId: string | null;
  readonly styleRevisionId: string | null;
  readonly targetType: "STYLE" | "TECH_PACK";
}

export async function createStudioShare(
  projectId: string,
  targetType: "STYLE" | "TECH_PACK",
  revisionId: string,
): Promise<StudioShareCreateResult> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/studio/shares`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, revisionId }),
    },
  );
  if (!response.ok) throw new Error("评审链接创建失败，请稍后重试");
  return (await response.json()) as StudioShareCreateResult;
}

export async function fetchStudioShares(projectId: string): Promise<readonly StudioShareRecord[]> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/studio/shares`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) throw new Error("评审链接读取失败，请稍后重试");
  return (await response.json()) as readonly StudioShareRecord[];
}

export async function revokeStudioShare(projectId: string, shareId: string): Promise<void> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/studio/shares/${encodeURIComponent(shareId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) throw new Error("评审链接撤销失败，请稍后重试");
}

export async function rotateStudioShare(projectId: string, shareId: string): Promise<StudioShareCreateResult> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/studio/shares/${encodeURIComponent(shareId)}/rotate`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error("评审链接生成失败，请稍后重试");
  return (await response.json()) as StudioShareCreateResult;
}

