"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { createShapeId, type TLShapeId, useEditor } from "tldraw";

import { BoardProjectContext } from "./board-context";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "./file-upload-api";
import { IMAGE_SHAPE_TYPE, type ImageShape } from "./shapes";
import {
  clearAllUploadPreviews,
  clearUploadPreview,
  setUploadPreview,
} from "./upload-preview-store";
import styles from "./board.module.css";

interface UploadTask {
  readonly error: string | null;
  readonly file: File;
  readonly id: string;
  readonly shapeId: TLShapeId;
  readonly status: "uploading" | "failed";
}

export function BoardFileDrop() {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const [dragging, setDragging] = useState(false);
  const [tasks, setTasks] = useState<readonly UploadTask[]>([]);

  useEffect(() => clearAllUploadPreviews, []);

  const updateImage = useCallback(
    (shapeId: TLShapeId, props: Partial<ImageShape["props"]>): void => {
      const shape = editor.getShape<ImageShape>(shapeId);
      if (!shape || shape.type !== IMAGE_SHAPE_TYPE) {
        return;
      }
      editor.updateShape({
        id: shapeId,
        type: IMAGE_SHAPE_TYPE,
        props: { ...shape.props, ...props },
      });
    },
    [editor],
  );

  const runUpload = useCallback(
    async (task: UploadTask): Promise<void> => {
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, error: null, status: "uploading" }
            : item,
        ),
      );
      updateImage(task.shapeId, { uploadStatus: "uploading" });

      try {
        const signed = await signImageUpload(projectId, task.file);
        updateImage(task.shapeId, {
          fileId: signed.file.id,
          uploadStatus: signed.file.status === "READY" ? "ready" : "processing",
        });
        const processing = signed.upload
          ? await putOriginal(signed.upload, task.file).then(() =>
              completeUpload(signed.file.id),
            )
          : signed.file;
        const ready = await waitForThumbnail(signed.file.id, processing);
        const maxWidth = 520;
        const ratio =
          ready.width && ready.height ? ready.height / ready.width : 260 / 340;
        const width = Math.min(Math.max(ready.width ?? 340, 180), maxWidth);
        updateImage(task.shapeId, {
          h: Math.max(80, Math.round(width * ratio)),
          uploadStatus: "ready",
          url: ready.thumbnail1024Url ?? ready.thumbnail256Url ?? "",
          w: width,
        });
        clearUploadPreview(task.shapeId);
        setTasks((current) => current.filter((item) => item.id !== task.id));
      } catch (cause) {
        const error =
          cause instanceof Error ? cause.message : "图片上传失败，请重试";
        updateImage(task.shapeId, { uploadStatus: "failed" });
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id ? { ...item, error, status: "failed" } : item,
          ),
        );
      }
    },
    [projectId, updateImage],
  );

  useEffect(() => {
    const pending = editor
      .getCurrentPageShapes()
      .filter(
        (shape): shape is ImageShape =>
          shape.type === IMAGE_SHAPE_TYPE &&
          Boolean(shape.props.fileId) &&
          shape.props.uploadStatus !== "ready",
      );
    for (const shape of pending) {
      const fileId = shape.props.fileId;
      if (!fileId) {
        continue;
      }
      void waitForThumbnail(fileId)
        .then((ready) => {
          updateImage(shape.id, {
            uploadStatus: "ready",
            url: ready.thumbnail1024Url ?? ready.thumbnail256Url ?? "",
          });
        })
        .catch(() => updateImage(shape.id, { uploadStatus: "failed" }));
    }
  }, [editor, updateImage]);

  useEffect(() => {
    let dragDepth = 0;
    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      dragDepth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragging(false);
      }
    };
    const onDrop = (event: DragEvent): void => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      const point = editor.screenToPage({
        x: event.clientX,
        y: event.clientY,
      });

      files.forEach((file, index) => {
        const validationError = validateImage(file);
        const shapeId = createShapeId();
        editor.createShape<ImageShape>({
          id: shapeId,
          type: IMAGE_SHAPE_TYPE,
          x: point.x + index * 24 - 170,
          y: point.y + index * 24 - 130,
          props: {
            fileId: "",
            title: file.name,
            uploadStatus: validationError ? "failed" : "uploading",
          },
        });
        if (!validationError) {
          setUploadPreview(shapeId, URL.createObjectURL(file));
        }
        const task: UploadTask = {
          error: validationError,
          file,
          id: crypto.randomUUID(),
          shapeId,
          status: validationError ? "failed" : "uploading",
        };
        setTasks((current) => [...current, task]);
        if (!validationError) {
          void runUpload(task);
        }
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [editor, runUpload]);

  return (
    <>
      {dragging ? (
        <div className={styles.uploadDropZone}>
          <strong>DROP / IMAGE</strong>
          <span>松开以添加到白板 · 最大 50MB</span>
        </div>
      ) : null}
      {tasks.length > 0 ? (
        <aside className={styles.uploadTray} aria-label="图片上传状态">
          {tasks.map((task) => (
            <div key={task.id} data-status={task.status}>
              <span>{task.file.name}</span>
              <small>
                {task.status === "uploading" ? "上传并生成缩略图…" : task.error}
              </small>
              {task.status === "failed" && !validateImage(task.file) ? (
                <button onClick={() => void runUpload(task)} type="button">
                  重试
                </button>
              ) : null}
            </div>
          ))}
        </aside>
      ) : null}
    </>
  );
}
