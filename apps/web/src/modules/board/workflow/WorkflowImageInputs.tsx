"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
  type UploadedFile,
} from "../file-upload-api";
import { decodeFabricDragPayload, FABRIC_DRAG_MIME } from "../fabric-drag";
import type { Editor } from "tldraw";
import type { WorkflowAssetType } from "./workflow-api";
import { privateRequestSignal } from "../../auth/private-fetch";
import styles from "./workflow-upload.module.css";

interface Item {
  id: string;
  file: File;
  point: { x: number; y: number };
  ready?: UploadedFile;
  error?: string;
  done?: boolean;
  preview?: string;
  stage: "queued" | "signing" | "uploading" | "processing" | "adding" | "done" | "canceled" | "failed";
  progress?: number;
  controller: AbortController;
}
const stageLabels = { queued: "等待上传", signing: "准备上传", uploading: "正在上传", processing: "图片处理中", adding: "正在加入项目", done: "已加入项目", canceled: "已取消", failed: "上传未完成" };
export function WorkflowImageInputs({
  children,
  projectId,
  editor,
  onAdd,
}: {
  children: ReactNode;
  projectId: string;
  editor: () => Editor | null;
  onAdd: (
    type: WorkflowAssetType,
    title: string,
    payload: Record<string, unknown>,
    point: { x: number; y: number },
  ) => Promise<unknown>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());
  const alive = useRef(true);
  const records = useRef(new Map<string, Item>());
  const progressFrames = useRef(new Map<string, number>());
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      for (const item of records.current.values()) {
        item.controller.abort();
        if (item.preview) URL.revokeObjectURL(item.preview);
        delete item.preview;
      }
      for (const frame of progressFrames.current.values()) cancelAnimationFrame(frame);
      progressFrames.current.clear();
    };
    const accountChanged = () => { clear(); records.current.clear(); setItems([]); };
    window.addEventListener("fashion:session-changed", accountChanged);
    return () => { alive.current = false; clear(); window.removeEventListener("fashion:session-changed", accountChanged); };
  }, []);
  const locate = (x?: number, y?: number) =>
    x !== undefined && y !== undefined
      ? (editor()?.screenToPage({ x, y }) ?? { x: 0, y: 0 })
      : (editor()?.getViewportPageBounds().center ?? { x: 0, y: 0 });
  const update = (item: Item) => {
    if (!alive.current) return;
    setItems((current) =>
      current.map((value) => (value.id === item.id ? { ...item } : value)),
    );
  };
  const phase = (item: Item, stage: Item["stage"]) => { item.stage = stage; update(item); };
  const remove = (item: Item) => {
    item.controller.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
    delete item.preview;
    const frame = progressFrames.current.get(item.id);
    if (frame) cancelAnimationFrame(frame);
    progressFrames.current.delete(item.id);
    records.current.delete(item.id);
    setItems((current) => current.filter((value) => value.id !== item.id));
  };
  const run = (item: Item) => {
    item.controller = new AbortController();
    if (!item.preview && !item.ready && !validateImage(item.file) && ["image/jpeg", "image/png", "image/webp"].includes(item.file.type)) item.preview = URL.createObjectURL(item.file);
    records.current.set(item.id, item);
    phase(item, "queued");
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (!alive.current || item.controller.signal.aborted || !records.current.has(item.id)) return;
        const signal = privateRequestSignal(item.controller.signal);
        setBusy(true);
        delete item.error;
        update(item);
        try {
          const invalid = validateImage(item.file);
          if (invalid) throw new Error(invalid);
          if (!item.ready) {
            phase(item, "signing");
            const signed = await signImageUpload(projectId, item.file, signal);
            signal.throwIfAborted();
            phase(item, signed.upload ? "uploading" : "processing");
            const processing = signed.upload
              ? await putOriginal(signed.upload, item.file, { signal, onProgress: (progress) => {
                  if (signal.aborted) return;
                  if (progress.lengthComputable && progress.total > 0) item.progress = Math.min(1, progress.loaded / progress.total);
                  else delete item.progress;
                  if (!progressFrames.current.has(item.id)) progressFrames.current.set(item.id, requestAnimationFrame(() => {
                    progressFrames.current.delete(item.id);
                    update(item);
                  }));
                } }).then(() => {
                  phase(item, "processing");
                  return completeUpload(signed.file.id, signal);
                },
                )
              : signed.file;
            item.ready = await waitForThumbnail(signed.file.id, processing, 60_000, signal);
          }
          signal.throwIfAborted();
          phase(item, "adding");
          await onAdd(
            "reference_image",
            item.file.name.slice(0, 200),
            {
              fileAssetId: item.ready.id,
            sourceName: item.file.name,
              imageUrl:
                item.ready.thumbnail1024Url ?? item.ready.thumbnail256Url ?? "",
              width: item.ready.width,
              height: item.ready.height,
              role: "style_ref",
              roleSource: "default",
              roleInferenceState: "pending",
            },
            item.point,
          );
          item.done = true;
          phase(item, "done");
          if (item.preview) URL.revokeObjectURL(item.preview);
          delete item.preview;
        } catch (cause) {
          if (signal.aborted) phase(item, "canceled");
          else { item.error = cause instanceof Error ? cause.message : "图片上传失败"; phase(item, "failed"); }
        } finally {
          update(item);
          if (alive.current) setBusy(false);
        }
      });
  };
  const add = (files: File[], point = locate()) => {
    const next = files.map((file, index): Item => ({
      file,
      id: crypto.randomUUID(),
      controller: new AbortController(),
      stage: "queued",
      ...(!validateImage(file) && ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? { preview: URL.createObjectURL(file) } : {}),
      point: { x: point.x + index * 60, y: point.y + index * 60 },
    }));
    next.forEach((item) => records.current.set(item.id, item));
    setItems((current) => [...current, ...next]);
    next.forEach(run);
  };
  useEffect(() => {
    const open = () => input.current?.click();
    window.addEventListener("fashion:upload-images", open);
    return () => window.removeEventListener("fashion:upload-images", open);
  }, []);
  return (
    <div
      style={{ position: "relative", height: "100%" }}
      onPasteCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("input,textarea,[contenteditable=true]")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.clipboardData.files);
        if (files.length) add(files);
      }}
      onDragOverCapture={(event) => {
        if (
          Array.from(event.dataTransfer.types).some((type) =>
            ["Files", FABRIC_DRAG_MIME, "application/x-fashion-trend"].includes(
              type,
            ),
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDropCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const point = locate(event.clientX, event.clientY);
        const trendRaw = event.dataTransfer.getData(
          "application/x-fashion-trend",
        );
        if (trendRaw) {
          try {
            const trend = JSON.parse(trendRaw);
            if (
              typeof trend.trendItemId !== "string" ||
              !trend.trendItemId ||
              typeof trend.title !== "string"
            )
              throw new Error("趋势拖拽数据无效");
            void onAdd(
              "trend",
              trend.title.slice(0, 200),
              {
                trendItemId: trend.trendItemId,
                imageUrl:
                  typeof trend.imageUrl === "string" ? trend.imageUrl : null,
                text: typeof trend.text === "string" ? trend.text : "",
              },
              point,
            ).catch((cause) => setError(String(cause)));
          } catch {
            setError("趋势拖拽数据无效");
          }
          return;
        }
        const raw = event.dataTransfer.getData(FABRIC_DRAG_MIME);
        if (raw) {
          const fabric = decodeFabricDragPayload(raw);
          if (fabric)
            void onAdd(
              "fabric",
              fabric.fabricTags.join(" · ").slice(0, 200),
              { fabricId: fabric.fabricId, imageUrl: fabric.thumbnailUrl },
              point,
            ).catch((cause) => setError(String(cause)));
          else setError("面料拖拽数据无效");
        } else add(Array.from(event.dataTransfer.files), point);
      }}
    >
      {children}
      <input
        ref={input}
        hidden
        multiple
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {items.length || error ? (
        <div
          className={styles.tray}
          aria-label="图片上传"
        >
          {error}
          {items
            .map((item) => (
              <div key={item.id} className={styles.item} data-stage={item.stage}>
                <div className={styles.preview} aria-hidden="true">
                  {item.preview || item.ready?.thumbnail256Url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.preview ?? item.ready?.thumbnail256Url ?? ""} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                  ) : <span>{item.file.name.split(".").at(-1)?.toUpperCase() ?? "图片"}</span>}
                  {item.stage === "uploading" && item.progress !== undefined ? <span className={styles.shade} style={{ transform: `scaleY(${1 - item.progress})` }} /> : null}
                  {item.done ? <span className={styles.check}>✓</span> : null}
                </div>
                <div className={styles.description}><strong>{item.file.name}</strong><span role={item.error ? "alert" : "status"}>{item.error ?? stageLabels[item.stage]}</span>
                  {item.stage === "uploading" ? <progress aria-label={`${item.file.name} 上传进度`} max={1} {...(item.progress === undefined ? {} : { value: item.progress })} /> : null}
                </div>
                {item.error || item.stage === "canceled" || item.done ? <button aria-label="关闭提示" type="button" onClick={() => remove(item)}>关闭</button> : item.stage !== "adding" ? <button type="button" onClick={() => {
                  const record = records.current.get(item.id) ?? item;
                  record.controller.abort();
                  if (record.preview) URL.revokeObjectURL(record.preview);
                  delete record.preview;
                  phase(record, "canceled");
                }}>取消</button> : null}
                {item.error || item.stage === "canceled" ? (
                  <button
                    disabled={busy}
                    onClick={() => run(item)}
                    type="button"
                  >
                    重试
                  </button>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
