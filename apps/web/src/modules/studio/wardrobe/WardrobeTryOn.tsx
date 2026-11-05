"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OutfitSnapshotView, StudioSummary, WardrobeRevisionView, WardrobeSummary } from "@fashion/shared";
import { Button, Dialog, ImagePreview, Notice, SegmentedControl, UploadInput } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import { cancelGeneration } from "../../board/generation/generation-api";
import { AssetPicker } from "../studio-ui";
import { RealtimeTryOnPanel } from "../realtime-tryon/RealtimeTryOnPanel";
import { wardrobeApi } from "./wardrobe-api";
import { TASK_LABELS, type OutfitDraft } from "./wardrobe-state";
import { useRealtimeOutfit } from "./use-realtime-outfit";
import { addWardrobeResultToCanvas, uploadWardrobeModel } from "./wardrobe-assets";
import styles from "./wardrobe.module.css";

export function WardrobeTryOn({ projectId, assets, data, snapshot, draft, revisions, dirty, canEdit, onChanged, onDirty }: {
  projectId: string; assets: StudioSummary["assets"]; data: WardrobeSummary; snapshot: OutfitSnapshotView | null;
  dirty: boolean; canEdit: boolean; onChanged: () => Promise<void>; onDirty: (value: boolean) => void;
  draft: OutfitDraft; revisions: Map<string, WardrobeRevisionView>;
}) {
  const [mode, setMode] = useState<"model" | "self">("model");
  const [captureDirty, setCaptureDirty] = useState(false);
  const [requestedMode, setRequestedMode] = useState<"model" | "self" | null>(null);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<StudioSummary["assets"]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const upload = useRef<AbortController | null>(null);
  const packet = useRef<{ signature: string; key: string } | null>(null);
  const locked = useRef(false);
  const handleCaptureDirty = useCallback((value: boolean) => { setCaptureDirty(value); onDirty(value); }, [onDirty]);
  const changeMode = (value: "model" | "self") => {
    if (value === mode) return;
    if (mode === "self" && captureDirty) { setRequestedMode(value); return; }
    setMode(value);
  };
  useEffect(() => () => upload.current?.abort(), []);
  const requestKey = (signature: string) => { if (packet.current?.signature !== signature) packet.current = { signature, key: crypto.randomUUID() }; return packet.current.key; };
  const realtime = useRealtimeOutfit({ projectId, draft, revisions, base: snapshot, capabilities: data.capabilities, enabled: mode === "self" && canEdit });
  const run = async (action: () => Promise<void>) => {
    if (locked.current || !canEdit) return;
    locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(userFacingError(cause)); } finally { locked.current = false; setBusy(false); }
  };
  const history = [...data.tryOns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const snapshotById = new Map(data.outfits.flatMap(item => item.snapshots.map(version => [version.id, version] as const)));
  return <section className={styles.tryOnSection} aria-label="搭配试衣">
    <h3>查看上身效果</h3>
    <SegmentedControl label="试衣对象" value={mode} options={[{ value: "model", label: "在模特上试衣" }, { value: "self", label: "本人实时试衣" }]} onChange={changeMode} />
    {mode === "model" ? !snapshot ? <p className={styles.muted}>先保存搭配，再选择模特查看上身效果。</p> : <p className={styles.muted}>试衣依据：{snapshot.name} 版本 {snapshot.version}</p> : <p className={styles.muted}>使用当前完整搭配试穿。加减单品后自动更新参考，正式保存搭配仍需单独操作。</p>}
    {dirty && snapshot && mode === "model" ? <Notice>搭配已有未保存修改。下面的历史结果仍对应旧版本；保存新版本后再发起试衣。</Notice> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}
    {mode === "model" ? <>
      <AssetPicker assets={[...assets, ...uploaded.filter(item => !assets.some(asset => asset.id === item.id))]} selected={modelId ? [modelId] : []} onChange={ids => setModelId(ids[0] ?? "")} compact label="选择项目内的模特图片" disabled={!canEdit || busy} />
      <UploadInput label="上传模特图片" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || busy} hint="JPEG、PNG、WebP，最大 10 MB" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void run(async () => { upload.current?.abort(); const controller = new AbortController(); upload.current = controller; const asset = await uploadWardrobeModel(projectId, file, controller.signal); setUploaded(current => [...current, asset]); setModelId(asset.id); await onChanged(); }); }} />
      {!data.capabilities.staticTryOnEnabled ? <Notice>当前项目尚未启用模特试衣，可以继续编辑和保存搭配。</Notice> : <p className={styles.muted}>确认后创建图像生成任务并按项目规则计费。结果展示外观效果，不代表实际合体尺寸。</p>}
      <Button variant="primary" loading={busy} disabled={!canEdit || dirty || !snapshot || !modelId || !data.capabilities.staticTryOnEnabled} onClick={() => void run(async () => {
        if (!snapshot) return;
        await wardrobeApi.tryOn(projectId, snapshot.id, modelId, requestKey(`tryon:${snapshot.id}:${modelId}`)); packet.current = null; await onChanged();
      })}>{history.length ? "更新试穿" : "确认生成模特试衣图"}</Button>
    </> : <>
      {realtime.error ? <Notice tone="error">搭配参考更新失败：{realtime.error}<Button onClick={realtime.retry}>重试搭配更新</Button></Notice> : null}
      <RealtimeTryOnPanel projectId={projectId} assets={assets} canEdit={canEdit} embedded outfitSnapshot={realtime.snapshot} outfitUpdating={realtime.updating} wardrobeCapabilities={data.capabilities} onSaved={onChanged} onDirty={handleCaptureDirty} />
    </>}
    {history.length ? <section className={styles.history} aria-label="模特试衣历史"><h3>模特试衣历史</h3>{history.map(task => {
      const version = snapshotById.get(task.snapshotId);
      const old = task.snapshotId !== snapshot?.id || dirty;
      return <article className={styles.taskEntry} key={task.id}>
        <div className={styles.sectionHeader}><strong>{version?.name ?? "已保存搭配"}</strong><span>{TASK_LABELS[task.status]}</span></div>
        <p className={styles.muted}>{version ? `版本 ${version.version}` : "历史版本"}{old ? "，与当前编辑内容不同" : "，当前版本"}</p>
        {task.error ? <Notice tone="error">{task.error}</Notice> : null}
        {task.status === "queued" || task.status === "running" ? <><p role="status">任务进行中，可以继续浏览衣架。</p>{task.taskId ? <Button disabled={!canEdit || busy} onClick={() => void run(async () => { if (!task.taskId) return; await cancelGeneration(task.taskId); await onChanged(); })}>取消试衣任务</Button> : null}</> : null}
        {task.results.map(result => <figure key={result.assetId} className={styles.resultImage}><ImagePreview src={result.url} alt={`${version?.name ?? "搭配"}模特试衣结果`} /><figcaption>保存在当前项目的试衣结果</figcaption><Button disabled={!canEdit || busy || added.includes(result.assetId)} onClick={() => void run(async () => { await addWardrobeResultToCanvas(projectId, result, task.snapshotId); setAdded(current => [...current, result.assetId]); await onChanged(); })}>{added.includes(result.assetId) ? "已加入工作台" : "加入工作台"}</Button></figure>)}
        {task.status === "failed" || task.status === "canceled" ? <Button disabled={!canEdit || busy || !data.capabilities.staticTryOnEnabled} onClick={() => void run(async () => { await wardrobeApi.tryOn(projectId, task.snapshotId, task.modelAssetId); await onChanged(); })}>按此版本重新生成</Button> : null}
      </article>;
    })}</section> : null}
    {requestedMode ? <Dialog label="切换试衣对象前处理截图" className={styles.confirmDialog} onClose={() => setRequestedMode(null)}>
      <h3>这帧截图尚未保存</h3><p>切换试衣对象会结束本人试穿，并丢失尚未保存的截图。可以返回重试保存，或明确放弃这帧截图后切换。</p>
      <div className={styles.actions}><Button variant="primary" onClick={() => setRequestedMode(null)}>返回保存截图</Button><Button variant="danger" onClick={() => { const next = requestedMode; setRequestedMode(null); handleCaptureDirty(false); setMode(next); }}>放弃截图并切换</Button></div>
    </Dialog> : null}
  </section>;
}
