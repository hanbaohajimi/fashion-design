"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioSummary, WardrobeCategory, WardrobeDisplay, WardrobeItemView, WardrobePreparationView, WardrobeSourceKind } from "@fashion/shared";
import { Button, Dialog, Field, ImagePreview, Input, Notice, Select, Textarea, UploadInput } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import { AssetPicker } from "../studio-ui";
import { cancelGeneration } from "../../board/generation/generation-api";
import { wardrobeApi } from "./wardrobe-api";
import { CATEGORY_LABELS, DEFAULT_DISPLAY, DISPLAY_LABELS, SOURCE_LABELS, TASK_LABELS } from "./wardrobe-state";
import { RegionSelector, type ImageRegion } from "./RegionSelector";
import { uploadWardrobeSource } from "./wardrobe-assets";
import { GarmentMountPreview } from "./GarmentMountPreview";
import { PrepareSideDisplay } from "./PrepareSideDisplay";
import { PreviewBackgroundControl, previewBackgroundStyle, type PreviewBackground } from "./PreviewBackground";
import { RepairTransparentMaterial } from "./RepairTransparentMaterial";
import { MaterialProcessingDetails } from "./MaterialProcessingDetails";
import styles from "./wardrobe.module.css";

const MOUNT_GUIDANCE: Record<WardrobeDisplay, string> = {
  hanger: "点击领口上缘中心；有帽时选帽子下的领口，不选帽顶。预览中木肩应被衣服遮住，木颈与领口衔接。",
  clips: "点击裤腰或裙腰上缘中心，让预览中的夹口贴住腰头。不要把图片顶部的透明留白当作挂点。",
  hook: "点击提手、挂环或肩带的实际承重点，让预览中的挂钩托住该处。",
  shelf: "点击鞋底或配饰底部的实际落点，避开透明留白。预览中底部应贴住托架，不能悬空或穿过托面。",
};

export function PrepareGarment({ projectId, assets, styles: projectStyles = [], preparations, canEdit, generationEnabled, initialAssetId, initialStyleRevisionId, existingItem, onChanged, onClose }: {
  projectId: string; assets: StudioSummary["assets"]; styles?: StudioSummary["styles"] | undefined;
  preparations: WardrobePreparationView[]; canEdit: boolean; generationEnabled: boolean;
  initialAssetId?: string | undefined; initialStyleRevisionId?: string | undefined;
  existingItem?: WardrobeItemView | null | undefined;
  onChanged: () => Promise<void>; onClose: () => void;
}) {
  const existing = existingItem?.currentRevision;
  const [editingSide, setEditingSide] = useState(false);
  const [uploaded, setUploaded] = useState<StudioSummary["assets"]>([]);
  const projectAssets = [...assets, ...uploaded.filter(asset => !assets.some(current => current.id === asset.id))];
  const allAssets = existing && !projectAssets.some(asset => asset.id === existing.assetId) ? [...projectAssets, { id: existing.assetId, url: existing.url, thumbnailUrl: null }] : projectAssets;
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const [sourceId, setSourceId] = useState(existing?.assetId ?? initialAssetId ?? projectStyles.flatMap(style => style.revisions).find(revision => revision.id === initialStyleRevisionId)?.views[0]?.assetId ?? "");
  const [styleRevisionId, setStyleRevisionId] = useState(initialStyleRevisionId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<WardrobeCategory>(existing?.category ?? "top");
  const [sourceKind, setSourceKind] = useState<WardrobeSourceKind>("isolated");
  const [mode, setMode] = useState<"existing" | "extract" | "complete">("existing");
  const [notes, setNotes] = useState("");
  const [references, setReferences] = useState<string[]>([]);
  const [region, setRegion] = useState<ImageRegion | null>(null);
  const [preparationId, setPreparationId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [display, setDisplay] = useState<WardrobeDisplay>(existing?.display ?? "hanger");
  const [anchor, setAnchor] = useState(existing?.anchor ?? { x: 0.5, y: 0.08 });
  const [reviewed, setReviewed] = useState(false);
  const [background, setBackground] = useState<PreviewBackground>("scene");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const packet = useRef<{ signature: string; key: string } | null>(null);
  const [immediate, setImmediate] = useState<WardrobePreparationView | null>(null);
  const preparation = preparations.find(item => item.id === preparationId) ?? immediate;
  const comparisonSourceId = preparation?.materialProcessing?.sourceAssetId ?? preparation?.sourceAssetId ?? sourceId;
  const source = allAssets.find(asset => asset.id === comparisonSourceId) ?? (preparation ? { id: comparisonSourceId, url: `/api/design-assets/${encodeURIComponent(comparisonSourceId)}/content` } : undefined);
  const selectedSource = allAssets.find(asset => asset.id === sourceId);
  const candidate = preparation?.candidates.find(item => item.assetId === candidateId) ?? preparation?.candidates[0];
  const run = async (action: () => Promise<void>) => {
    if (locked.current || !canEdit) return;
    locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(userFacingError(cause)); } finally { locked.current = false; setBusy(false); }
  };
  const prepare = () => run(async () => {
    if (!sourceId || !name.trim()) throw new Error("请先选择来源图片并填写单品名称。");
    if (region && (region.width < 0.01 || region.height < 0.01)) throw new Error("框选范围过小，请重新选择完整单品。");
    const input = { sourceAssetId: sourceId, name, category, sourceKind, mode, referenceAssetIds: references, notes, ...(styleRevisionId ? { styleRevisionId } : {}), ...(region ? { region } : {}) };
    const signature = JSON.stringify(input);
    if (packet.current?.signature !== signature) packet.current = { signature, key: crypto.randomUUID() };
    const result = await wardrobeApi.prepare(projectId, { ...input, requestKey: packet.current.key });
    setImmediate(result); setPreparationId(result.id); setCandidateId(null); setReviewed(false); packet.current = null;
    await onChanged();
  });
  const choosePreparation = (item: WardrobePreparationView) => {
    setPreparationId(item.id); setImmediate(item); setSourceId(item.sourceAssetId); setName(item.name); setCategory(item.category); setSourceKind(item.sourceKind);
    setDisplay(DEFAULT_DISPLAY[item.category]); setCandidateId(null); setReviewed(false); setAnchor({ x: 0.5, y: 0.08 });
  };
  const confirm = () => run(async () => {
    if (!preparation || !candidate || !reviewed) return;
    const input = { preparationId: preparation.id, assetId: candidate.assetId, name, category, display, anchor, reviewed: true as const, ...(existingItem ? { itemId: existingItem.id, expectedVersion: existingItem.version } : {}) };
    const signature = JSON.stringify(input);
    if (packet.current?.signature !== signature) packet.current = { signature, key: crypto.randomUUID() };
    await wardrobeApi.confirm(projectId, { ...input, requestKey: packet.current.key });
    packet.current = null; await onChanged(); onClose();
  });
  if (editingSide && existingItem) return <PrepareSideDisplay projectId={projectId} item={existingItem} preparations={preparations} canEdit={canEdit} generationEnabled={generationEnabled} onChanged={onChanged} onClose={() => setEditingSide(false)} onSaved={onClose} />;
  return <Dialog label="准备衣架单品" onClose={onClose} className={styles.prepareDialog} busy={busy}>
    <header className={styles.sectionHeader}><h2>{existingItem ? "准备单品新修订" : "准备单品"}</h2><Button onClick={onClose}>关闭</Button></header>
    {existingItem ? <p className={styles.muted}>当前修订 {existingItem.version}。确认后创建新修订，已有搭配仍保留原来的单品版本。</p> : null}
    {existingItem ? <Button disabled={!canEdit || busy} onClick={() => setEditingSide(true)}>准备侧挂图与挂具宽度</Button> : null}
    {!preparation && existing?.materialProcessing ? <MaterialProcessingDetails processing={existing.materialProcessing} /> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}
    {preparation ? <div className={styles.stack}>
      <div className={styles.sectionHeader}><h3>{preparation.name}</h3><span role="status">{TASK_LABELS[preparation.status]}</span></div>
      {preparation.error ? <Notice tone="error">{preparation.error}</Notice> : null}
      {preparation.status === "queued" || preparation.status === "running" ? <><p>单品候选正在准备。可以关闭窗口，任务会保留在项目中。</p>{preparation.taskId ? <Button disabled={!canEdit} loading={busy} onClick={() => void run(async () => { if (!preparation.taskId) return; await cancelGeneration(preparation.taskId); await onChanged(); })}>取消准备</Button> : null}</> : null}
      {preparation.status === "ready" && candidate ? <>
        {preparation.materialProcessing ? <MaterialProcessingDetails processing={preparation.materialProcessing} /> : null}
        <p>逐项对照原图，检查轮廓、印花、颜色和被遮挡部位。候选不会自动进入衣架。</p>
        <PreviewBackgroundControl value={background} onChange={setBackground} />
        <div className={styles.comparison}>
          <figure><figcaption>来源图片</figcaption><div className={styles.compareImage} data-preview-background={background} style={previewBackgroundStyle(background)}><ImagePreview src={source?.url} alt="原始服装图片" /></div></figure>
          <figure><figcaption>待确认单品</figcaption><div className={styles.anchorStage} data-preview-background={background} style={previewBackgroundStyle(background)} onClick={event => {
            const box = event.currentTarget.getBoundingClientRect();
            setAnchor({ x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }); setReviewed(false);
          }}><ImagePreview src={candidate.url} alt="待确认单品候选" retryable={false} /><span className={styles.anchorPoint} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} aria-hidden="true" /></div></figure>
        </div>
        {preparation.candidates.length > 1 ? <Field label="候选图片"><Select value={candidate.assetId} onChange={event => { setCandidateId(event.target.value); setReviewed(false); }}>{preparation.candidates.map((item, index) => <option key={item.assetId} value={item.assetId}>候选 {index + 1}</option>)}</Select></Field> : null}
        <div className={styles.formRow}><Field label="单品名称"><Input value={name} maxLength={120} onChange={event => { setName(event.target.value); setReviewed(false); }} /></Field><Field label="挂具"><Select value={display} onChange={event => { setDisplay(event.target.value as WardrobeDisplay); setReviewed(false); }}>{Object.entries(DISPLAY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div>
        <p className={styles.muted}>点击候选图片设置挂点。{MOUNT_GUIDANCE[display]}</p>
        <div className={styles.formRow}>{(["x", "y"] as const).map(key => <Field key={key} label={`挂点${key === "x" ? "横向" : "纵向"} %`}><Input type="number" min={0} max={100} step={0.1} value={Number((anchor[key] * 100).toFixed(2))} onChange={event => { setAnchor({ ...anchor, [key]: Math.max(0, Math.min(1, Number(event.target.value) / 100)) }); setReviewed(false); }} /></Field>)}</div>
        <GarmentMountPreview projectId={projectId} background={background} item={{ category, display, anchor, url: candidate.url, name, assetId: candidate.assetId, ...(candidate.imageBounds ? { imageBounds: candidate.imageBounds } : {}) }} />
        {!preparation.presentation ? (["transparency", "correction"] as const).map(operation => <RepairTransparentMaterial key={`${projectId}:${candidate.assetId}:${operation}`} operation={operation} projectId={projectId} source={{ assetId: candidate.assetId, url: candidate.url, name, category, imageBounds: candidate.imageBounds }} canEdit={canEdit} generationEnabled={generationEnabled} onPrepared={value => {
          setImmediate(value); setPreparationId(value.id); setCandidateId(null); setReviewed(false); setSourceId(value.sourceAssetId);
          void onChanged().catch(cause => setError(userFacingError(cause)));
        }} />) : null}
        {preparation.mode === "complete" ? <Notice>{preparation.sourceKind === "sketch" ? "这张写实单品候选根据草图生成。请人工核对面料材质、颜色、印花，以及草图未说明的结构；写实外观不代表这些细节已经确定。" : "这张单品包含生成补全；请特别核对原图未展示的部分。"}</Notice> : null}
        <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已核对单品轮廓、细节和挂点，确认可用于陈列</label>
        <Button variant="primary" disabled={!canEdit || !reviewed || !name.trim()} loading={busy} onClick={() => void confirm()}>确认单品并挂上衣架</Button>
      </> : null}
      <Button onClick={() => { setPreparationId(null); setImmediate(null); setReviewed(false); }}>返回来源设置</Button>
    </div> : <div className={styles.stack}>
      <AssetPicker assets={allAssets} selected={sourceId ? [sourceId] : []} onChange={ids => { setSourceId(ids[0] ?? ""); setRegion(null); }} label="当前项目的来源图片" disabled={!canEdit || busy} />
      <UploadInput label="上传来源图片" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || busy} hint="JPEG、PNG、WebP，最大 10 MB；上传后仍需核对单品" onChange={event => {
        const file = event.target.files?.[0]; if (!file) return;
        void run(async () => { upload.current?.abort(); const controller = new AbortController(); upload.current = controller;
          const asset = await uploadWardrobeSource(projectId, file, controller.signal);
          setUploaded(current => [...current, asset]); setSourceId(asset.id); setRegion(null); setReviewed(false);
          if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
          await onChanged();
        });
      }} />
      <div className={styles.formRow}><Field label="单品名称"><Input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="例如：米白色短外套" /></Field><Field label="单品品类"><Select value={category} onChange={event => { const next = event.target.value as WardrobeCategory; setCategory(next); setDisplay(DEFAULT_DISPLAY[next]); setAnchor({ x: .5, y: DEFAULT_DISPLAY[next] === "shelf" ? 1 : .08 }); }}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div>
      <div className={styles.formRow}><Field label="来源类型"><Select value={sourceKind} onChange={event => setSourceKind(event.target.value as WardrobeSourceKind)}>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="准备方式"><Select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="existing">使用已有独立单品图</option><option value="extract" disabled={!generationEnabled}>从图片中提取单品</option><option value="complete" disabled={!generationEnabled}>{sourceKind === "sketch" ? "生成写实单品候选" : "提取并补全遮挡部分"}</option></Select></Field></div>
      {sourceKind === "sketch" && mode === "complete" ? <Notice>将按草图生成写实单品候选。面料材质和草图未说明的结构需要人工核对，确认后才可加入衣架。</Notice> : null}
      {projectStyles.length ? <Field label="关联款式修订"><Select value={styleRevisionId} onChange={event => setStyleRevisionId(event.target.value)}><option value="">不关联款式</option>{projectStyles.flatMap(style => style.revisions.map(revision => <option key={revision.id} value={revision.id}>{style.name} 修订 {revision.revision}</option>))}</Select></Field> : null}
      {selectedSource && mode !== "existing" ? <RegionSelector src={selectedSource.url} region={region} onChange={setRegion} /> : null}
      {mode !== "existing" ? <><AssetPicker assets={assets} selected={references} onChange={setReferences} max={8} compact label="补充参考图（可选）" /><Field label="保留要求"><Textarea value={notes} maxLength={1500} onChange={event => setNotes(event.target.value)} placeholder="说明需要保留的印花、领口、面料细节" /></Field><Notice>确认后创建生成任务并按项目规则计费。生成结果仍需逐件核对。</Notice></> : <p className={styles.muted}>适用于背景已去除的完整单品图片。下一步仍需核对轮廓与挂点。</p>}
      {!generationEnabled ? <p className={styles.muted}>当前项目尚未启用单品生成，可以使用已有独立单品图。</p> : null}
      <Button variant="primary" disabled={!canEdit || !sourceId || !name.trim() || (mode !== "existing" && !generationEnabled)} loading={busy} onClick={() => void prepare()}>{mode === "existing" ? "继续核对单品" : "确认生成候选"}</Button>
      {preparations.some(item => !item.presentation) ? <section className={styles.history}><h3>最近的单品准备</h3>{preparations.filter(item => !item.presentation).slice(0, 12).map(item => <div className={styles.historyRow} key={item.id}><span>{item.name}</span><span>{TASK_LABELS[item.status]}</span><Button onClick={() => choosePreparation(item)}>查看与继续</Button></div>)}</section> : null}
    </div>}
  </Dialog>;
}
