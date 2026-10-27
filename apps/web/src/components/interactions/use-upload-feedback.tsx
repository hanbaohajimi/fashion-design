"use client";

import { useDraftScope } from "../drafts/use-persistent-draft";
import { setLocalActivity, removeLocalActivity } from "../../modules/tasks/local-activities";
import { useEffect, useRef, useState } from "react";
import { Button, ImagePreview } from "../ui";
import styles from "./upload-feedback.module.css";

type Stage = "queued" | "signing" | "uploading" | "processing" | "adding" | "done" | "failed" | "canceled";
export interface UploadFeedbackState { name: string; src: string | undefined; stage: Stage; progress: number | null }
const labels: Record<Stage, string> = { queued: "等待上传", signing: "准备上传", uploading: "正在上传", processing: "图片处理中", adding: "正在加入项目", done: "已加入项目", failed: "上传未完成", canceled: "已取消" };

/** Feedback for existing single-file flows; callers still own business steps and outcomes. */
export function useUploadFeedback() {
  const scope = useDraftScope();
  const activityId = useRef("");
  const [preview, setPreview] = useState<UploadFeedbackState | null>(null);
  const active = useRef<{ controller: AbortController; url?: string; frame?: number | undefined; value: UploadFeedbackState } | null>(null);
  const dispose = () => {
    const record = active.current;
    if (!record) return;
    record.controller.abort(new DOMException("已取消上传", "AbortError"));
    if (record.url) { URL.revokeObjectURL(record.url); delete record.url; }
    if (record.frame !== undefined) cancelAnimationFrame(record.frame);
    active.current = null;
    removeLocalActivity(activityId.current);
  };
  const clear = () => { dispose(); setPreview(null); };
  useEffect(() => {
    const changed = () => { dispose(); setPreview(null); };
    window.addEventListener("fashion:session-changed", changed);
    return () => { dispose(); window.removeEventListener("fashion:session-changed", changed); };
  }, []);
  const start = (file: File) => {
    dispose();
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
    const record = { controller: new AbortController(), ...(url ? { url } : {}), value: { name: file.name, src: url, stage: "queued" as Stage, progress: null as number | null }, frame: undefined as number | undefined };
    activityId.current = crypto.randomUUID();
    active.current = record; setPreview({ ...record.value });
    const update = () => { if (active.current === record) {
      setPreview({ ...record.value });
      if (scope) setLocalActivity({ id: activityId.current, accountId: scope.accountId, projectId: scope.projectId, name: file.name, stage: record.value.stage, cancel: () => { record.controller.abort(); record.value.stage = "canceled"; update(); } });
    } };
    update();
    const release = () => { if (record.url) { URL.revokeObjectURL(record.url); delete record.url; } };
    return {
      signal: record.controller.signal,
      stage(stage: "signing" | "uploading" | "processing" | "adding") { record.value.stage = stage; update(); },
      onProgress(value: { loaded: number; total: number; lengthComputable: boolean }) {
        record.value.progress = value.lengthComputable && value.total > 0 ? Math.min(1, Math.max(0, value.loaded / value.total)) : null;
        if (record.frame !== undefined || active.current !== record) return;
        record.frame = requestAnimationFrame(() => { record.frame = undefined; update(); });
      },
      done(previewUrl?: string | null) { release(); record.value = { ...record.value, stage: "done", src: previewUrl ?? undefined }; update(); },
      fail() { record.value.stage = record.controller.signal.aborted ? "canceled" : "failed"; update(); },
      cancel() { record.controller.abort(new DOMException("已取消上传", "AbortError")); release(); record.value = { ...record.value, src: undefined, stage: "canceled" }; update(); },
    };
  };
  const cancel = () => {
    const record = active.current;
    if (!record) return;
    if (record.frame !== undefined) { cancelAnimationFrame(record.frame); record.frame = undefined; }
    record.controller.abort(new DOMException("已取消上传", "AbortError"));
    if (record.url) { URL.revokeObjectURL(record.url); delete record.url; }
    record.value = { ...record.value, src: undefined, stage: "canceled" }; setPreview({ ...record.value });
  };
  return { preview, start, clear, cancel };
}

export function UploadFeedbackPreview({ preview, onCancel, onClear }: { readonly preview: UploadFeedbackState | null; readonly onCancel?: (() => void) | undefined; readonly onClear?: (() => void) | undefined }) {
  if (!preview) return null;
  const busy = !["done", "failed", "canceled"].includes(preview.stage);
  const progress = preview.stage === "uploading" ? preview.progress : null;
  return <section className={styles.card} data-upload-stage={preview.stage} aria-label={`${preview.name}上传状态`}>
    <div className={styles.picture}>
      {preview.src ? <ImagePreview src={preview.src} alt={`${preview.name}本地预览`} retryable={false} /> : <span>图片文件</span>}
      {progress !== null ? <i aria-hidden="true" className={styles.mask} style={{ transform: `scaleY(${1 - progress})` }} /> : null}
    </div>
    <div className={styles.details}><strong>{preview.name}</strong><span role="status">{labels[preview.stage]}{progress !== null ? ` ${Math.round(progress * 100)}%` : ""}</span>
      {busy && onCancel ? <Button size="small" onClick={onCancel}>取消上传</Button> : !busy && onClear ? <Button size="small" onClick={onClear}>收起上传状态</Button> : null}
    </div>
  </section>;
}
