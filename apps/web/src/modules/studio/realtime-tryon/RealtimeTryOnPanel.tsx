"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { REALTIME_TRYON_CONSENT_VERSION, type RealtimeTryOnCapabilities, type RealtimeTryOnCaptureResult, type StudioAssetView, type OutfitSnapshotView, type WardrobeCapabilities } from "@fashion/shared";
import { Button, ImagePreview, Notice } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import { useAuth } from "../../auth/AuthProvider";
import { privateRequestSignal } from "../../auth/private-fetch";
import { AssetPicker } from "../studio-ui";
import { StudioPageHeader } from "../StudioPageHeader";
import { useStudioAssetName } from "../studio-object-context";
import { createRealtimeTryOnController } from "./realtime-tryon-api";
import type { RealtimeTryOnController } from "./realtime-tryon-machine";
import type { TryOnGarment, RealtimeTryOnStatus } from "./realtime-tryon-types";
import { addTryOnCaptureToCanvas, fetchTryOnCapabilities, loadTryOnGarment, PendingTryOnCapture, uploadTryOnGarment } from "./tryon-asset-flow";
import styles from "./RealtimeTryOnPanel.module.css";
import { loadTryOnOutfit, outfitTryOnUnavailableReason } from "./outfit-tryon-reference";

const STATUS: Record<RealtimeTryOnStatus, string> = {
  idle: "尚未开启摄像头", "requesting-camera": "正在等待摄像头权限",
  "local-preview": "仅本地预览，尚未发送到 AI", "creating-session": "正在申请受限会话",
  connecting: "正在等待 AI 首帧", live: "实时试穿中", "updating-garment": "正在更新服装",
  stopping: "正在停止", ended: "已停止本次试穿", error: "本次试穿已停止",
};

export function RealtimeTryOnPanel({
  projectId, assets, canEdit, initialAssetId, onSaved, onDirty, outfitSnapshot, wardrobeCapabilities, outfitUpdating = false, embedded = false,
  controllerFactory = createRealtimeTryOnController,
}: {
  readonly projectId: string;
  readonly assets: readonly StudioAssetView[];
  readonly canEdit: boolean;
  readonly initialAssetId?: string | undefined;
  readonly onSaved?: (() => void | Promise<void>) | undefined;
  readonly onDirty?: ((dirty: boolean) => void) | undefined;
  /** Undefined keeps the legacy single-image mode; null means no saved outfit is selected. */
  readonly outfitSnapshot?: OutfitSnapshotView | null | undefined;
  readonly wardrobeCapabilities?: WardrobeCapabilities | undefined;
  /** Keep the current session while a replacement full outfit reference is prepared. */
  readonly outfitUpdating?: boolean;
  readonly embedded?: boolean;
  /** Test injection only; no runtime flag or URL can select a simulated adapter. */
  readonly controllerFactory?: () => RealtimeTryOnController;
}) {
  const { session } = useAuth();
  const assetName = useStudioAssetName();
  const [controller] = useState(controllerFactory);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [capabilities, setCapabilities] = useState<RealtimeTryOnCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [extraAssets, setExtraAssets] = useState<StudioAssetView[]>([]);
  const allAssets = [...assets, ...extraAssets.filter((asset) => !assets.some((existing) => existing.id === asset.id))];
  const [assetId, setAssetId] = useState(initialAssetId ?? assets[0]?.id ?? "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSingleGarment, setLoadingGarment] = useState(false);
  const [settledOutfitReference, setSettledOutfitReference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RealtimeTryOnCaptureResult | null>(null);
  const [addedToCanvas, setAddedToCanvas] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PendingTryOnCapture | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState<"local" | "remote" | null>(null);
  const [cameraCollapsed, setCameraCollapsed] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const outputVideo = useRef<HTMLVideoElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const selectionRequest = useRef<AbortController | null>(null);
  const garment = useRef<TryOnGarment | null>(null);
  const mounted = useRef(true);
  const startFlight = useRef(false);
  const operationEpoch = useRef(0);
  const saveFlight = useRef(false);
  const activity = useRef<AbortController | null>(null);
  const maxBytes = capabilities?.maxGarmentBytes ?? 5 * 1024 * 1024;
  const outfitMode = outfitSnapshot !== undefined;
  const outfitUnavailable = outfitMode ? outfitTryOnUnavailableReason(outfitSnapshot, wardrobeCapabilities) : null;
  const selectedReferenceId = outfitMode ? outfitSnapshot?.referenceAssetId ?? "" : assetId;
  const outfitReferenceKey = `${outfitSnapshot?.id ?? ""}:${selectedReferenceId}`;
  const loadingGarment = loadingSingleGarment || (outfitMode && !outfitUnavailable && settledOutfitReference !== outfitReferenceKey);
  const stopWork = useCallback((reason: string) => {
    operationEpoch.current += 1;
    startFlight.current = false;
    selectionRequest.current?.abort();
    controller.stop(reason);
  }, [controller]);

  useEffect(() => {
    mounted.current = true;
    const lifetime = new AbortController();
    const accountSignal = privateRequestSignal(lifetime.signal);
    activity.current = lifetime;
    const stop = () => {
      stopWork("account-or-page-left");
    };
    accountSignal.addEventListener("abort", stop, { once: true });
    const hidden = () => { if (document.hidden) { stopWork("page-hidden"); setLoadingGarment(false); } };
    const pagehide = () => stopWork("page-left");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    return () => {
      mounted.current = false;
      lifetime.abort();
      stop();
      accountSignal.removeEventListener("abort", stop);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [controller, stopWork, projectId, session?.user.id]);

  useEffect(() => {
    const abort = new AbortController();
    void fetchTryOnCapabilities(abort.signal).then((value) => {
      if (!abort.signal.aborted) { setCapabilities(value); setCapabilityError(null); }
    }, (cause: unknown) => {
      if (!abort.signal.aborted) setCapabilityError(userFacingError(cause));
    });
    return () => abort.abort();
  }, [projectId, session?.user.id]);

  useEffect(() => { onDirty?.(Boolean(pending)); return () => onDirty?.(false); }, [onDirty, pending]);
  useEffect(() => {
    const video = localVideo.current;
    if (!video) return;
    video.srcObject = snapshot.localStream;
    if (snapshot.localStream) void video.play().catch(() => { if (mounted.current) setPlaybackBlocked("local"); });
    return () => { video.srcObject = null; };
  }, [snapshot.localStream]);
  const bindOutputVideo = useCallback((video: HTMLVideoElement | null) => {
    outputVideo.current = video;
    controller.bindOutputVideo(video);
  }, [controller]);
  useEffect(() => {
    if (snapshot.remoteStream) void outputVideo.current?.play().then(() => { if (mounted.current) setPlaybackBlocked(null); }, () => { if (mounted.current) setPlaybackBlocked("remote"); });
  }, [snapshot.remoteStream]);

  useEffect(() => {
    if (!outfitMode || outfitUpdating) return;
    const current = controller.getSnapshot();
    if (outfitUnavailable || !outfitSnapshot) {
      selectionRequest.current?.abort();
      garment.current = null;
      if (["creating-session", "connecting", "live", "updating-garment"].includes(current.status)) stopWork("outfit-not-supported");
      return;
    }
    if (garment.current?.outfitSnapshotId === outfitSnapshot.id && garment.current.assetId === outfitSnapshot.referenceAssetId) return;
    if (["creating-session", "connecting", "live", "updating-garment"].includes(current.status) && !current.outfitSnapshotId) stopWork("outfit-reference-changed");
    selectionRequest.current?.abort();
    const epoch = ++operationEpoch.current;
    startFlight.current = false;
    const abort = new AbortController();
    selectionRequest.current = abort;
    garment.current = null;
    void loadTryOnOutfit(outfitSnapshot, maxBytes, abort.signal).then((chosen) => {
      if (abort.signal.aborted || !mounted.current || epoch !== operationEpoch.current) return;
      garment.current = chosen;
      setError(null);
      setSettledOutfitReference(outfitReferenceKey);
      controller.selectGarment(chosen);
    }, (cause: unknown) => {
      if (!abort.signal.aborted && mounted.current) {
        setError(userFacingError(cause));
        if (controller.getSnapshot().sessionId) stopWork("outfit-reference-failed");
        setSettledOutfitReference(outfitReferenceKey);
      }
    });
    return () => abort.abort();
  }, [controller, maxBytes, outfitMode, outfitSnapshot, outfitUnavailable, outfitReferenceKey, outfitUpdating, stopWork]);

  const choose = async (next: string) => {
    selectionRequest.current?.abort();
    const epoch = ++operationEpoch.current;
    startFlight.current = false;
    const abort = new AbortController();
    selectionRequest.current = abort;
    setAssetId(next);
    garment.current = null;
    if (!next) return;
    setLoadingGarment(true);
    setError(null);
    try {
      const chosen = await loadTryOnGarment(next, maxBytes, abort.signal);
      if (abort.signal.aborted || !mounted.current || epoch !== operationEpoch.current) return;
      garment.current = chosen;
      controller.selectGarment(chosen);
    } catch (cause) {
      if (!abort.signal.aborted && mounted.current) setError(userFacingError(cause));
    } finally { if (!abort.signal.aborted && mounted.current) setLoadingGarment(false); }
  };

  const start = async () => {
    if (startFlight.current || outfitUpdating || !consent || !capabilities?.enabled || !capabilities.configured || !canEdit || !selectedReferenceId || outfitUnavailable) return;
    startFlight.current = true;
    const epoch = ++operationEpoch.current;
    selectionRequest.current?.abort();
    const abort = new AbortController();
    selectionRequest.current = abort;
    const signal = activity.current ? AbortSignal.any([abort.signal, activity.current.signal]) : abort.signal;
    setLoadingGarment(true);
    setError(null);
    try {
      const selected = garment.current?.assetId === selectedReferenceId && (garment.current.outfitSnapshotId ?? null) === (outfitSnapshot?.id ?? null)
        ? garment.current : outfitSnapshot ? await loadTryOnOutfit(outfitSnapshot, maxBytes, signal) : await loadTryOnGarment(selectedReferenceId, maxBytes, signal);
      if (!mounted.current || signal.aborted || epoch !== operationEpoch.current) return;
      garment.current = selected;
      await controller.start(selected, projectId, REALTIME_TRYON_CONSENT_VERSION);
    } catch (cause) { if (mounted.current && !signal.aborted && epoch === operationEpoch.current) setError(userFacingError(cause)); }
    finally { if (epoch === operationEpoch.current) { startFlight.current = false; if (mounted.current) setLoadingGarment(false); } }
  };

  const save = async () => {
    if (saveFlight.current || outfitUpdating || !canEdit) return;
    saveFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let item = pending;
      if (!item) {
        if (!outputVideo.current) return;
        item = new PendingTryOnCapture(await controller.capture(outputVideo.current), projectId);
        if (!mounted.current) return;
        setPending(item);
      }
      const result = await item.save(activity.current?.signal);
      if (!mounted.current) return;
      setSaved(result);
      setAddedToCanvas(false);
      setPending(null);
      void onSaved?.();
    } catch (cause) { if (mounted.current) setError(userFacingError(cause)); }
    finally { saveFlight.current = false; if (mounted.current) setSaving(false); }
  };

  const active = ["requesting-camera", "local-preview", "creating-session", "connecting", "live", "updating-garment"].includes(snapshot.status);
  const streaming = ["creating-session", "connecting", "live", "updating-garment"].includes(snapshot.status);
  const showingResult = Boolean(snapshot.remoteStream && ["live", "updating-garment"].includes(snapshot.status));
  const selectedAsset = allAssets.find((asset) => asset.id === assetId);
  const garmentDisabled = !canEdit || snapshot.status === "creating-session";
  return <section className={styles.panel} data-realtime-tryon data-guide="studio-editor">
    {!embedded ? <StudioPageHeader title="实时试穿" description={outfitMode ? "将已保存的完整搭配带入镜头。" : "选一件服装，在镜头前查看试穿效果。"} /> : null}
    {error || snapshot.error ? <Notice tone="error">{error ?? snapshot.error}</Notice> : null}
    <div className={styles.workspace}>
      <div className={styles.previewArea}>
        <div className={styles.stageHeader}>
          <strong>{showingResult ? outfitUpdating ? "上一套试穿效果" : "试穿效果" : "镜头预览"}</strong>
          <span>{showingResult ? "Decart 实时输出" : "先调整站位，再开始试穿"}</span>
        </div>
        <div className={styles.videoStage} data-result={showingResult} data-camera-collapsed={cameraCollapsed}>
          <figure className={styles.localVideo} data-collapsed={showingResult && cameraCollapsed}>
              <video ref={localVideo} aria-label="原始摄像头画面" autoPlay muted playsInline />
              {showingResult && !cameraCollapsed ? <figcaption>原始画面</figcaption> : null}
          </figure>
          <figure className={styles.resultVideo} aria-hidden={!showingResult}>
              <video ref={bindOutputVideo} aria-label="AI 试穿结果" autoPlay muted playsInline onError={() => stopWork("video-playback-error")} />
          </figure>
          {!snapshot.localStream ? <div className={styles.placeholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 5 9.5 3h5L16 5h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="4" /></svg>
            <strong>让服装进入你的画面</strong>
            <p>开启摄像头，保持{outfitMode ? "所选服装对应部位" : "上半身"}完整入镜。<br />此时仅在本机预览，不会创建 AI 会话。</p>
          </div> : null}
          {streaming && !showingResult ? <div className={styles.connecting}>正在等待真实视频输出…</div> : null}
          {showingResult ? <button type="button" className={styles.cameraToggle} aria-expanded={!cameraCollapsed} onClick={() => setCameraCollapsed((value) => !value)}>{cameraCollapsed ? "展开原始画面" : "收起原始画面"}</button> : null}
        </div>
        <div className={styles.status} role="status" aria-live="polite">
          <strong>{outfitUpdating ? "正在准备当前完整搭配…" : STATUS[snapshot.status]}</strong>
          {snapshot.generationSeconds !== null ? <span>已生成 {Math.floor(snapshot.generationSeconds)} 秒（本机观察）</span> : null}
        </div>
        {playbackBlocked && (playbackBlocked === "local" ? snapshot.localStream : snapshot.remoteStream) ? <Button onClick={() => {
          const video = playbackBlocked === "local" ? localVideo.current : outputVideo.current;
          void video?.play().then(() => setPlaybackBlocked(null), () => setError("浏览器仍阻止视频播放，请检查浏览器权限后重试。"));
        }}>继续播放{playbackBlocked === "local" ? "原始画面" : "AI 画面"}</Button> : null}
        <p className={styles.stageHint}>建议正面站立，光线均匀，镜头保持稳定。</p>
      </div>
      <aside className={styles.settings} aria-label="试穿设置">
        {outfitMode ? <div className={styles.garment} aria-label="当前完整搭配">
          <div className={styles.sectionHeader}><strong>{outfitUpdating ? "搭配更新中" : "当前搭配"}</strong><span>{outfitSnapshot ? `${outfitSnapshot.items.length} 件` : outfitUpdating ? "正在准备" : "尚未保存"}</span></div>
          <div className={styles.garmentContent}>
            <div className={styles.garmentImage}>{outfitSnapshot?.referenceUrl ? <ImagePreview retryable={false} src={outfitSnapshot.referenceUrl} alt="当前完整搭配参考图" /> : <span>搭配已保留</span>}</div>
            <div className={styles.garmentSummary}><strong>{outfitSnapshot?.name ?? "请保存当前搭配"}</strong><span>{outfitSnapshot ? `搭配版本 ${outfitSnapshot.version}` : "在衣橱中选择单品"}</span><span title={outfitSnapshot?.items.map((item) => item.name).join("、")}>{outfitSnapshot?.items.map((item) => item.name).join("、")}</span></div>
          </div>
        </div> : <AssetPicker assets={allAssets} selected={assetId ? [assetId] : []} onChange={(ids) => void choose(ids[0] ?? "")} label="选择服装参考" max={1} compact disabled={garmentDisabled} renderControl={({ openPicker, openPreview }) => <div className={styles.garment}>
          <div className={styles.sectionHeader}><strong>服装参考</strong><Button variant="ghost" size="small" disabled={garmentDisabled} onClick={openPicker}>更换</Button></div>
          <div className={styles.garmentContent}>
            <button type="button" className={styles.garmentImage} disabled={!selectedAsset} onClick={openPreview} aria-label="查看服装大图">
              {selectedAsset ? <ImagePreview retryable={false} src={selectedAsset.thumbnailUrl ?? selectedAsset.url} alt="当前服装参考" /> : <span>尚未选择服装</span>}
            </button>
            <div className={styles.garmentSummary}><strong title={selectedAsset ? assetName(selectedAsset.id) : undefined}>{selectedAsset ? assetName(selectedAsset.id) : "选择一件服装"}</strong><span>单件上装或夹克效果更稳定</span><Button variant="ghost" size="small" disabled={garmentDisabled || loadingGarment} onClick={() => uploadInput.current?.click()}>上传服装图片</Button></div>
          </div>
        </div>} />}
        {outfitUpdating ? <Notice>当前完整搭配正在更新，准备完成后会继续试穿。当前画面仍是上一套搭配，暂不能截图。</Notice> : outfitUnavailable ? <Notice>{outfitUnavailable}</Notice> : null}
        {loadingGarment ? <p role="status">正在准备服装图片…</p> : null}
        <input ref={uploadInput} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="上传服装图片" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file || !canEdit) return;
          selectionRequest.current?.abort();
          const abort = new AbortController(); selectionRequest.current = abort;
          setLoadingGarment(true); setError(null);
          void uploadTryOnGarment(projectId, file, maxBytes, abort.signal).then((asset) => {
            if (abort.signal.aborted || !mounted.current) return;
            setExtraAssets((current) => [...current, asset]); setAssetId(asset.id);
            garment.current = { assetId: asset.id, file }; controller.selectGarment(garment.current);
            void onSaved?.();
          }, (cause: unknown) => { if (!abort.signal.aborted && mounted.current) setError(userFacingError(cause)); }).finally(() => { if (!abort.signal.aborted && mounted.current) setLoadingGarment(false); });
        }} />
        <div className={styles.consent}>
          <strong>开始前确认</strong>
          {capabilityError ? <Notice tone="error">{capabilityError}</Notice> : capabilities && (!capabilities.enabled || !capabilities.configured) ? <div className={styles.availability}><strong>{capabilities.unavailableReason ?? "实时 AI 尚未配置"}</strong><span>仍可开启摄像头进行本地预览</span></div> : !capabilities ? <p role="status">正在读取实时试穿配置…</p> : null}
          <p>开始试穿后，摄像头画面及服装参考将发送到 Decart AI 服务。</p>
          <p className={styles.price}>{capabilities?.estimatedUsdPerSecond ? `估算 $${capabilities.estimatedUsdPerSecond}/生成秒，每次最多 ${capabilities.maxSessionSeconds} 秒。` : "当前费率尚未确认，无法开始 AI 会话。"}<small>应用估算不代表供应商账单。</small></p>
          {capabilities?.priceVerifiedAt ? <small>费率核验日期 {capabilities.priceVerifiedAt.slice(0, 10)}</small> : null}
          <label><input type="checkbox" checked={consent} disabled={streaming} onChange={(event) => setConsent(event.currentTarget.checked)} /><span>我同意本次第三方视频处理及所示费用</span></label>
        </div>
        <div className={styles.controls}>
          {!active ? <Button variant="primary" onClick={() => { setConsent(false); setLoadingGarment(false); void controller.openCamera(); }}>开启摄像头</Button> : null}
          {snapshot.status === "local-preview" ? <Button variant="primary" disabled={!canEdit || outfitUpdating || !consent || !selectedReferenceId || Boolean(outfitUnavailable) || loadingGarment || !capabilities?.enabled || !capabilities.configured} onClick={() => void start()}>开始实时试穿</Button> : null}
          <Button variant={showingResult || pending ? "primary" : "secondary"} disabled={!canEdit || outfitUpdating || saving || (!pending && (!snapshot.canCapture || loadingGarment || Boolean(outfitUnavailable) || snapshot.garmentAssetId !== selectedReferenceId || (snapshot.outfitSnapshotId ?? null) !== (outfitSnapshot?.id ?? null)))} loading={saving} onClick={() => void save()}>{pending ? "重试保存这一帧" : "保存这一帧"}</Button>
          {active ? <Button onClick={() => { stopWork("user-stop"); setLoadingGarment(false); }}>停止</Button> : null}
        </div>
        {pending ? <p className={styles.note}>这帧尚未保存，画面保留在本页。重试将沿用同一次保存请求；离开后需要重新截图。</p> : null}
        {saved ? <div className={styles.saved} role="status">
          <p>AI 截图已保存到项目资产。</p>
          <a href={`/${encodeURIComponent(projectId)}/studio?tab=styles&assetId=${encodeURIComponent(saved.assetId)}`}>保存为款式</a>
          <Button disabled={adding || addedToCanvas || !canEdit} loading={adding} onClick={() => {
            if (adding) return;
            setAdding(true);
            void addTryOnCaptureToCanvas(projectId, saved).then(() => { if (mounted.current) setAddedToCanvas(true); }, (cause: unknown) => { if (mounted.current) setError(userFacingError(cause)); }).finally(() => { if (mounted.current) setAdding(false); });
          }}>{addedToCanvas ? "已加入作品区与画布" : "加入作品区与画布"}</Button>
          {addedToCanvas ? <a href={`/${encodeURIComponent(projectId)}`}>打开设计工作台</a> : null}
        </div> : null}
        {!canEdit ? <p className={styles.note}>当前项目为只读，无法创建试穿会话或保存结果。</p> : null}
        <details className={styles.instructions}><summary>使用说明</summary><p>{outfitMode ? "完整搭配使用已确认单品和已保存版本。尚未验证的多件或配饰类别会保留选择，并明确暂停实时生成。" : "使用单人、单件、完整且清晰的成衣参考。拼贴图、多人图和草图可能无法稳定还原；不会自动调用其他模型处理图片。"}</p><p>请仅使用有权使用、适合第三方处理的图片和已同意出镜者；敏感未发布设计需先确认数据条款。</p><p>视觉试穿不能证明真实尺码、面料物性或精确版型。停止或隐藏页面后会释放本功能的媒体轨道，重新开启需手动操作。</p></details>
      </aside>
    </div>
  </section>;
}
