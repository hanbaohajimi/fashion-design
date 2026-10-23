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

interface Item {
  id: string;
  file: File;
  point: { x: number; y: number };
  ready?: UploadedFile;
  error?: string;
  done?: boolean;
}
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
  const locate = (x?: number, y?: number) =>
    x !== undefined && y !== undefined
      ? (editor()?.screenToPage({ x, y }) ?? { x: 0, y: 0 })
      : (editor()?.getViewportPageBounds().center ?? { x: 0, y: 0 });
  const update = (item: Item) =>
    setItems((current) =>
      current.map((value) => (value.id === item.id ? { ...item } : value)),
    );
  const run = (item: Item) => {
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        setBusy(true);
        delete item.error;
        update(item);
        try {
          const invalid = validateImage(item.file);
          if (invalid) throw new Error(invalid);
          if (!item.ready) {
            const signed = await signImageUpload(projectId, item.file);
            const processing = signed.upload
              ? await putOriginal(signed.upload, item.file).then(() =>
                  completeUpload(signed.file.id),
                )
              : signed.file;
            item.ready = await waitForThumbnail(signed.file.id, processing);
          }
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
        } catch (cause) {
          item.error = cause instanceof Error ? cause.message : "图片上传失败";
        } finally {
          update(item);
          setBusy(false);
        }
      });
  };
  const add = (files: File[], point = locate()) => {
    const next = files.map((file, index): Item => ({
      file,
      id: crypto.randomUUID(),
      point: { x: point.x + index * 60, y: point.y + index * 60 },
    }));
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
      {items.some((item) => !item.done) || error ? (
        <div
          role="status"
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            zIndex: 10,
            background: "white",
            padding: 12,
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          {error}
          {items
            .filter((item) => !item.done)
            .map((item) => (
              <div key={item.id} role={item.error ? "alert" : "status"}>
                {item.file.name}：{item.error ?? "处理中…"}
                {item.error ? <button aria-label="关闭提示" type="button" onClick={() => setItems(current => current.filter(value => value.id !== item.id))}>关闭</button> : null}
                {item.error ? (
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
