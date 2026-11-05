"use client";

import { useRef, type PointerEvent } from "react";
import { Button, Field, ImagePreview, Input } from "../../../components/ui";
import styles from "./wardrobe.module.css";

export interface ImageRegion { x: number; y: number; width: number; height: number }
export function RegionSelector({ src, region, onChange, purpose = "garment" }: { src: string; region: ImageRegion | null; onChange: (value: ImageRegion | null) => void; purpose?: "garment" | "material-detail" }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const end = point(event);
    onChange({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(start.current.x - end.x), height: Math.abs(start.current.y - end.y) });
  };
  return <div className={styles.stack}>
    <p className={styles.muted}>{purpose === "material-detail" ? "拖出矩形框选择清晰的原图网眼与花纹；也可以填写下方范围。不选择时不额外引用纹理细节。" : "拖出矩形框选择需要提取的单品；也可以填写下方范围。未框选时使用整张图片。"}</p>
    <div className={styles.regionImage} onPointerDown={event => { if (event.button !== 0) return; start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={event => { move(event); start.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { start.current = null; }}>
      <ImagePreview src={src} alt={purpose === "material-detail" ? "框选原图纹理细节" : "框选单品来源图片"} retryable={false} draggable={false} />
      {region ? <span className={styles.region} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} /> : null}
    </div>
    <div className={styles.regionFields}>{(["x", "y", "width", "height"] as const).map((key, index) => <Field key={key} label={["左侧 %", "顶部 %", "宽度 %", "高度 %"][index] ?? key}><Input type="number" min={0} max={100} step={1} value={Math.round((region ?? { x: 0, y: 0, width: 1, height: 1 })[key] * 100)} onChange={event => {
      const next = { ...(region ?? { x: 0, y: 0, width: 1, height: 1 }), [key]: Math.max(0, Math.min(1, Number(event.target.value) / 100)) };
      next.width = Math.min(next.width, 1 - next.x); next.height = Math.min(next.height, 1 - next.y); onChange(next);
    }} /></Field>)}</div>
    {region ? <Button onClick={() => onChange(null)}>{purpose === "material-detail" ? "不额外引用细节" : "使用整张图片"}</Button> : null}
  </div>;
}
