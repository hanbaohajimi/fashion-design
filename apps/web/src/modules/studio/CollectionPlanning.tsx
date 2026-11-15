"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioSummary } from "@fashion/shared";
import { Button, Notice } from "../../components/ui";
import { DraftScopeProvider } from "../../components/drafts/use-persistent-draft";
import { flushWorkspaceDrafts } from "../../components/drafts/draft-repository";
import { useAuth } from "../auth/AuthProvider";
import { fetchStudio } from "./studio-api";
import { PlanningBoard } from "./PlanningBoard";
import { StudioHeaderContext } from "./StudioPageHeader";
import { StudioAssetNames } from "./studio-object-context";

/** The planning tab uses the same documents and draft identity as the former page. */
export function CollectionPlanning({
  projectId,
  collectionId,
  canEdit,
  onDirty,
  onSaved,
}: {
  projectId: string;
  collectionId: string;
  canEdit: boolean;
  onDirty?: ((dirty: boolean) => void) | undefined;
  onSaved?: (() => Promise<unknown>) | undefined;
}) {
  const { session } = useAuth();
  const [data, setData] = useState<StudioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const scope = useMemo(
    () =>
      session
        ? {
            accountId: session.user.id,
            projectId,
            editor: "studio:planning",
          }
        : null,
    [session, projectId],
  );
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await fetchStudio(projectId, controller.signal);
      if (controller.signal.aborted) return false;
      setData(next);
      setError(null);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "款式规划读取失败，请重试。",
        );
      return false;
    }
  }, [projectId]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void reload();
    });
    return () => {
      cancelAnimationFrame(frame);
      request.current?.abort();
    };
  }, [reload]);
  const reportDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
      onDirty?.(value);
    },
    [onDirty],
  );
  const beforeChange = async () => {
    try {
      await flushWorkspaceDrafts();
    } catch {
      setError("草稿暂未写入本机，请稍后重试切换资料。");
      return false;
    }
    return (
      !dirty.current ||
      window.confirm("当前修改已保留为本机草稿，切换到其他款式位置？")
    );
  };
  const editable = canEdit && Boolean(data?.capabilities.edit);
  return (
    <>
      {error ? (
        <Notice tone="error">
          {error}
          <Button onClick={() => void reload()}>重新读取规划</Button>
        </Notice>
      ) : null}
      {!data && !error ? <p role="status">正在读取款式规划…</p> : null}
      {data ? (
        <DraftScopeProvider scope={scope}>
          <StudioHeaderContext
            value={{ actions: null, readOnly: !editable, embedded: true }}
          >
            <StudioAssetNames data={data}>
              <PlanningBoard
                key={collectionId}
                projectId={projectId}
                data={data}
                collectionId={collectionId}
                canEdit={editable}
                onDirty={reportDirty}
              onSaved={async () => { await reload(); await onSaved?.(); }}
                beforeChange={beforeChange}
              />
            </StudioAssetNames>
          </StudioHeaderContext>
        </DraftScopeProvider>
      ) : null}
    </>
  );
}
