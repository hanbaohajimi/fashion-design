"use client";

import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { WardrobeRevisionView } from "@fashion/shared";
import { ImagePreview } from "../../../components/ui";
import { RackHardware, RACK_HARDWARE_METRICS } from "./RackHardware";
import { useWardrobeImageBounds } from "./wardrobe-image-bounds";
import { garmentGeometry, getShelfDepthRatio } from "./garment-geometry";
import styles from "./wardrobe.module.css";

export const GarmentDisplay = memo(function GarmentDisplay({ item, large = false, projectId, onExtent, view = "front", rackMotion = false }: { item: Pick<WardrobeRevisionView, "category" | "display" | "anchor" | "url" | "name"> & Partial<Pick<WardrobeRevisionView, "assetId" | "imageBounds" | "presentation">>; large?: boolean; projectId?: string | undefined; onExtent?: ((bottom: number, frontBounds: { left: number; right: number }) => void) | undefined; view?: "front" | "side"; rackMotion?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const [loadedRatio, setRatio] = useState(0.72);
  const [sideImageState, setSideImageState] = useState<{ url: string; status: "ready" | "error" } | null>(null);
  const [frontImageState, setFrontImageState] = useState<{ url: string; status: "ready" | "error" } | null>(null);
  const side = item.presentation?.sideDisplay?.reviewed ? item.presentation.sideDisplay : undefined;
  const sideState = side ? sideImageState?.url === side.url ? sideImageState.status : "loading" : undefined;
  const frontState = frontImageState?.url === item.url ? frontImageState.status : "loading";
  // Keep the decoded profile visible if the pointer reaches the rack before the front is decoded.
  const usingSide = sideState === "ready" && (view === "side" || (rackMotion && frontState === "loading"));
  const showSidePlaceholder = !!side && sideState !== "ready" && (view === "side" || (rackMotion && frontState === "loading"));
  const bounds = useWardrobeImageBounds(projectId, item.assetId, item.imageBounds);
  // Fit the garment's alpha bounds, not its transparent export padding. Original pixels stay intact.
  const { ratio, contentWidth, contentHeight, width, hardwareRatio, sideRatio, sideWidthRatio, sideVisibleWidthRatio } = garmentGeometry({ ...item, ...(bounds ? { imageBounds: bounds } : {}) }, large, loadedRatio);
  // A profile's sleeve silhouette is wider than its supported shoulder; turn only the rigid hardware.
  const projectedAngle = Math.acos(Math.max(.12, Math.min(.65, sideVisibleWidthRatio * .7))) * 180 / Math.PI;
  // Broad sleeves and thick coats do not turn the supporting shoulder back toward the camera.
  const supportSideAngle = item.display === "hanger" ? Math.max(80, projectedAngle) : projectedAngle;
  const direction = side?.orientation === "left" ? -1 : 1;
  const frontTurnAngle = Math.acos(Math.max(.2, Math.min(.96, sideVisibleWidthRatio))) * 180 / Math.PI;
  const sideTurnAngle = item.display === "shelf" || item.display === "hook" ? 34 : 68;
  const anchor = RACK_HARDWARE_METRICS.anchors[item.display];
  const frontLeftRatio = hardwareRatio * (anchor.x - RACK_HARDWARE_METRICS.rail.x) / 140 + (bounds ? bounds.x / bounds.width : 0) - item.anchor.x;
  const focusSpanRatio = Math.max(hardwareRatio, Math.abs(frontLeftRatio) * 2, Math.abs(frontLeftRatio + contentWidth) * 2);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !onExtent) return;
    const measure = () => {
      const css = getComputedStyle(node);
      const pixels = Number.parseFloat(css.width);
      const support = node.querySelector<HTMLElement>("[data-hardware-frame]");
      const supportTop = support ? Number.parseFloat(getComputedStyle(support).top) : NaN;
      const offset = Number.isFinite(supportTop) ? supportTop + pixels * hardwareRatio * 8 / 140 : Number.parseFloat(css.getPropertyValue("--support-offset")) || 0;
      const visibleBottom = bounds ? (bounds.y + bounds.contentHeight) / bounds.height : 1;
      const mountY = offset + pixels * hardwareRatio * anchor.y / 140;
      const frontBottom = mountY + pixels / ratio * (visibleBottom - item.anchor.y);
      const sideBottom = side ? mountY + pixels * sideWidthRatio / sideRatio * ((side.imageBounds.y + side.imageBounds.contentHeight) / side.imageBounds.height - side.anchor.y) : frontBottom;
      const mountX = pixels * hardwareRatio * (anchor.x - RACK_HARDWARE_METRICS.rail.x) / 140;
      const left = mountX + pixels * ((bounds ? bounds.x / bounds.width : 0) - item.anchor.x);
      // Reserve the complete hardware viewport, including the tray's lower metal support.
      // Wide reviewed profiles can make that support extend well below the garment itself.
      const hardwareBottom = offset + pixels * hardwareRatio * (RACK_HARDWARE_METRICS.viewBox.y + RACK_HARDWARE_METRICS.viewBox.height) / RACK_HARDWARE_METRICS.viewBox.width;
      onExtent(Math.max(frontBottom, sideBottom, hardwareBottom), { left, right: left + pixels * contentWidth });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    measure();
    return () => observer?.disconnect();
  }, [bounds, ratio, contentWidth, hardwareRatio, anchor.x, anchor.y, item.anchor.x, item.anchor.y, onExtent, side, sideWidthRatio, sideRatio]);
  const geometry = {
    "--piece-width": `${width}px`, "--piece-ratio": ratio, "--content-width": contentWidth, "--content-height": contentHeight,
    "--hardware-ratio": hardwareRatio,
    "--focus-span-ratio": focusSpanRatio,
    "--hardware-anchor-x": (anchor.x - RACK_HARDWARE_METRICS.rail.x) / 140,
    "--hardware-anchor-y": anchor.y / 140,
    "--anchor-x": `${item.anchor.x * 100}%`, "--anchor-y": `${item.anchor.y * 100}%`,
    "--front-above-mount": item.anchor.y - (bounds ? bounds.y / bounds.height : 0),
    "--garment-mask": `url(${JSON.stringify(item.url)})`,
    "--side-width-ratio": sideWidthRatio, "--side-image-ratio": sideRatio,
    "--side-anchor-x": `${(side?.anchor.x ?? .5) * 100}%`, "--side-anchor-y": `${(side?.anchor.y ?? .08) * 100}%`,
    "--support-side-angle": `${direction * supportSideAngle}deg`,
    "--front-turn-angle": `${direction * frontTurnAngle}deg`,
    "--side-turn-angle": `${-direction * sideTurnAngle}deg`,
  } as CSSProperties;
  return <span ref={element} className={styles.garment} data-garment data-display={item.display} data-large={large || undefined} data-presentation={side ? "dual-view" : "projection"} data-view={showSidePlaceholder ? "placeholder" : usingSide ? "side" : "front"} data-side-state={sideState} data-rack-turn={rackMotion && !!side || undefined} style={geometry}>
    <span className={styles.support} data-hardware-frame><RackHardware display={item.display} shelfDepth={getShelfDepthRatio(item) * 140} /></span>
    {/* A shallow alpha-derived edge adds thickness without inventing a back view or tinting the artwork. */}
    <span className={styles.garmentVolume} aria-hidden="true" />
    <span className={styles.garmentImage} data-image-view="front" onErrorCapture={rackMotion ? () => setFrontImageState({ url: item.url, status: "error" }) : undefined} onLoadCapture={event => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
    }}>
      <ImagePreview src={item.url} alt={item.name} draggable={false} retryable={false} revealOnLoad={!rackMotion} onReady={rackMotion ? () => setFrontImageState({ url: item.url, status: "ready" }) : undefined} />
    </span>
    {side ? <span className={styles.sideImage} data-image-view="side" aria-hidden="true" onErrorCapture={() => setSideImageState({ url: side.url, status: "error" })} onLoadCapture={event => {
      if (!rackMotion && event.target instanceof HTMLImageElement && event.target.naturalWidth) setSideImageState({ url: side.url, status: "ready" });
    }}><ImagePreview key={side.url} src={side.url} alt={`${item.name}侧挂展示`} draggable={false} retryable={false} revealOnLoad={!rackMotion} onReady={rackMotion ? () => setSideImageState({ url: side.url, status: "ready" }) : undefined} /></span> : null}
    {showSidePlaceholder ? <span className={styles.sidePlaceholder} data-side-placeholder role="status" aria-live="off" aria-label={sideState === "error" ? "侧挂图暂不可用，点击查看正面" : "侧挂图加载中，可点击查看正面"}>
      <span>侧挂图</span><span>{sideState === "error" ? "暂不可用" : "加载中"}</span><span className={styles.sidePlaceholderAction}>查看正面</span>
    </span> : null}
  </span>;
});
