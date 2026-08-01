"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createShapeId, type TLShapeId, useEditor } from "tldraw";

import { BOARD_FILE_PICKER_EVENT, BoardProjectContext } from "./board-context";
import {
  fetchElementRole,
  registerRoleInference,
  type RoleInferenceResult,
} from "./board-api";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadingTaskIds = useRef(new Set<string>());
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

  const applyInference = useCallback(
    (result: RoleInferenceResult): void => {
      const shape = editor.getShape<ImageShape>(result.shapeId as TLShapeId);
      if (
        !shape ||
        shape.type !== IMAGE_SHAPE_TYPE ||
        shape.props.roleSource === "manual" ||
        shape.meta.roleSource === "manual"
      ) {
        return;
      }
      editor.updateShape({
        id: shape.id,
        type: IMAGE_SHAPE_TYPE,
        props: {
          ...shape.props,
          role: result.role,
          roleConfidence: result.confidence ?? undefined,
          roleInferenceState: result.state,
          roleLabel: result.label ?? undefined,
          roleSource: result.source,
        },
      });
    },
    [editor],
  );

  const failInference = useCallback(
    (shapeId: TLShapeId): void => {
      const shape = editor.getShape<ImageShape>(shapeId);
      if (
        shape?.type !== IMAGE_SHAPE_TYPE ||
        shape.props.roleSource === "manual" ||
        shape.meta.roleSource === "manual"
      ) {
        return;
      }
      updateImage(shapeId, {
        role: "style_ref",
        roleConfidence: undefined,
        roleInferenceState: "failed",
        roleLabel: undefined,
        roleSource: "default",
      });
    },
    [editor, updateImage],
  );

  const trackInference = useCallback(
    async (shapeId: TLShapeId, fileId?: string): Promise<void> => {
      try {
        let result = fileId
          ? await registerRoleInference(projectId, shapeId, fileId)
          : await fetchElementRole(projectId, shapeId);
        applyInference(result);
        for (
          let attempt = 0;
          result.state === "pending" && attempt < 60;
          attempt += 1
        ) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          result = await fetchElementRole(projectId, shapeId);
          applyInference(result);
        }
        if (result.state === "pending") {
          failInference(shapeId);
        }
      } catch {
        failInference(shapeId);
      }
    },
    [applyInference, failInference, projectId],
  );

  const runUpload = useCallback(
    async (task: UploadTask): Promise<void> => {
      if (uploadingTaskIds.current.has(task.id)) return;
      uploadingTaskIds.current.add(task.id);
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
          role: "style_ref",
          roleInferenceState: "pending",
          roleSource: "default",
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
        void trackInference(task.shapeId, signed.file.id);
        clearUploadPreview(task.shapeId);
        setTasks((current) => current.filter((item) => item.id !== task.id));
      } catch (cause) {
        const error =
          cause instanceof Error ? cause.message : "图片上传失败，请重试";
        updateImage(task.shapeId, { uploadStatus: "failed" });
        failInference(task.shapeId);
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id ? { ...item, error, status: "failed" } : item,
          ),
        );
      } finally {
        uploadingTaskIds.current.delete(task.id);
      }
    },
    [failInference, projectId, trackInference, updateImage],
  );

  const removeTask = useCallback(
    (task: UploadTask): void => {
      if (uploadingTaskIds.current.has(task.id)) return;
      clearUploadPreview(task.shapeId);
      editor.deleteShapes([task.shapeId]);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    },
    [editor],
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
          void trackInference(shape.id, fileId);
        })
        .catch(() => {
          updateImage(shape.id, { uploadStatus: "failed" });
          failInference(shape.id);
        });
    }
    const pendingRoles = editor
      .getCurrentPageShapes()
      .filter(
        (shape): shape is ImageShape =>
          shape.type === IMAGE_SHAPE_TYPE &&
          Boolean(shape.props.fileId) &&
          shape.props.uploadStatus === "ready" &&
          shape.props.roleInferenceState === "pending",
      );
    for (const shape of pendingRoles) {
      const fileId = shape.props.fileId;
      if (fileId) {
        void trackInference(shape.id, fileId);
      }
    }
  }, [editor, failInference, trackInference, updateImage]);

  const addFiles = useCallback(
    (
      files: readonly File[],
      point = editor.getViewportPageBounds().center,
    ): void => {
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
    },
    [editor, runUpload],
  );

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
      addFiles(files, point);
    };
    const onPaste = (event: ClipboardEvent): void => {
      const isEditableTarget = event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches("input, textarea, select") ||
              target.isContentEditable),
        );
      if (event.defaultPrevented || isEditableTarget) {
        return;
      }
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };
    const openFilePicker = (): void => {
      fileInput.current?.click();
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    window.addEventListener(BOARD_FILE_PICKER_EVENT, openFilePicker);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener(BOARD_FILE_PICKER_EVENT, openFilePicker);
    };
  }, [addFiles, editor]);

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        aria-label="选择要上传的图片"
        hidden
        multiple
        onChange={(event) => {
          addFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
        ref={fileInput}
        type="file"
      />
      {dragging ? (
        <div className={styles.uploadDropZone}>
          <strong>DROP / IMAGE</strong>
          <span>松开以添加到白板 · 最大 50MB</span>
        </div>
      ) : null}
      {tasks.length > 0 ? (
        <aside
          aria-label="图片上传状态"
          aria-live="polite"
          className={styles.uploadTray}
        >
          {tasks.map((task) => (
            <div key={task.id} data-status={task.status}>
              <span>{task.file.name}</span>
              <small>
                {task.status === "uploading" ? "上传并生成缩略图…" : task.error}
              </small>
              {task.status === "failed" ? (
                validateImage(task.file) ? (
                  <button
                    aria-label={`移除“${task.file.name}”`}
                    onClick={() => removeTask(task)}
                    type="button"
                  >
                    移除
                  </button>
                ) : (
                  <button
                    aria-label={`重试“${task.file.name}”`}
                    onClick={() => void runUpload(task)}
                    type="button"
                  >
                    重试
                  </button>
                )
              ) : null}
            </div>
          ))}
        </aside>
      ) : null}
    </>
  );
}
