"use client";

import { useState } from "react";
import type { StudioSummary } from "@fashion/shared";
import {
  CollectionDrawer,
  type CollectionTab,
} from "../board/generation/CollectionDrawer";
import { WorkflowProjectPanels } from "../board/workflow/WorkflowProjectPanels";
import { flushWorkspaceDrafts } from "../../components/drafts/draft-repository";
import { Button, Notice } from "../../components/ui";
import { BoardProjectContext } from "../board/board-context";
import { GenerationWorkspace } from "../board/generation/GenerationWorkspace";

/** A single selected series owns its direction, planning and generated looks. */
export function CollectionWorkbench({
  projectId,
  data,
  canEdit,
  initialCollectionId,
  initialTab = "dna",
  sourceAssetId,
  onDirty,
  beforeChange,
  onCollection,
  onRecord,
  onSaved,
}: {
  projectId: string;
  data: StudioSummary;
  canEdit: boolean;
  initialCollectionId?: string | undefined;
  initialTab?: CollectionTab;
  sourceAssetId?: string | undefined;
  onDirty: (dirty: boolean) => void;
  beforeChange: () => Promise<boolean>;
  onCollection?: ((id: string) => void) | undefined;
  onRecord?: ((id: string) => void | Promise<void>) | undefined;
  onSaved?: (() => Promise<unknown>) | undefined;
}) {
  const [collectionId, setCollectionId] = useState<string | null>(() => {
    if (initialCollectionId) return initialCollectionId;
    if (sourceAssetId) return null;
    const planned = data.slots[0]?.currentRevision.payload;
    const plannedId =
      planned && "collectionId" in planned ? planned.collectionId : undefined;
    return (
      (initialTab === "planning" ? plannedId : undefined) ??
      data.collections[0]?.id ??
      null
    );
  });
  const [error, setError] = useState<string | null>(null);
  const switchCollection = async () => {
    try {
      await flushWorkspaceDrafts();
      if (await beforeChange()) {
        setCollectionId(null);
        setError(null);
      }
    } catch {
      setError("当前修改尚未保存，请重试切换系列。");
    }
  };
  return (
    <BoardProjectContext.Provider value={projectId}>
      <GenerationWorkspace>
        {error ? (
          <Notice tone="error">
            {error}
            <Button onClick={() => void switchCollection()}>
              重试切换系列
            </Button>
          </Notice>
        ) : null}
        {collectionId ? (
          <CollectionDrawer
            key={collectionId}
            embedded
            collectionId={collectionId}
            canEdit={canEdit}
            initialTab={initialTab}
            onDirty={onDirty}
            onPlanningSaved={onSaved}
            onClose={() => void switchCollection()}
            onRecord={() => onRecord?.(collectionId)}
          />
        ) : (
          <WorkflowProjectPanels
            embedded
            hideTrigger
            projectId={projectId}
            canEdit={canEdit}
            initialHeroAssetId={sourceAssetId ?? data.assets[0]?.id}
            initialHeroLabel={
              sourceAssetId ? "以所选图片建立系列" : "用第一张设计图建立系列"
            }
            collectionsOpen
            onCollection={(id) => {
              setCollectionId(id);
              onCollection?.(id);
            }}
          />
        )}
      </GenerationWorkspace>
    </BoardProjectContext.Provider>
  );
}
