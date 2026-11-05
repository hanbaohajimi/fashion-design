"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import styles from "./generation.module.css";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Stroke {
  readonly points: readonly Point[];
  readonly lineWidth: number;
  readonly softness?: number;
}

export interface MaskCanvasDraft {
  readonly strokes: readonly Stroke[];
  readonly brushRatio: number;
  readonly softness?: number;
  readonly width: number;
  readonly height: number;
}

export interface MaskCanvasState {
  readonly draft?: MaskCanvasDraft;
  readonly coverage: number;
  readonly strokeCount: number;
}

export interface MaskCanvasHandle {
  addCenterRegion(): void;
  clear(): void;
  exportPng(): Promise<Blob>;
  undo(): void;
}

interface MaskCanvasProps {
  readonly brushRatio: number;
  /** Feather inside the recorded brush radius; omitted preserves the original hard brush. */
  readonly softness?: number;
  readonly descriptionId?: string;
  readonly height: number;
  readonly onChange: (state: MaskCanvasState) => void;
  readonly width: number;
  readonly initialDraft?: MaskCanvasDraft | undefined;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly selectionTone?: "white" | "currentColor";
}

function centerRegionStroke(
  width: number,
  height: number,
  brushRatio: number,
  softness: number,
): Stroke {
  const lineWidth = Math.max(8, Math.min(width, height) * brushRatio);
  const spacing = Math.max(6, lineWidth * 0.65);
  const left = width * 0.25;
  const right = width * 0.75;
  const points: Point[] = [];
  let drawRight = true;
  for (let y = height * 0.35; y <= height * 0.65; y += spacing) {
    points.push(
      { x: drawRight ? left : right, y },
      { x: drawRight ? right : left, y },
    );
    drawRight = !drawRight;
  }
  return { points, lineWidth, softness };
}

function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const first = stroke.points[0];
  if (!first) return;
  const softness = Math.max(0, Math.min(1, stroke.softness ?? 0));
  const layers = softness > 0 ? 24 : 1;
  let previousOpacity = 0;
  for (let index = 1; index <= layers; index += 1) {
    const progress = index / layers;
    const opacity = progress * progress * (3 - 2 * progress);
    // Nested round paths stay within the original radius. Source-over increments
    // reproduce a smooth weight ramp without blurring into protected pixels.
    context.globalAlpha = (opacity - previousOpacity) / (1 - previousOpacity);
    context.lineWidth = stroke.lineWidth * (1 - softness * (index - 1) / layers);
    context.beginPath();
    if (stroke.points.length === 1) {
      context.arc(first.x, first.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
    previousOpacity = opacity;
  }
  context.globalAlpha = 1;
}

function maskCoverage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const pixels = context.getImageData(0, 0, width, height).data;
  const stride = 4;
  let painted = 0;
  let sampled = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      sampled += 1;
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 0) painted += 1;
    }
  }
  return sampled ? painted / sampled : 0;
}

export const MaskCanvas = forwardRef<MaskCanvasHandle, MaskCanvasProps>(
  function MaskCanvas(
    { brushRatio, softness: requestedSoftness = 0, descriptionId, height, onChange, width, initialDraft, disabled = false, label = "局部重绘掩码画布", selectionTone = "white" },
    forwardedRef,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const activePointer = useRef<number | null>(null);
    const softness = Number.isFinite(requestedSoftness) ? Math.max(0, Math.min(1, requestedSoftness)) : 0;
    const [strokes, setStrokes] = useState<readonly Stroke[]>(() => initialDraft?.width === width && initialDraft.height === height ? initialDraft.strokes : []);

    const redraw = useCallback(
      (nextStrokes: readonly Stroke[]): void => {
        const context = canvasRef.current?.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) return;
        context.clearRect(0, 0, width, height);
        context.lineCap = "round";
        context.lineJoin = "round";
        const color = selectionTone === "currentColor" && canvasRef.current ? getComputedStyle(canvasRef.current).color : "#ffffff";
        context.strokeStyle = color;
        context.fillStyle = color;

        for (const stroke of nextStrokes) paintStroke(context, stroke);
        onChange({
          draft: { strokes: nextStrokes, brushRatio, softness, width, height },
          coverage: maskCoverage(context, width, height),
          strokeCount: nextStrokes.length,
        });
      },
      [brushRatio, height, onChange, selectionTone, softness, width],
    );

    useEffect(() => redraw(strokes), [redraw, strokes]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const pointFrom = (event: globalThis.PointerEvent): Point => {
        const bounds = canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - bounds.left) / bounds.width) * width,
          y: ((event.clientY - bounds.top) / bounds.height) * height,
        };
      };
      const pointerDown = (event: globalThis.PointerEvent): void => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activePointer.current = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        const point = pointFrom(event);
        setStrokes((current) => [...current, { points: [point], lineWidth: Math.max(8, Math.min(width, height) * brushRatio), softness }]);
      };
      const pointerMove = (event: globalThis.PointerEvent): void => {
        event.stopPropagation();
        if (activePointer.current !== event.pointerId) return;
        const point = pointFrom(event);
        setStrokes((current) => {
          const previous = current.at(-1);
          if (!previous) return current;
          return [
            ...current.slice(0, -1),
            { ...previous, points: [...previous.points, point] },
          ];
        });
      };
      const finishPointer = (event: globalThis.PointerEvent): void => {
        event.stopPropagation();
        if (activePointer.current !== event.pointerId) return;
        activePointer.current = null;
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      };

      canvas.addEventListener("pointercancel", finishPointer);
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerup", finishPointer);
      return () => {
        canvas.removeEventListener("pointercancel", finishPointer);
        canvas.removeEventListener("pointerdown", pointerDown);
        canvas.removeEventListener("pointermove", pointerMove);
        canvas.removeEventListener("pointerup", finishPointer);
      };
    }, [brushRatio, disabled, height, softness, width]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        addCenterRegion: () =>
          setStrokes((current) => [
            ...current,
            centerRegionStroke(width, height, brushRatio, softness),
          ]),
        clear: () => setStrokes([]),
        undo: () => setStrokes((current) => current.slice(0, -1)),
        exportPng: async () => {
          const source = canvasRef.current;
          if (!source) throw new Error("掩码画布尚未就绪");
          const output = document.createElement("canvas");
          output.width = width;
          output.height = height;
          const context = output.getContext("2d");
          if (!context) throw new Error("无法导出掩码");
          context.fillStyle = "#000000";
          context.fillRect(0, 0, width, height);
          // OpenAI Images Edits 约定透明区域为需要重绘的范围。
          context.globalCompositeOperation = "destination-out";
          context.drawImage(source, 0, 0);
          return new Promise<Blob>((resolve, reject) => {
            output.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("掩码 PNG 导出失败"));
            }, "image/png");
          });
        },
      }),
      [brushRatio, height, softness, width],
    );

    return (
      <canvas
        aria-label={label}
        aria-describedby={descriptionId}
        className={styles.maskCanvas}
        data-stroke-count={strokes.length}
        height={height}
        ref={canvasRef}
        role="img"
        width={width}
      />
    );
  },
);
