import {
  useRef,
  useEffect,
  useContext,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { imageTextPixelRect, type ImageTextRect } from "@fashion/shared";
import type { ImageSize } from "./ImageViewer";
import {
  moveImageTextRect,
  resizeImageTextRect,
  type ImageTextDraftRegion,
} from "./image-text-editor";
import { startImageGeometryDrag } from "./image-geometry-drag";
import { ImageOverlayInteractionContext } from "./image-overlay-interaction";
import styles from "./image-text.module.css";

export function ImageTextRegionOverlay({
  regions,
  selected,
  size,
  scale,
  locked,
  onSelect,
  onRect,
}: {
  regions: ImageTextDraftRegion[];
  selected: string | null;
  size: ImageSize;
  scale: number;
  locked: boolean;
  onSelect: (id: string) => void;
  onRect: (id: string, rect: ImageTextRect) => void;
}) {
  const onInteraction = useContext(ImageOverlayInteractionContext);
  const overlay = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [locked]);
  const drag = (
    event: PointerEvent<HTMLButtonElement>,
    region: ImageTextDraftRegion,
    resize: boolean,
  ) => {
    event.stopPropagation();
    if (locked || event.button !== 0 || !event.isPrimary || cleanup.current)
      return;
    onSelect(region.id);
    onInteraction?.(true);
    const x = event.clientX,
      y = event.clientY;
    const liveScale = (overlay.current?.getBoundingClientRect().width ?? size.width * scale) / size.width;
    cleanup.current = startImageGeometryDrag(
      event,
      (next) => {
        const dx = (next.clientX - x) / liveScale / size.width;
        const dy = (next.clientY - y) / liveScale / size.height;
        onRect(
          region.id,
          resize
            ? resizeImageTextRect(
                region.rect,
                region.rect.width + dx,
                region.rect.height + dy,
                size,
              )
            : moveImageTextRect(
                region.rect,
                region.rect.x + dx,
                region.rect.y + dy,
              ),
        );
      },
      () => onRect(region.id, region.rect),
      () => {
        cleanup.current = null;
        onInteraction?.(false);
      },
    );
  };
  const keyboard = (
    event: KeyboardEvent,
    region: ImageTextDraftRegion,
    resize: boolean,
  ) => {
    const dx =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    onRect(
      region.id,
      resize
        ? resizeImageTextRect(
            region.rect,
            region.rect.width + (dx * step) / size.width,
            region.rect.height + (dy * step) / size.height,
            size,
          )
        : moveImageTextRect(
            region.rect,
            region.rect.x + (dx * step) / size.width,
            region.rect.y + (dy * step) / size.height,
          ),
    );
  };
  return (
    <div
      className={styles.overlay}
      ref={overlay}
      onWheel={(event) => {
        if (cleanup.current) event.stopPropagation();
      }}
    >
      {regions.map((region, index) => {
        const rect = imageTextPixelRect(region.rect, size.width, size.height);
        return (
          <div
            key={region.id}
            className={styles.region}
            data-selected={selected === region.id}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <button
              type="button"
              disabled={locked}
              className={styles.regionMove}
              style={{ borderWidth: `calc(2px / var(--image-scale, ${scale}))`, minHeight: 0 }}
              aria-label={`文字区域 ${index + 1}：${region.original || "手动添加"}`}
              aria-pressed={selected === region.id}
              onClick={() => onSelect(region.id)}
              onFocus={() => onSelect(region.id)}
              onKeyDown={(event) => keyboard(event, region, false)}
              onPointerDown={(event) => drag(event, region, false)}
            ></button>
            {selected === region.id ? <button
              type="button"
              disabled={locked}
              className={styles.regionBadge}
              aria-label={`移动文字区域 ${index + 1}`}
              style={{
                transform: `scale(calc(1 / var(--image-scale, ${scale}))) translate(-34px, -22px)`,
              }}
              onFocus={() => onSelect(region.id)}
              onClick={() => onSelect(region.id)}
              onKeyDown={(event) => keyboard(event, region, false)}
              onPointerDown={(event) => drag(event, region, false)}
            >
              <span>{index + 1}</span>
            </button> : <span
              className={styles.regionNumber}
              aria-hidden="true"
              style={{ transform: `scale(calc(1 / var(--image-scale, ${scale}))) translate(-100%, 0)` }}
            >{index + 1}</span>}
            {selected === region.id ? (
              <button
                type="button"
                disabled={locked}
                className={styles.regionHandle}
                aria-label={`调整文字区域 ${index + 1} 大小`}
                style={{ transform: `scale(calc(1 / var(--image-scale, ${scale}))) translate(50%, 50%)` }}
                onKeyDown={(event) => keyboard(event, region, true)}
                onPointerDown={(event) => drag(event, region, true)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
