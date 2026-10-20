"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Dialog, Input, SegmentedControl } from "../../../components/ui";
import controls from "../../../components/ui.module.css";

import {
  completeUpload,
  putOriginal,
  signImageUpload,
  waitForThumbnail,
} from "../file-upload-api";
import styles from "./workflow-asset-workspace.module.css";

interface Point { readonly x: number; readonly y: number }
interface Stroke {
  readonly color: string;
  readonly width: number;
  readonly points: Point[];
}

export interface WorkflowSketchEditorProps {
  readonly projectId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (asset: { fileAssetId: string; title: string; imageUrl?: string }) => Promise<void> | void;
}

const SIZE = 900;
const COLORS = ["#243441", "#415f8c", "#a66a50"] as const;
const BRUSHES = [3, 7, 13] as const;

export function WorkflowSketchEditor({ projectId, open, onClose, onCreated }: WorkflowSketchEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [title, setTitle] = useState("廓形草图");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [brush, setBrush] = useState<number>(BRUSHES[1]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAsset, setPendingAsset] = useState<{ fileAssetId: string; title: string; imageUrl?: string } | null>(null);

  const redraw = useCallback(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, SIZE, SIZE);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      const first = stroke.points[0];
      if (!first) continue;
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = stroke.width;
      if (stroke.points.length === 1) {
        context.beginPath();
        context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }, []);

  useEffect(() => { if (open) redraw(); }, [open, redraw]);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (event.target instanceof HTMLElement && event.target.matches("input, textarea")) return;
        if (saving || pendingAsset) return;
        event.preventDefault();
        strokesRef.current.pop();
        setStrokeCount(strokesRef.current.length);
        redraw();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, pendingAsset, redraw, saving]);

  const pointFrom = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SIZE, (event.clientX - bounds.left) * SIZE / bounds.width)),
      y: Math.max(0, Math.min(SIZE, (event.clientY - bounds.top) * SIZE / bounds.height)),
    };
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (saving || pendingAsset) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    strokesRef.current.push({ color, width: brush, points: [pointFrom(event)] });
    setStrokeCount(strokesRef.current.length);
    setError(null);
    redraw();
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    strokesRef.current.at(-1)?.points.push(pointFrom(event));
    redraw();
  };
  const pointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const undo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
  };
  const clear = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  };

  const save = async () => {
    if (!pendingAsset && (!canvasRef.current || !strokeCount || !title.trim())) return;
    setSaving(true);
    setError(null);
    try {
      let asset = pendingAsset;
      if (!asset) {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvasRef.current?.toBlob((value) => value ? resolve(value) : reject(new Error("草图导出失败")), "image/png");
        });
        const file = new File([blob], `${title.trim().slice(0, 80)}.png`, { type: "image/png" });
        const signed = await signImageUpload(projectId, file);
        const processing = signed.upload
          ? await putOriginal(signed.upload, file).then(() => completeUpload(signed.file.id))
          : signed.file;
        const ready = await waitForThumbnail(signed.file.id, processing);
        const imageUrl = ready.thumbnail1024Url ?? ready.thumbnail256Url;
        asset = {
          fileAssetId: ready.id,
          title: title.trim(),
          ...(imageUrl ? { imageUrl } : {}),
        };
        setPendingAsset(asset);
      }
      await onCreated(asset);
      setPendingAsset(null);
      clear();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草图保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
      <Dialog label="绘制廓形草图" className={`${styles.sketchDialog} ${controls.controlSurface}`} returnFocusSelector="[data-material-trigger]" onClose={() => { if (!saving) onClose(); }}>
        <header className={styles.header}>
          <div><span>草图素材</span><h2>绘制廓形草图</h2></div>
          <Button aria-label="关闭草图编辑器" disabled={saving} onClick={onClose} variant="ghost">关闭</Button>
        </header>
        <div className={styles.sketchBody}>
          <div className={styles.sketchCanvasWrap}>
            <canvas
              aria-label="廓形草图画布"
              className={styles.sketchCanvas}
              height={SIZE}
              onPointerCancel={pointerEnd}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerEnd}
              ref={canvasRef}
              width={SIZE}
            />
          </div>
          <aside className={styles.sketchControls}>
            <label>素材名称<Input disabled={Boolean(pendingAsset) || saving} maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
            <fieldset><legend>画笔颜色</legend><div className={styles.options}>{COLORS.map((item) => <button aria-label={`选择颜色 ${item}`} aria-pressed={color === item} className={styles.colorChoice} key={item} onClick={() => setColor(item)} style={{ backgroundColor: item }} type="button" />)}</div></fieldset>
            <fieldset><legend>笔触粗细</legend><SegmentedControl label="笔触粗细" value={String(brush)} onChange={(value) => setBrush(Number(value))} options={BRUSHES.map((item) => ({ value: String(item), label: item === BRUSHES[0] ? "细" : item === BRUSHES[1] ? "中" : "粗" }))} /></fieldset>
            <div className={styles.options}><Button disabled={!strokeCount || saving || Boolean(pendingAsset)} onClick={undo}>撤销一笔</Button><Button disabled={!strokeCount || saving || Boolean(pendingAsset)} onClick={clear}>清空</Button></div>
            <p>草图保存后成为参考素材节点。可用鼠标、触控笔或触屏绘制。</p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <Button variant="primary" disabled={(!pendingAsset && (!strokeCount || !title.trim())) || saving} onClick={() => void save()}>{saving ? "正在保存草图…" : pendingAsset ? "重试加入工作流" : "保存到工作流"}</Button>
          </aside>
        </div>
      </Dialog>
  );
}
