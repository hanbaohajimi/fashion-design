"use client";
/* eslint-disable @next/next/no-img-element -- Project images use private, expiring URLs. */

import { useCallback, useEffect, useState } from "react";
import type { CanvasCreation, StudioSummary } from "@fashion/shared";
import { DraftScopeProvider, useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { flushWorkspaceDrafts } from "../../../components/drafts/draft-repository";
import { fetchStudio } from "../../studio/studio-api";
import { ExperimentPanel } from "../../studio/ExperimentPanel";
import { PrintWorkbench } from "../../studio/PrintWorkbench";
import { PresentationSets } from "../../studio/PresentationSets";
import { TrendBriefPanel } from "../../studio/TrendBriefPanel";
import { WorkflowDialog } from "./WorkflowDialog";
import { creationCatalog } from "./creation-catalog";
import styles from "./creation-workspace.module.css";
import type { ImageToolEntry } from "./image-tool-entry";
import { completeUpload, putOriginal, signImageUpload, validateImage, waitForThumbnail } from "../file-upload-api";
import { importDesignAsset } from "../generation/collection-api";
import { CollectionWorkbench } from "../../studio/CollectionWorkbench";

/** Domain forms keep their own records and task lifecycles inside the canvas shell. */
export function CanvasModuleWorkspace({ projectId, entryId, sourceAssetId, canEdit, onClose, onGraphChange, creation, onRecord, onContinue, onChooseImage }: {
  projectId: string; entryId: string; sourceAssetId: string | undefined; canEdit: boolean; onClose: () => void; onGraphChange: () => Promise<void>; creation?: CanvasCreation | undefined;
  onRecord?: ((resource: NonNullable<CanvasCreation["resource"]>) => Promise<void>) | undefined;
  onContinue?: ((nodeIds: readonly string[]) => void | Promise<void>) | undefined;
  onChooseImage?: ((assetId: string, action: ImageToolEntry) => Promise<void>) | undefined;
}) {
  const scope = useDraftScope();
  const [data, setData] = useState<StudioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presentationMode, setPresentationMode] = useState<"sets" | "generate">(sourceAssetId && !creation?.resource ? "generate" : "sets");
  const [dirty, setDirty] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<NonNullable<CanvasCreation["resource"]> | null>(null);
  const [openingImage, setOpeningImage] = useState(false);
  const linkRecord = async (resource: NonNullable<CanvasCreation["resource"]>) => {
    setPendingRecord(resource);
    try { await onRecord?.(resource); setPendingRecord(null); setError(null); }
    catch { setError("资料已保存，画布记录尚未关联，请重试关联。"); }
  };
  const entry = creationCatalog.find((item) => item.id === entryId);
  const reload = useCallback(async () => {
    try { setData(await fetchStudio(projectId)); setError(null); await onGraphChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "功能资料载入失败"); }
  }, [projectId, onGraphChange]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchStudio(projectId, controller.signal).then(setData).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "功能资料载入失败"); });
    return () => controller.abort();
  }, [projectId]);
  const close = () => {
    if (entry?.module !== "collections") { onClose(); return; }
    void flushWorkspaceDrafts().then(onClose).catch(() => setError("当前修改尚未保存，请重试返回画布。"));
  };
  const beforeChange = async () => {
    if (entry?.module === "collections") await flushWorkspaceDrafts();
    return !dirty || window.confirm("当前编辑已保留为本机草稿，切换到其他记录？");
  };
  const editable = canEdit && Boolean(data?.capabilities.edit);
  return <WorkflowDialog label={entry?.title ?? "创作功能"} onClose={close}><DraftScopeProvider scope={scope ? { ...scope, editor: `canvas-module:${creation?.id ?? entryId}:${sourceAssetId ?? "independent"}` } : null}>
    <section className={styles.module} data-canvas-panel={entryId}>
      <header className={styles.moduleHeader}><h2>{entry?.title}</h2><button type="button" onClick={close}>返回画布</button></header>
      <div className={styles.moduleBody}>
        {error ? <p role="alert">{error}<button type="button" onClick={() => { if (pendingRecord) void linkRecord(pendingRecord); else void reload(); }}>重试</button></p> : null}
        {!data && !error ? <p role="status">正在载入功能资料…</p> : null}
        {data && entry?.module === "collections" ? <CollectionWorkbench projectId={projectId} data={data} canEdit={editable}
          initialCollectionId={creation?.resource?.kind === "collection" ? creation.resource.id : undefined}
          sourceAssetId={sourceAssetId} onDirty={setDirty} beforeChange={beforeChange} onSaved={reload}
          onCollection={(id) => { void linkRecord({ kind: "collection", id }); }}
          onRecord={(id) => linkRecord({ kind: "collection", id })} /> : null}
        {data && entry?.imageAction ? <section aria-label="选择工具输入图片">
          <label>上传图片<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!editable || openingImage} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file || !entry.imageAction) return;
            const action = entry.imageAction; setOpeningImage(true); setError(null);
            void (async () => {
              const error = validateImage(file); if (error) throw new Error(error);
              const signed = await signImageUpload(projectId, file);
              const uploaded = signed.upload ? await putOriginal(signed.upload, file).then(() => completeUpload(signed.file.id)) : signed.file;
              await waitForThumbnail(signed.file.id, uploaded);
              const asset = await importDesignAsset(projectId, signed.file.id);
              await onChooseImage?.(asset.id, action);
            })().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "图片导入失败")).finally(() => setOpeningImage(false));
          }} /></label>
          <h3>项目中的图片</h3><div className={styles.assetPicker}>{data.assets.map((asset, index) => <button key={asset.id} type="button" disabled={!editable || openingImage} onClick={() => {
            if (!entry.imageAction) return; setOpeningImage(true); setError(null);
            void onChooseImage?.(asset.id, entry.imageAction).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "图片打开失败")).finally(() => setOpeningImage(false));
          }}><img src={asset.thumbnailUrl ?? asset.url} alt={`图片${index + 1}`} loading="lazy" /><span>图片{index + 1}</span></button>)}</div>
        </section> : null}
        {data && entry?.module === "experiments" ? <ExperimentPanel requireExplicitSource projectId={projectId} assets={data.assets} styles={data.styles} canEdit={editable} initialMode={entry.mode ?? "color"} {...(sourceAssetId ? { initialSourceAssetId: sourceAssetId } : {})} {...(creation?.resource?.kind === "experiment" ? { initialBatchId: creation.resource.id } : {})} onRecord={(batch) => linkRecord({ kind: "experiment", id: batch.id })} onRefresh={() => void reload()} onDirty={setDirty} /> : null}
        {data && entry?.module === "patterns" ? <PrintWorkbench requireExplicitSource projectId={projectId} assets={data.assets} documents={data.patterns} canEdit={editable} {...(sourceAssetId ? { initialSourceAssetId: sourceAssetId } : {})} {...(creation?.resource?.kind === "pattern" ? { initialDocumentId: creation.resource.id } : {})} onRecord={(document) => linkRecord({ kind: "pattern", id: document.currentRevision.id })} onRefresh={() => void reload()} onDirty={setDirty} beforeChange={beforeChange} /> : null}
        {data && entry?.module === "trends" ? <TrendBriefPanel projectId={projectId} brands={data.brandProfiles} canEdit={editable} onDirty={setDirty} onRecord={(nodeId) => linkRecord({ kind: "trend", id: nodeId })} {...(onContinue ? { onContinue } : {})} /> : null}
        {data && entry?.module === "presentation" ? <>
          <nav aria-label="商品展示模式"><button type="button" aria-pressed={presentationMode === "sets"} onClick={() => setPresentationMode("sets")}>展示包</button><button type="button" aria-pressed={presentationMode === "generate"} onClick={() => setPresentationMode("generate")}>生成展示图</button></nav>
          {presentationMode === "sets" ? <PresentationSets projectId={projectId} data={data} {...(creation?.resource?.kind === "presentation" ? { initialDocumentId: data.presentationSets.find((document) => document.id === creation.resource?.id || document.revisions.some((revision) => revision.id === creation.resource?.id))?.id, initialDocumentRevisionId: creation.resource.id } : {})} canEdit={editable} onDirty={setDirty} onSaved={reload} beforeChange={beforeChange} onDocumentSaved={(document) => { void linkRecord({ kind: "presentation", id: document.currentRevision.id }); }} onGenerate={() => setPresentationMode("generate")} /> : <ExperimentPanel requireExplicitSource projectId={projectId} assets={data.assets} styles={data.styles} canEdit={editable} initialMode="presentation" {...(sourceAssetId ? { initialSourceAssetId: sourceAssetId } : {})} onRecord={(batch) => linkRecord({ kind: "experiment", id: batch.id })} onRefresh={() => void reload()} onDirty={setDirty} />}
        </> : null}
      </div>
    </section>
  </DraftScopeProvider></WorkflowDialog>;
}
