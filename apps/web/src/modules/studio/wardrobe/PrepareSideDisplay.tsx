"use client";

import { useEffect, useRef, useState } from "react";
import type { WardrobeItemView, WardrobePreparationView, WardrobePresentationInput } from "@fashion/shared";
import { Button, Dialog, Field, ImagePreview, Input, Notice, SegmentedControl, Textarea, UploadInput } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import { cancelGeneration } from "../../board/generation/generation-api";
import { wardrobeApi } from "./wardrobe-api";
import { uploadWardrobeSource } from "./wardrobe-assets";
import { useWardrobeImageBounds } from "./wardrobe-image-bounds";
import { GarmentMountPreview } from "./GarmentMountPreview";
import { getShelfDepthRatio } from "./garment-geometry";
import { PreviewBackgroundControl, previewBackgroundStyle, type PreviewBackground } from "./PreviewBackground";
import { TASK_LABELS } from "./wardrobe-state";
import { RepairTransparentMaterial } from "./RepairTransparentMaterial";
import { MaterialProcessingDetails } from "./MaterialProcessingDetails";
import styles from "./wardrobe.module.css";

export function PrepareSideDisplay({ projectId, item, preparations, canEdit, generationEnabled, onChanged, onClose, onSaved }: {
  projectId: string; item: WardrobeItemView; preparations: WardrobePreparationView[];
  canEdit: boolean; generationEnabled: boolean; onChanged: () => Promise<void>; onClose: () => void; onSaved: () => void;
}) {
  const front = item.currentRevision;
  const [mode, setMode] = useState<"generate" | "upload">("generate");
  const [orientation, setOrientation] = useState<"left" | "right">("left");
  const [uploaded, setUploaded] = useState<{ id: string; url: string } | null>(null);
  const [poseReference, setPoseReference] = useState<{ id: string; url: string } | null>(null);
  const [poseUploadKey, setPoseUploadKey] = useState(0);
  const [immediate, setImmediate] = useState<WardrobePreparationView | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ x: .5, y: .08 });
  const [frontAnchor, setFrontAnchor] = useState(front.anchor);
  const [supportWidth, setSupportWidth] = useState(front.presentation?.supportWidthRatio ?? (front.display === "hanger" ? .62 : front.display === "clips" ? .76 : front.display === "hook" ? .48 : 1.04));
  const [shelfDepthRatio, setShelfDepthRatio] = useState(getShelfDepthRatio(front));
  const [reviewed, setReviewed] = useState(false);
  const [repairFor, setRepairFor] = useState<string | null>(null);
  const [repairNotes, setRepairNotes] = useState("");
  const [view, setView] = useState<"front" | "side">("front");
  const [background, setBackground] = useState<PreviewBackground>("scene");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const upload = useRef<AbortController | null>(null);
  const packet = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const current = preparations.find(value => value.id === immediate?.id) ?? immediate;
  const candidate = current?.candidates.find(value => value.assetId === candidateId) ?? current?.candidates[0];
  const bounds = useWardrobeImageBounds(projectId, candidate?.assetId, candidate?.imageBounds);
  const history = preparations.filter(value => value.presentation?.revisionId === front.id);
  const repairSourceUrl = current?.materialProcessing ? `/api/design-assets/${encodeURIComponent(current.materialProcessing.sourceAssetId)}/content` : null;
  const run = async (action: () => Promise<void>) => {
    if (locked.current || !canEdit) return;
    locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(userFacingError(cause)); } finally { locked.current = false; setBusy(false); }
  };
  const requestKey = (input: unknown) => {
    const signature = JSON.stringify(input);
    if (packet.current?.signature !== signature) packet.current = { signature, key: crypto.randomUUID() };
    return packet.current.key;
  };
  const prepare = () => run(async () => {
    if (mode === "upload" && !uploaded) return;
    const input = { name: front.name, category: front.category, sourceKind: "isolated" as const, sourceAssetId: mode === "generate" ? front.assetId : uploaded?.id ?? "",
      mode: mode === "generate" ? "complete" as const : "existing" as const, referenceAssetIds: mode === "generate" && poseReference ? [poseReference.id] : [], presentation: { view: "side" as const, revisionId: front.id, orientation } };
    const result = await wardrobeApi.prepare(projectId, { ...input, requestKey: requestKey(input) });
    setImmediate(result); setCandidateId(null); setReviewed(false); packet.current = null; await onChanged();
  });
  const repair = () => run(async () => {
    if (!generationEnabled || current?.status !== "ready" || !current.presentation || !candidate || repairFor !== candidate.assetId || !repairNotes.trim()) return;
    const input = { name: front.name, category: front.category, sourceKind: "isolated" as const, sourceAssetId: candidate.assetId,
      mode: "extract" as const, referenceAssetIds: [], notes: repairNotes.trim(), presentation: { view: "side" as const, revisionId: front.id,
        orientation: current.presentation.orientation, repairPreparationId: current.id } };
    const result = await wardrobeApi.prepare(projectId, { ...input, requestKey: requestKey(input) });
    setImmediate(result); setCandidateId(null); setReviewed(false); setRepairFor(null); setRepairNotes(""); packet.current = null; await onChanged();
  });
  const save = (sideDisplay?: WardrobePresentationInput["sideDisplay"]) => run(async () => {
    const input = { expectedVersion: item.version, revisionId: front.id, frontAnchor, supportWidthRatio: supportWidth, ...(front.display === "shelf" ? { shelfDepthRatio } : {}), ...(sideDisplay !== undefined ? { sideDisplay } : {}) };
    await wardrobeApi.presentation(projectId, item.id, { ...input, requestKey: requestKey(input) });
    packet.current = null; await onChanged(); onSaved();
  });
  const previewSide = current?.status === "ready" && candidate && bounds ? { assetId: candidate.assetId, url: candidate.url, imageBounds: bounds, anchor,
    orientation: current.presentation?.orientation ?? orientation, source: current.mode === "existing" && !current.materialProcessing ? "uploaded" as const : "generated" as const, preparationId: current.id, reviewed: true as const,
    ...(current.materialProcessing ? { materialProcessing: current.materialProcessing } : {}) } : front.presentation?.sideDisplay;
  // Local-only preview; the review flag is sent to the server only after the separate checkbox and confirmation.
  const preview = { ...front, anchor: frontAnchor, presentation: { supportWidthRatio: supportWidth, ...(front.display === "shelf" ? { shelfDepthRatio } : {}), ...(previewSide ? { sideDisplay: previewSide } : {}) } };
  return <Dialog label="准备侧挂展示图" className={styles.prepareDialog} busy={busy} onClose={onClose}>
    <header className={styles.sectionHeader}><h2>准备侧挂展示图</h2><Button disabled={busy} onClick={onClose}>返回单品准备</Button></header>
    <div className={styles.stack}>
      <p>为「{front.name}」核对侧挂轮廓和挂具宽度。保存后创建展示修订，试穿仍引用原正面服装。</p>
      {!current && front.presentation?.sideDisplay?.materialProcessing ? <MaterialProcessingDetails processing={front.presentation.sideDisplay.materialProcessing} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <SegmentedControl label="侧挂图来源" value={mode} options={[{ value: "generate", label: "生成侧挂图" }, { value: "upload", label: "上传侧挂图" }]} onChange={value => { setMode(value); setReviewed(false); }} />
      <SegmentedControl label="侧挂方向" value={orientation} options={[{ value: "left", label: "朝左" }, { value: "right", label: "朝右" }]} onChange={value => { setOrientation(value); setReviewed(false); }} />
      {mode === "upload" ? <UploadInput label="上传侧挂展示图" accept="image/png,image/webp" disabled={!canEdit || busy} hint="选择同一件服装的透明侧挂图；上传后仍需核对" onChange={event => {
        const file = event.target.files?.[0]; if (!file) return;
        event.currentTarget.value = "";
        void run(async () => { upload.current?.abort(); const controller = new AbortController(); upload.current = controller; setUploaded(await uploadWardrobeSource(projectId, file, controller.signal)); setReviewed(false); await onChanged(); });
      }} /> : <Notice>根据确认正面生成侧挂候选，按项目规则计费。生成的侧缝和褶皱需人工核对，不代表已知背面结构。</Notice>}
      {mode === "generate" ? <>
        <UploadInput key={poseUploadKey} label="上传侧挂姿态参考（可选）" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || busy} hint="仅参考陈列角度与支撑姿态；服装款式、颜色和材质仍以已确认正面为准" onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          event.currentTarget.value = "";
          void run(async () => { upload.current?.abort(); const controller = new AbortController(); upload.current = controller; setPoseReference(await uploadWardrobeSource(projectId, file, controller.signal)); setReviewed(false); await onChanged(); });
        }} />
        {poseReference ? <div className={styles.comparison}>
          <figure><figcaption>服装来源：已确认正面</figcaption><div className={styles.compareImage}><ImagePreview src={front.url} alt="生成侧挂图的正面来源" /></div></figure>
          <figure><figcaption>姿态参考：只借角度与支撑</figcaption><div className={styles.compareImage}><ImagePreview src={poseReference.url} alt="侧挂姿态参考" /></div><Button disabled={busy} onClick={() => { setPoseReference(null); setPoseUploadKey(value => value + 1); setReviewed(false); }}>移除姿态参考</Button></figure>
        </div> : null}
      </> : null}
      {uploaded && mode === "upload" ? <p className={styles.muted}>侧挂来源已上传，尚未确认用于陈列。</p> : null}
      <Button disabled={!canEdit || busy || (mode === "generate" ? !generationEnabled : !uploaded)} onClick={() => void prepare()}>{mode === "generate" ? "确认生成侧挂候选" : "继续核对上传侧挂图"}</Button>
      {mode === "generate" && !generationEnabled ? <p className={styles.muted}>当前项目未启用单品生成，可上传已有侧挂图。</p> : null}
      {history.length ? <section className={styles.history}><h3>本修订的侧挂准备</h3>{history.map(value => <div className={styles.historyRow} key={value.id}><span>{value.name}</span><span>{TASK_LABELS[value.status]}</span><Button onClick={() => { setImmediate(value); setCandidateId(null); setReviewed(false); setRepairFor(null); setRepairNotes(""); }}>核对侧挂候选</Button></div>)}</section> : null}
      {current ? <><p role="status">侧挂候选：{TASK_LABELS[current.status]}</p>{current.error ? <Notice tone="error">{current.error}</Notice> : null}
        {(current.status === "running" || current.status === "queued") && current.taskId ? <Button disabled={!canEdit || busy} onClick={() => void run(async () => { const taskId = current.taskId; if (taskId) await cancelGeneration(taskId); await onChanged(); })}>取消侧挂准备</Button> : null}
      </> : null}
      {current?.status === "ready" && candidate ? <>
        {current.materialProcessing ? <MaterialProcessingDetails processing={current.materialProcessing} /> : null}
        {repairSourceUrl ? <details><summary>对照已确认正面</summary><div className={styles.compareImage} data-preview-background={background} style={previewBackgroundStyle(background)}><ImagePreview src={front.url} alt="侧挂核对的确认正面" /></div></details> : null}
        <PreviewBackgroundControl value={background} onChange={setBackground} />
        <div className={styles.comparison}>
          <figure><figcaption>{repairSourceUrl ? current.materialProcessing?.kind === "masked-edit" ? "修正前侧挂图" : "修复前侧挂图" : "已确认正面"}</figcaption><div className={styles.compareImage} data-preview-background={background} style={previewBackgroundStyle(background)}><ImagePreview src={repairSourceUrl ?? front.url} alt={repairSourceUrl ? current.materialProcessing?.kind === "masked-edit" ? "局部修正前的侧挂候选" : "透明修复前的侧挂候选" : "侧挂核对的确认正面"} /></div></figure>
          <figure><figcaption className={styles.actions}><span>侧挂候选</span><span>{current.presentation?.orientation === "right" ? "朝右" : "朝左"}</span><span>点击实际挂点</span></figcaption><div className={styles.anchorStage} data-preview-background={background} style={previewBackgroundStyle(background)} onClick={event => {
            const box = event.currentTarget.getBoundingClientRect(); setAnchor({ x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }); setReviewed(false);
          }}><ImagePreview src={candidate.url} alt="待核对侧挂候选" /><span className={styles.anchorPoint} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} aria-hidden="true" /></div></figure>
        </div>
        {current.candidates.length > 1 ? <div className={styles.actions}>{current.candidates.map((value, index) => <Button key={value.assetId} aria-pressed={candidate.assetId === value.assetId} onClick={() => { setCandidateId(value.assetId); setReviewed(false); setRepairFor(null); setRepairNotes(""); }}>侧挂候选 {index + 1}</Button>)}</div> : null}
        {current.presentation?.revisionId === front.id ? (["transparency", "correction"] as const).map(operation => <RepairTransparentMaterial key={`${projectId}:${front.id}:${current.id}:${candidate.assetId}:${operation}`} operation={operation} projectId={projectId} sidePreparationId={current.id}
          source={{ assetId: candidate.assetId, url: candidate.url, name: front.name, category: front.category, imageBounds: candidate.imageBounds }} canEdit={canEdit && !busy} generationEnabled={generationEnabled} onPrepared={value => {
            if (value.presentation?.revisionId !== front.id || value.presentation.orientation !== current.presentation?.orientation) { setError("修复候选与当前侧挂修订或方向不匹配，原候选已保留。请重新打开本修订核对。"); return; }
            setImmediate(value); setCandidateId(null); setReviewed(false); setRepairFor(null); setRepairNotes(""); setView("side"); packet.current = null;
            void onChanged().catch(cause => setError(userFacingError(cause)));
          }} />) : null}
        <div className={styles.actions}><Button disabled={!canEdit || busy || !generationEnabled} aria-expanded={repairFor === candidate.assetId} onClick={() => setRepairFor(repairFor === candidate.assetId ? null : candidate.assetId)}>修正此候选</Button></div>
        {repairFor === candidate.assetId ? <>
          <Field label="候选修正说明"><Textarea value={repairNotes} maxLength={1500} onChange={event => setRepairNotes(event.target.value)} placeholder="例如：保留当前角度、结构和颜色，只修正镜片局部透明度；说明需要保留的细节。" /></Field>
          <Notice>以当前选中的侧挂候选修正，按项目规则计费。保留当前展示角度；新结果仍需重新核对，原候选保留在准备历史中。</Notice>
          <Button disabled={!canEdit || busy || !generationEnabled || !repairNotes.trim()} onClick={() => void repair()}>确认修正侧挂候选</Button>
        </> : null}
        <p className={styles.muted}>核对领口、袖长、材质、印花、朝向和侧缝。挂点选实际领口、腰头或承托处，不选透明留白。</p>
        <div className={styles.formRow}>{(["x", "y"] as const).map(key => <Field key={key} label={`侧挂点${key === "x" ? "横向" : "纵向"} %`}><Input type="number" min={0} max={100} step={0.1} value={Number((anchor[key] * 100).toFixed(2))} onChange={event => { setAnchor({ ...anchor, [key]: Math.max(0, Math.min(1, Number(event.target.value) / 100)) }); setReviewed(false); }} /></Field>)}</div>
        {!bounds ? <Notice>侧挂预览需要透明图的可见范围。信息尚不可用时不能确认；请检查图片后重新打开核对。</Notice> : null}
      </> : null}
      <div className={styles.formRow}>{(["x", "y"] as const).map(key => <Field key={key} label={`正面挂点${key === "x" ? "横向" : "纵向"} %`}><Input type="number" min={0} max={100} step={0.1} value={Number((frontAnchor[key] * 100).toFixed(2))} onChange={event => { setFrontAnchor({ ...frontAnchor, [key]: Math.max(0, Math.min(1, Number(event.target.value) / 100)) }); setReviewed(false); }} /></Field>)}</div>
      <p className={styles.muted}>只调整正面在挂具上的位置，不修改图片。高领请核对领口下方的实际支撑处；双肩带需同时落在木肩上。</p>
      <Field label="挂具宽度 / 正面主体宽度 %"><Input type="number" min={15} max={120} value={Math.round(supportWidth * 100)} onChange={event => { setSupportWidth(Math.max(.15, Math.min(1.2, Number(event.target.value) / 100))); setReviewed(false); }} /></Field>
      <p className={styles.muted}>按实际肩宽或腰宽调整挂具，避免宽袖或裙摆把挂具撑大。</p>
      {front.display === "shelf" ? <>
        <Field label="托面纵深 / 托架宽度 %"><Input type="number" min={8} max={50} step={0.1} value={Number((shelfDepthRatio * 100).toFixed(2))} onChange={event => { setShelfDepthRatio(Math.max(.08, Math.min(.5, Number(event.target.value) / 100))); setReviewed(false); }} /></Field>
        <p className={styles.muted}>向后调整同一托面，核对前后支点。正面与侧挂共用设置，图片保持原样。</p>
      </> : null}
      <SegmentedControl label="核对展示角度" value={previewSide ? view : "front"} options={previewSide ? [{ value: "front", label: "正面" }, { value: "side", label: "侧挂" }] : [{ value: "front", label: "正面" }]} onChange={setView} />
      <GarmentMountPreview projectId={projectId} background={background} item={preview} view={previewSide ? view : "front"} />
      {current?.status === "ready" && candidate ? <><label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已对照正面核对侧挂图、挂点及挂具宽度</label><Button variant="primary" disabled={!canEdit || busy || !bounds || !reviewed} onClick={() => void save({ preparationId: current.id, assetId: candidate.assetId, anchor, reviewed: true })}>确认侧挂展示图</Button></> : null}
      <div className={styles.actions}><Button disabled={!canEdit || busy} onClick={() => void save()}>仅保存挂具设置</Button>{front.presentation?.sideDisplay ? <Button disabled={!canEdit || busy} onClick={() => void save(null)}>移除侧挂展示图</Button> : null}</div>
    </div>
  </Dialog>;
}
