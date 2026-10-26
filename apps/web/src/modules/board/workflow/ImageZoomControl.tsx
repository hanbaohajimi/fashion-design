"use client";
import { useImperativeHandle, useState, type Ref } from "react";

export interface ImageZoomControlHandle { previewZoom: (percent: number | null) => void }
/** 手势预览只更新这一个控件；完整图片工作区仅在手势结束提交缩放。 */
export function ImageZoomControl({ zoom, onChange, ref }: { zoom: number | null; onChange: (zoom: number | null) => void; ref: Ref<ImageZoomControlHandle> }) {
  const [preview, setPreview] = useState<number | null>(null);
  const [committed, setCommitted] = useState(zoom);
  if (committed !== zoom) { setCommitted(zoom); setPreview(null); }
  useImperativeHandle(ref, () => ({ previewZoom: setPreview }), []);
  const value = preview === null ? zoom : Math.round(preview * 100) / 100;
  return <select aria-label="缩放比例" value={value ?? "fit"} onChange={(event) => { setPreview(null); onChange(event.target.value === "fit" ? null : Number(event.target.value)); }}>
    <option value="fit">适合窗口</option>
    {[...new Set([10, 25, 50, 75, 100, 150, 200, 400, ...(value === null ? [] : [value])])].sort((a, b) => a - b).map((percent) => <option key={percent} value={percent}>{Math.round(percent)}%</option>)}
  </select>;
}
