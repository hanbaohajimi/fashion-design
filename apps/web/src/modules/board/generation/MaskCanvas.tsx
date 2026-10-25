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
}

export interface MaskCanvasState {
  readonly draft?: unknown;
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
  readonly descriptionId?: string;
  readonly height: number;
  readonly onChange: (state: MaskCanvasState) => void;
  readonly width: number;
}

function centerRegionStroke(
  width: number,
  height: number,
  brushRatio: number,
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
  return { points };
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
    { brushRatio, descriptionId, height, onChange, width },
    forwardedRef,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const activePointer = useRef<number | null>(null);
    const [strokes, setStrokes] = useState<readonly Stroke[]>([]);

    const redraw = useCallback(
      (nextStrokes: readonly Stroke[]): void => {
        const context = canvasRef.current?.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) return;
        context.clearRect(0, 0, width, height);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = Math.max(8, Math.min(width, height) * brushRatio);
        context.strokeStyle = "#ffffff";
        context.fillStyle = "#ffffff";

        for (const stroke of nextStrokes) {
          const first = stroke.points[0];
          if (!first) continue;
          if (stroke.points.length === 1) {
            context.beginPath();
            context.arc(
              first.x,
              first.y,
              context.lineWidth / 2,
              0,
              Math.PI * 2,
            );
            context.fill();
            continue;
          }
          context.beginPath();
          context.moveTo(first.x, first.y);
          for (const point of stroke.points.slice(1)) {
            context.lineTo(point.x, point.y);
          }
          context.stroke();
        }
        onChange({
          draft: { strokes: nextStrokes, brushRatio, width, height },
          coverage: maskCoverage(context, width, height),
          strokeCount: nextStrokes.length,
        });
      },
      [brushRatio, height, onChange, width],
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
        event.preventDefault();
        event.stopPropagation();
        activePointer.current = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        const point = pointFrom(event);
        setStrokes((current) => [...current, { points: [point] }]);
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
            { points: [...previous.points, point] },
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
    }, [height, width]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        addCenterRegion: () =>
          setStrokes((current) => [
            ...current,
            centerRegionStroke(width, height, brushRatio),
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
      [brushRatio, height, width],
    );

    return (
      <canvas
        aria-label="局部重绘掩码画布"
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
