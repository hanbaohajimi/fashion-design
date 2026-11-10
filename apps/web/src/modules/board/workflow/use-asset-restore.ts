"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import {
  DraftConflict,
  draftRepository,
  type DraftRecord,
} from "../../../components/drafts/draft-repository";
import { restoreAssetVersion } from "../generation/generation-api";
import { fetchWorkflow, type WorkflowGraph } from "./workflow-api";
import { imageRequest } from "./image-workspace-api";

export interface PendingAssetRestore {
  readonly currentAssetId: string;
  readonly sourceNodeId?: string;
  readonly targetAssetId: string;
  readonly requestId: string;
  readonly mutationId: string;
}

export interface AssetRestoreResult {
  assetId: string;
  graph: WorkflowGraph;
}
interface RestoreState {
  key: string;
  pending: PendingAssetRestore | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
}
const initial: RestoreState = {
  key: "",
  pending: null,
  ready: false,
  busy: false,
  error: null,
};

function validRequest(
  value: unknown,
  assetId: string,
): value is PendingAssetRestore {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<PendingAssetRestore>;
  return (
    request.currentAssetId === assetId &&
    (request.sourceNodeId === undefined ||
      (typeof request.sourceNodeId === "string" &&
        request.sourceNodeId.length > 0)) &&
    [request.targetAssetId, request.requestId, request.mutationId].every(
      (item) => typeof item === "string" && item.length > 0,
    )
  );
}

/** Save both idempotency keys before either mutation; reload never resends automatically. */
export function useAssetRestore(projectId: string, assetId: string) {
  const scope = useDraftScope();
  const accountId = scope?.accountId;
  const key = accountId
    ? JSON.stringify([
        accountId,
        projectId,
        scope?.editor,
        `asset-restore:${assetId}`,
      ])
    : "";
  const activeKey = useRef<string | null>(null);
  const flights = useRef(new Map<string, Promise<AssetRestoreResult>>());
  const [state, setState] = useState<RestoreState>(initial);

  const read = useCallback(async (): Promise<
    DraftRecord<PendingAssetRestore> | undefined
  > => {
    if (!key) throw new Error("账号尚未就绪，请稍后再试");
    const record = await draftRepository.read<PendingAssetRestore>(key);
    if (record && !validRequest(record.value, assetId))
      throw new Error("本机恢复记录无法读取，请保留当前页面并联系管理员");
    return record;
  }, [assetId, key]);

  const reload = useCallback(async () => {
    try {
      const record = await read();
      if (activeKey.current === key && !flights.current.has(key))
        setState({
          key,
          pending: record?.value ?? null,
          ready: true,
          busy: false,
          error: null,
        });
    } catch (cause) {
      if (activeKey.current === key)
        setState({
          ...initial,
          key,
          error:
            cause instanceof Error
              ? cause.message
              : "本机恢复记录读取失败，请重试",
        });
    }
  }, [key, read]);

  useEffect(() => {
    activeKey.current = key;
    void reload();
    return () => {
      if (activeKey.current === key) activeKey.current = null;
    };
  }, [key, reload]);

  const restore = useCallback(
    (targetAssetId?: string): Promise<AssetRestoreResult> => {
      const existing = flights.current.get(key);
      if (existing) return existing;
      if (activeKey.current === key)
        setState((previous) => ({
          ...(previous.key === key ? previous : initial),
          key,
          busy: true,
          error: null,
        }));
      const work = (async () => {
        try {
          if (!accountId) throw new Error("账号尚未就绪，请稍后再试");
          if (activeKey.current !== key)
            throw new Error("工作区已切换，回到原图片可继续恢复");
          let record = await read();
          const existingRequest = record?.value;
          if (existingRequest && activeKey.current === key)
            setState((previous) => ({
              ...previous,
              key,
              pending: existingRequest,
              ready: true,
            }));
          if (
            record &&
            targetAssetId &&
            record.value.targetAssetId !== targetAssetId
          )
            throw new Error("上一项版本恢复尚未确认，请先继续原操作");
          let sourceNodeId = record?.value.sourceNodeId;
          if (!sourceNodeId) {
            const graph = await fetchWorkflow(projectId);
            const source = graph.nodes.find(
              (node) =>
                node.type === "candidate" && node.payload.assetId === assetId,
            );
            if (!source)
              throw new Error("原图片已不在画布中，暂时无法建立恢复分支");
            sourceNodeId = source.id;
          }
          if (activeKey.current !== key)
            throw new Error("工作区已切换，回到原图片可继续恢复");
          if (!record) {
            if (!targetAssetId || targetAssetId === assetId)
              throw new Error("请选择要恢复的历史版本");
            record = await draftRepository.write(
              {
                key,
                accountId,
                baseline: "null",
                value: {
                  currentAssetId: assetId,
                  sourceNodeId,
                  targetAssetId,
                  requestId: crypto.randomUUID(),
                  mutationId: crypto.randomUUID(),
                },
              },
              0,
            );
          } else if (!record.value.sourceNodeId) {
            // Upgrade an earlier local record without changing either admitted operation key.
            record = await draftRepository.write(
              {
                key,
                accountId,
                baseline: "null",
                value: { ...record.value, sourceNodeId },
              },
              record.revision,
            );
          }
          const request = record.value;
          if (activeKey.current === key)
            setState((previous) => ({
              ...previous,
              key,
              pending: request,
              ready: true,
            }));
          if (activeKey.current !== key)
            throw new Error("工作区已切换，回到原图片可继续恢复");
          const restored = await restoreAssetVersion(
            request.targetAssetId,
            request.currentAssetId,
            request.requestId,
          );
          if (activeKey.current !== key)
            throw new Error("工作区已切换，回到原图片可继续恢复");
          const result = await imageRequest<WorkflowGraph>(
            `/api/projects/${encodeURIComponent(projectId)}/workflow/import-asset`,
            "POST",
            {
              sourceNodeId,
              assetId: restored.id,
              operation: "restore",
              mutationId: request.mutationId,
            },
          );
          // Only clear this exact record. A lost response or a newer tab's record remains retryable.
          const removed = await draftRepository.remove(
            key,
            record.revision,
            request,
          );
          const next = removed ? null : ((await read())?.value ?? null);
          if (activeKey.current === key)
            setState((previous) => ({ ...previous, pending: next }));
          return { assetId: restored.id, graph: result };
        } catch (cause) {
          if (activeKey.current === key)
            setState((previous) => ({
              ...previous,
              ...(cause instanceof DraftConflict &&
              validRequest(cause.current.value, assetId)
                ? { pending: cause.current.value }
                : {}),
              error:
                cause instanceof DraftConflict
                  ? "另一页面有尚未确认的恢复，请继续原操作"
                  : cause instanceof Error
                    ? cause.message
                    : "版本恢复暂未完成，请重试原操作",
            }));
          throw cause;
        } finally {
          if (activeKey.current === key)
            setState((previous) => ({ ...previous, busy: false }));
        }
      })();
      flights.current.set(key, work);
      void work
        .finally(() => {
          if (flights.current.get(key) === work) flights.current.delete(key);
        })
        .catch(() => undefined);
      return work;
    },
    [accountId, assetId, key, projectId, read],
  );

  return { ...(state.key === key ? state : initial), reload, restore };
}
