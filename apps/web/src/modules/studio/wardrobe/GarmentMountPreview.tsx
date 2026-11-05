"use client";

import { useLayoutEffect, useRef } from "react";
import type { WardrobeRevisionView } from "@fashion/shared";
import { GarmentDisplay } from "./GarmentDisplay";
import { useWardrobeImageBounds } from "./wardrobe-image-bounds";
import { previewBackgroundStyle, type PreviewBackground } from "./PreviewBackground";
import styles from "./garment-mount-preview.module.css";

type MountItem = Pick<WardrobeRevisionView, "category" | "display" | "anchor" | "url" | "name" | "assetId" | "imageBounds" | "presentation">;

/** Fits the actual garment and hardware together without changing their relative mount. */
export function GarmentMountPreview({ projectId, item, view = "front", background = "scene" }: { projectId: string; item: MountItem; view?: "front" | "side"; background?: PreviewBackground }) {
  const imageBounds = useWardrobeImageBounds(projectId, item.assetId, item.imageBounds);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const schedule = useRef<(() => void) | null>(null);
  const transform = useRef({ scale: 1, x: 0, y: 0 });

  useLayoutEffect(() => {
    const viewport = stage.current;
    const content = scene.current;
    if (!viewport || !content) return;
    let frame = 0;
    const fit = () => {
      const outer = viewport.getBoundingClientRect();
      if (!outer.width || !outer.height) return;
      const bounds = [...content.querySelectorAll("img, svg, [data-side-placeholder]")]
        .filter(element => {
          if (getComputedStyle(element).visibility === "hidden") return false;
          const owner = element.closest<HTMLElement>("[data-image-view]");
          return !owner || owner.dataset.imageView === owner.closest<HTMLElement>("[data-garment]")?.dataset.view;
        })
        .map(element => {
          const box = element.getBoundingClientRect();
          const visibleBounds = element.closest<HTMLElement>("[data-image-view]")?.dataset.imageView === "side" ? item.presentation?.sideDisplay?.imageBounds : imageBounds;
          if (!(element instanceof HTMLImageElement) || !visibleBounds) return box;
          const left = box.left + box.width * visibleBounds.x / visibleBounds.width;
          const top = box.top + box.height * visibleBounds.y / visibleBounds.height;
          const width = box.width * visibleBounds.contentWidth / visibleBounds.width;
          const height = box.height * visibleBounds.contentHeight / visibleBounds.height;
          return { left, top, width, height, right: left + width, bottom: top + height };
        })
        .filter(box => box.width > 0 && box.height > 0);
      if (!bounds.length) return;
      const current = transform.current;
      const left = (Math.min(...bounds.map(box => box.left)) - outer.left - current.x) / current.scale;
      const top = (Math.min(...bounds.map(box => box.top)) - outer.top - current.y) / current.scale;
      const width = (Math.max(...bounds.map(box => box.right)) - Math.min(...bounds.map(box => box.left))) / current.scale;
      const height = (Math.max(...bounds.map(box => box.bottom)) - Math.min(...bounds.map(box => box.top))) / current.scale;
      const scale = Math.min(1, (outer.width - 32) / width, (outer.height - 32) / height);
      const next = { scale, x: (outer.width - width * scale) / 2 - left * scale, y: (outer.height - height * scale) / 2 - top * scale };
      transform.current = next;
      content.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    };
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    schedule.current = queue;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queue);
    observer?.observe(viewport);
    content.querySelectorAll("img, svg").forEach(element => observer?.observe(element));
    queue();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); schedule.current = null; };
  }, [item.url, item.category, item.display, item.anchor.x, item.anchor.y, item.presentation, imageBounds, view]);

  return (
    <details className={styles.preview} open>
      <summary>挂架预览</summary>
      <p className={styles.hint}>使用当前候选查看挂点和挂具的衔接。调整后请再核对；这里不会生成或确认入架。</p>
      <div ref={stage} className={styles.stage} data-preview-background={background} style={previewBackgroundStyle(background)} role="img" aria-label={`挂架预览：${item.name || "待确认单品"}`}>
        <div ref={scene} className={styles.scene} onLoadCapture={() => schedule.current?.()} onErrorCapture={() => schedule.current?.()}>
          <GarmentDisplay key={item.assetId} projectId={projectId} item={imageBounds ? { ...item, imageBounds } : item} view={view} large />
        </div>
      </div>
    </details>
  );
}
