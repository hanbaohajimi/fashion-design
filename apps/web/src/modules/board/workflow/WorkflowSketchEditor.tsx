"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { sketchDocumentSchema, type SketchDocumentV1 } from "@fashion/shared";
import { Button, Input } from "../../../components/ui";
import { EmbeddedEditor } from "./EmbeddedEditor";
import { useWorkspaceDraft } from "./workspace-drafts";
import { useAuth } from "../../auth/AuthProvider";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  waitForThumbnail,
} from "../file-upload-api";
import { splitStrokeByEraser } from "./sketch-eraser";
import type { WorkflowNode } from "./workflow-api";
import styles from "./workflow-asset-workspace.module.css";

export interface SketchAsset {
  fileAssetId: string;
  title: string;
  imageUrl?: string;
  sketchDocument: SketchDocumentV1;
}
interface Props {
  embedded?: boolean;
  ignoreStoredDraft?: boolean;
  projectId: string;
  open: boolean;
  node?: WorkflowNode | null;
  onClose: () => void;
  onCreated: (asset: SketchAsset) => Promise<void> | void;
}
const blank = (): SketchDocumentV1 => ({
  version: 1,
  width: 640,
  height: 860,
  strokes: [],
});

export function WorkflowSketchEditor({
  embedded,
  ignoreStoredDraft,
  projectId,
  open,
  node,
  onClose,
  onCreated,
}: Props) {
  const auth = useAuth();
  const [owner] = useState(auth.session?.user.id);
  const key = `fashion-sketch:${owner ?? "anonymous"}:${projectId}:${node?.id ?? "new"}`;
  const initial = () => {
    const parsed = sketchDocumentSchema.safeParse(node?.payload.sketchDocument);
    return parsed.success
      ? parsed.data
      : {
          ...blank(),
          width:
            typeof node?.payload.width === "number" ? node.payload.width : 640,
          height:
            typeof node?.payload.height === "number"
              ? node.payload.height
              : 860,
          ...(typeof node?.payload.fileAssetId === "string"
            ? { baseFileAssetId: node.payload.fileAssetId }
            : {}),
        };
  };
  const [restored] = useState(() => {
    if (ignoreStoredDraft) return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        const parsed = sketchDocumentSchema.safeParse(value.document);
        if (parsed.success)
          return { document: parsed.data, title: String(value.title) };
      }
    } catch {
      /* Start with the server document when storage is unavailable. */
    }
    return null;
  });
  const [doc, setDoc] = useState<SketchDocumentV1>(
    () => restored?.document ?? initial(),
  );
  const [title, setTitle] = useState(
    restored?.title ?? node?.title ?? "廓形草图",
  );
  const [color, setColor] = useState("#45423D");
  const [brush, setBrush] = useState(1.05);
  const [eraser, setEraser] = useState(false);
  const [radius, setRadius] = useState(14);
  const [zoom, setZoom] = useState(0.65);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<SketchAsset | null>(null);
  const [dirty, setDirty] = useState(Boolean(restored));
  const [closing, setClosing] = useState(false);
  const [undo, setUndo] = useState<SketchDocumentV1[]>([]);
  const [redo, setRedo] = useState<SketchDocumentV1[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLImageElement | null>(null);
  const active = useRef<{ id: number; x: number; y: number } | null>(null);
  const [loadedBase, setLoadedBase] = useState<string | null>(null);
  const baseReady = !doc.baseFileAssetId || loadedBase === doc.baseFileAssetId;
  useEffect(() => {
    if (ignoreStoredDraft) { try { localStorage.removeItem(key); } catch { /* Local recovery is optional. */ } }
  }, [ignoreStoredDraft, key]);
  useWorkspaceDraft("sketch", { doc, title, undo, redo }, embedded === true && dirty, saving || Boolean(pending));

  useEffect(() => {
    if (!dirty || !owner || auth.session?.user.id !== owner) return;
    try {
      localStorage.setItem(key, JSON.stringify({ title, document: doc }));
    } catch {
      queueMicrotask(() => setError("本地草稿空间不足，请保持窗口打开并保存"));
    }
  }, [dirty, doc, key, title, owner, auth.session?.user.id]);
  useEffect(() => {
    base.current = null;
    if (!doc.baseFileAssetId) return;
    const baseId = doc.baseFileAssetId;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      base.current = img;
      if (!restored && !node?.payload.sketchDocument && !node?.payload.width) setDoc(current => ({ ...current, width: img.naturalWidth, height: img.naturalHeight }));
      setLoadedBase(baseId);
    };
    img.onerror = () => setError("草图底图读取失败，请重新打开后重试");
    img.src = `/api/files/${encodeURIComponent(doc.baseFileAssetId)}/thumbnail/1024`;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [doc.baseFileAssetId, restored, node?.payload.sketchDocument, node?.payload.width]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, doc.width, doc.height);
    if (base.current) ctx.drawImage(base.current, 0, 0, doc.width, doc.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of doc.strokes) {
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.globalAlpha = stroke.opacity;
      const first = stroke.points[0];
      if (!first) continue;
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      stroke.points.slice(1).forEach((point, index) => {
        const previous = stroke.points[index];
        if (!previous) return;
        ctx.lineWidth = stroke.width * (0.5 + point.pressure);
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
  }, [doc, baseReady]);
  const change = (next: SketchDocumentV1) => {
    setDoc(next);
    setDirty(true);
    setPending(null);
  };
  const history = (forward: boolean) => {
    const stack = forward ? redo : undo;
    const previous = stack.at(-1);
    if (!previous || saving || pending) return;
    if (forward) {
      setRedo(stack.slice(0, -1));
      setUndo([...undo, doc]);
    } else {
      setUndo(stack.slice(0, -1));
      setRedo([...redo, doc]);
    }
    change(previous);
  };
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          doc.width,
          ((event.clientX - bounds.left) * doc.width) / bounds.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          doc.height,
          ((event.clientY - bounds.top) * doc.height) / bounds.height,
        ),
      ),
      pressure: event.pointerType === "pen" ? event.pressure : 0.5,
    };
  };
  const eraseAt = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) =>
    change({
      ...doc,
      strokes: doc.strokes.flatMap((stroke) =>
        splitStrokeByEraser(
          stroke.points.map((p) => ({ ...p, z: p.pressure })),
          from,
          to,
          radius / zoom,
        ).map((points, index) => ({
          ...stroke,
          id: `${stroke.id}-${index}`,
          points: points.map((p) => ({ x: p.x, y: p.y, pressure: p.z ?? 0.5 })),
        })),
      ),
    });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const document = sketchDocumentSchema.parse(doc);
      let asset = pending;
      if (!asset) {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.current?.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("草图导出失败")),
            "image/png",
          ),
        );
        const file = new File([blob], "sketch.png", { type: "image/png" });
        const signed = await signImageUpload(projectId, file);
        const processing = signed.upload
          ? await putOriginal(signed.upload, file).then(() =>
              completeUpload(signed.file.id),
            )
          : signed.file;
        const ready = await waitForThumbnail(signed.file.id, processing);
        asset = {
          fileAssetId: ready.id,
          title: title.trim(),
          imageUrl: ready.thumbnail1024Url ?? ready.thumbnail256Url ?? "",
          sketchDocument: document,
        };
        setPending(asset);
      }
      await onCreated(asset);
      try {
        localStorage.removeItem(key);
      } catch {
        /* Saved remotely. */
      }
      setDirty(false);
      setPending(null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草图保存失败");
    } finally {
      setSaving(false);
    }
  };
  if (!open) return null;
  const close = () => {
    if (!saving) {
      if (dirty && !embedded) setClosing(true);
      else onClose();
    }
  };
  return (
    <EmbeddedEditor
      embedded={embedded}
      label="绘制廓形草图"
      className={styles.sketchDialog}
      returnFocusSelector="[data-material-trigger]"
      onClose={close}
    >
      <header className={styles.header}>
        <div><h2>廓形草图</h2></div>
        <Button disabled={saving} onClick={close}>
          关闭
        </Button>
      </header>
      <div
        className={styles.sketchBody}
        onKeyDown={(event) => {
          if (
            !(
              event.target instanceof HTMLElement &&
              event.target.matches("input,textarea")
            ) &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "z"
          ) {
            event.preventDefault();
            history(event.shiftKey);
          }
        }}
      >
        <div
          className={styles.sketchCanvasWrap}
          style={{ overflow: "auto", maxHeight: "65vh" }}
        >
          <canvas
            aria-label="廓形草图画布"
            ref={canvas}
            width={doc.width}
            height={doc.height}
            style={{
              width: 640 * zoom,
              maxWidth: "none",
              height: "auto",
              touchAction: "none",
            }}
            onPointerDown={(event) => {
              if (saving || pending) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const p = point(event);
              active.current = { id: event.pointerId, ...p };
              setUndo([...undo, doc]);
              setRedo([]);
              if (eraser) eraseAt(p, p);
              else
                change({
                  ...doc,
                  strokes: [
                    ...doc.strokes,
                    {
                      id: crypto.randomUUID(),
                      color,
                      width: brush,
                      opacity: 0.76,
                      points: [p],
                    },
                  ],
                });
            }}
            onPointerMove={(event) => {
              if (active.current?.id !== event.pointerId) return;
              const p = point(event);
              if (eraser) eraseAt(active.current, p);
              else
                change({
                  ...doc,
                  strokes: doc.strokes.map((stroke, index) =>
                    index === doc.strokes.length - 1
                      ? { ...stroke, points: [...stroke.points, p] }
                      : stroke,
                  ),
                });
              active.current = { id: event.pointerId, ...p };
            }}
            onPointerUp={() => {
              active.current = null;
            }}
            onPointerCancel={() => {
              active.current = null;
            }}
          />
        </div>
        <aside className={styles.sketchControls}>
          <label>
            素材名称
            <Input
              autoFocus
              aria-label="素材名称"
              maxLength={80}
              value={title}
              disabled={saving || Boolean(pending)}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <Button aria-pressed={!eraser} onClick={() => setEraser(false)}>
            石墨铅笔
          </Button>
          <Button aria-pressed={eraser} onClick={() => setEraser(true)}>
            局部橡皮
          </Button>
          <label>
            画笔颜色
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {["#45423D", "#706B63", "#243441", "#415f8c", "#a66a50"].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </label>
          <label>
            笔触粗细
            <select
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            >
              {[0.42, 1.05, 2.1, 7, 13].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            橡皮大小
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            >
              {[8, 14, 24].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <div>
            <Button
              disabled={!undo.length || saving || Boolean(pending)}
              onClick={() => history(false)}
            >
              撤销
            </Button>
            <Button
              disabled={!redo.length || saving || Boolean(pending)}
              onClick={() => history(true)}
            >
              重做
            </Button>
            <Button
              disabled={saving || Boolean(pending)}
              onClick={() => {
                setUndo([...undo, doc]);
                setRedo([]);
                change({ ...doc, strokes: [] });
              }}
            >
              清空
            </Button>
          </div>
          <label>
            缩放
            <input
              aria-label="草图缩放"
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <Button onClick={() => setZoom(0.65)}>适配纸张</Button>
          {doc.baseFileAssetId ? (
            <p>底图保持原样，橡皮只擦除新增笔画。</p>
          ) : null}
          {node && node.canEditPayload !== true ? (
            <p>保存为新草图，原执行记录保持完整。</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <Button
            disabled={
              saving ||
              !baseReady ||
              !title.trim() ||
              (!doc.strokes.length && !doc.baseFileAssetId)
            }
            onClick={() => void save()}
          >
            {saving ? "正在保存…" : pending ? "重试加入工作流" : "保存到工作流"}
          </Button>
          {closing ? (
            <div role="alert">
              <p>草图尚未保存</p>
              <Button onClick={() => setClosing(false)}>继续编辑</Button>
              <Button onClick={onClose}>保留草稿并关闭</Button>
              <Button
                onClick={() => {
                  try {
                    localStorage.removeItem(key);
                  } catch {
                    /* Storage unavailable. */
                  }
                  onClose();
                }}
              >
                放弃
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </EmbeddedEditor>
  );
}
