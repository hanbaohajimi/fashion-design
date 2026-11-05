"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WardrobeCategory, WardrobeImageBounds, WardrobeMaterialOperation, WardrobePreparationView } from "@fashion/shared";
import { Button, Dialog, Field, Input, Notice, SegmentedControl, Textarea } from "../../../components/ui";
import { TaskFeedback } from "../../../components/TaskFeedback";
import { MaskCanvas, type MaskCanvasHandle, type MaskCanvasState } from "../../board/generation/MaskCanvas";
import { RegionSelector, type ImageRegion } from "./RegionSelector";
import { useWardrobeImageBounds } from "./wardrobe-image-bounds";
import { useMaterialRepair } from "./use-material-repair";
import styles from "./wardrobe.module.css";
import repairStyles from "./material-repair.module.css";

export function RepairTransparentMaterial({ projectId, source, canEdit, generationEnabled, sidePreparationId, operation = "transparency", onPrepared }: {
  projectId: string; source: { assetId: string; url: string; name: string; category: WardrobeCategory; imageBounds?: WardrobeImageBounds | undefined };
  canEdit: boolean; generationEnabled: boolean; onPrepared: (value: WardrobePreparationView) => void;
  sidePreparationId?: string | undefined;
  operation?: WardrobeMaterialOperation | undefined;
}) {
  const correction = operation === "correction";
  const title = correction ? "局部细节修正" : "修复透明材质";
  const actionName = correction ? "生成修正候选" : "生成修复候选";
  const [open, setOpen] = useState(false);
  const [brushRatio, setBrushRatio] = useState(.025);
  const [softness, setSoftness] = useState("standard");
  const [maskState, setMaskState] = useState<MaskCanvasState>({ coverage: 0, strokeCount: 0 });
  const [region, setRegion] = useState<ImageRegion | null>(null);
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportEpoch = useRef(0);
  useEffect(() => () => { exportEpoch.current += 1; }, []);
  const close = () => { exportEpoch.current += 1; setExporting(false); setOpen(false); };
  const mask = useRef<MaskCanvasHandle>(null);
  const bounds = useWardrobeImageBounds(projectId, source.assetId, source.imageBounds);
  const changed = useCallback((value: MaskCanvasState) => { setMaskState(value); setLocalError(null); }, []);
  const repair = useMaterialRepair({ projectId, sourceAssetId: source.assetId, name: source.name, category: source.category, open, enabled: canEdit && generationEnabled, sidePreparationId, operation, onPrepared: value => { close(); onPrepared(value); } });
  const busy = exporting || repair.busy;
  const editingLocked = busy || repair.canRetryProcessing;
  const submit = async () => {
    if (busy || !canEdit || !generationEnabled || !mask.current || !maskState.strokeCount) return;
    if (correction && !notes.trim()) { setLocalError("请填写修正说明，明确需要改变和保留的细节。"); return; }
    if (region && (region.width < .01 || region.height < .01)) { setLocalError("纹理细节范围过小，请重新选择。"); return; }
    setExporting(true); setLocalError(null);
    const turn = ++exportEpoch.current;
    try { const blob = await mask.current.exportPng(); if (turn === exportEpoch.current) await repair.start(blob, notes, region); }
    catch (cause) { if (turn === exportEpoch.current) setLocalError(cause instanceof Error ? cause.message : "选区准备失败，请重试。"); }
    finally { if (turn === exportEpoch.current) setExporting(false); }
  };
  return <>
    <Button disabled={!canEdit || !generationEnabled} onClick={() => setOpen(true)}>{maskState.strokeCount || repair.taskId ? correction ? "继续局部细节修正" : "继续透明材质修复" : title}</Button>
    {open ? <Dialog label={title} className={styles.prepareDialog} onClose={close}>
      <header className={styles.sectionHeader}><h2>{title}</h2><Button onClick={close}>返回候选核对</Button></header>
      <div className={styles.stack}>
        <p>{correction ? "涂选不透明面料内部需要调整的印花、纹理或缝线，并填写修正说明。原图透明度、外轮廓及选区外内容保持不变；外形或长度调整请使用其他候选修正流程。" : "适用于浅色蕾丝与网纱。涂选薄纱所在的区域，保留衣身内衬、领口和袖口；新候选中的花瓣与网线必须保持。"}</p>
        {correction ? <p>半透明区域、细边和轮廓附近会保持原样。细小配件可能没有可修正范围。</p> : null}
        {!correction ? <p>只涂选后方能看到背景的透纱。薄纱叠在衣身或内衬前方时，应保留后方衣片，不能透穿整件服装。</p> : null}
        {sidePreparationId ? <p>本次处理当前侧挂候选。完成后仍需核对侧挂方向、材质和挂点，再手动确认侧挂展示图。</p> : null}
        <Notice>{actionName}按项目规则计费。新结果仍需三种底色核对并手动确认，不会自动进入衣架。</Notice>
        {localError || repair.error ? <Notice tone="error">{localError ?? repair.error}</Notice> : null}
        <div className={repairStyles.stage}>
          <div className={repairStyles.media} data-busy={editingLocked}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source.url} alt={correction ? "局部细节修正原候选" : "透明材质修复原候选"} draggable={false} />
            {bounds ? <MaskCanvas key={`${source.assetId}:${bounds.width}:${bounds.height}`} ref={mask} width={bounds.width} height={bounds.height} brushRatio={brushRatio} softness={correction ? softness === "light" ? .2 : softness === "soft" ? .8 : .5 : 0} initialDraft={maskState.draft} disabled={editingLocked} label={correction ? "涂选局部修正区域" : "涂选透纱区域"} selectionTone="currentColor" descriptionId="material-repair-selection-help" onChange={changed} /> : null}
          </div>
        </div>
        <p id="material-repair-selection-help" className={styles.muted}>半透明标记表示所选区域。画笔按原图尺寸记录；更改笔宽不会扩大已经画过的选区。</p>
        {correction ? <><fieldset className={repairStyles.region} disabled={editingLocked}><span className={styles.muted}>边缘过渡</span><SegmentedControl label="边缘过渡" value={softness} options={[{ value: "light", label: "轻" }, { value: "standard", label: "标准" }, { value: "soft", label: "柔" }]} onChange={setSoftness} /></fieldset><p className={styles.muted}>边缘在笔画范围内逐渐减弱，更改过渡只影响下一笔。完成后仍需核对颜色接缝与细节。</p></> : null}
        {!bounds ? <Notice>正在读取透明单品尺寸。无法取得透明范围时不能开始修复，请检查图片后重新打开。</Notice> : null}
        <div className={styles.actions}>
          <Field label="画笔大小 %"><Input type="number" min={.5} max={12} step={.5} value={Number((brushRatio * 100).toFixed(1))} disabled={editingLocked} onChange={event => setBrushRatio(Math.max(.005, Math.min(.12, Number(event.target.value) / 100)))} /></Field>
          <Button disabled={editingLocked || !maskState.strokeCount} onClick={() => mask.current?.undo()}>撤销上一笔</Button>
          <Button disabled={editingLocked || !maskState.strokeCount} onClick={() => mask.current?.clear()}>清空选区</Button>
        </div>
        <details className={repairStyles.details}><summary>补充原图纹理细节（可选）</summary><p>{correction ? "选择原图中需要保留的清晰面料与花纹区域。" : "选择原图中清晰的网眼与花纹区域，帮助保留原有纹理。"}</p><fieldset className={repairStyles.region} disabled={editingLocked}><RegionSelector src={source.url} region={region} onChange={setRegion} purpose="material-detail" /></fieldset></details>
        <Field label={correction ? "修正说明" : "修复说明（可选）"}><Textarea required={correction} maxLength={1000} value={notes} disabled={editingLocked} onChange={event => setNotes(event.target.value)} placeholder={correction ? "例如：只恢复所选裤腿的细密斜纹，保留原色、棕色缝线及全部轮廓。" : "例如：保留花瓣和实体内衬，只修复两袖薄纱的透射。"} /></Field>
        {repair.taskId ? <TaskFeedback taskId={repair.taskId} status={repair.phase === "failed" ? "failed" : repair.phase === "canceled" ? "canceled" : "running"} title={repair.phase === "deriving" ? "正在整理候选" : title} compact /> : null}
        {repair.phase === "uploading" || repair.phase === "creating" ? <p role="status">{repair.phase === "uploading" ? "正在保存所选区域…" : "正在创建修复任务…"}</p> : null}
        {repair.canRetryProcessing ? <><Notice>图片已生成，候选整理未完成。重试处理沿用上次选区，不会再次生成或计费；也可以调整选区后重新生成。</Notice><div className={styles.actions}><Button disabled={busy || !canEdit} onClick={() => void repair.retryProcessing()}>重试候选处理</Button><Button disabled={busy || !canEdit} onClick={() => void repair.cancel()}>调整选区</Button></div></> : null}
        <div className={styles.actions}>
          <Button variant="primary" disabled={editingLocked || !bounds || !maskState.strokeCount || !canEdit || !generationEnabled || (correction && !notes.trim())} onClick={() => void submit()}>{repair.phase === "failed" || repair.phase === "canceled" ? `重新${actionName}` : actionName}</Button>
          {busy ? <Button onClick={() => { exportEpoch.current += 1; setExporting(false); void repair.cancel(); }}>{correction ? "取消局部细节修正" : "取消透明材质修复"}</Button> : null}
        </div>
        <p className={styles.muted}>返回核对会保留本次选区和任务；重新打开可继续。退出整个准备窗口后，已提交任务仍可在项目任务中查看。</p>
      </div>
    </Dialog> : null}
  </>;
}
