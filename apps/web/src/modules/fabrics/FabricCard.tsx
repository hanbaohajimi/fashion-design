"use client";

import type { DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FABRIC_DRAG_MIME, fabricToDragPayload } from "../board/fabric-drag";
import {
  createFabric,
  deleteFabric,
  normalizeFabricTags,
  parseFabricTags,
  type FabricUploadInput,
  updateFabric,
  validateFabricUpload,
} from "./fabric-api";
import type { Fabric } from "./fabric-types";
import { canManageFabric } from "./fabric-filters";
import styles from "./fabrics.module.css";

const FABRIC_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif";

interface FabricUploadPanelProps {
  readonly compact?: boolean;
  readonly onUploaded: (fabric: Fabric) => void;
}

export function FabricUploadPanel({
  compact = false,
  onUploaded,
}: FabricUploadPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const reset = (): void => {
    setError(null);
    setFile(null);
    setTagText("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const chooseFile = useCallback((nextFile: File | undefined): void => {
    if (!nextFile) return;
    const nextError = validateFabricUpload({
      file: nextFile,
      tags: ["待填写"],
    });
    if (nextError) {
      setError(nextError);
      return;
    }
    setError(null);
    setSuccess(null);
    setFile(nextFile);
  }, []);

  useEffect(() => {
    const belongsToPanel = (event: DragEvent): boolean => {
      const node = panel.current;
      return Boolean(node && event.composedPath().includes(node));
    };
    const onWindowDragOver = (event: DragEvent): void => {
      if (!belongsToPanel(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onWindowDrop = (event: DragEvent): void => {
      if (!belongsToPanel(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDragging(false);
      chooseFile(event.dataTransfer?.files[0]);
    };

    window.addEventListener("dragover", onWindowDragOver, true);
    window.addEventListener("drop", onWindowDrop, true);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver, true);
      window.removeEventListener("drop", onWindowDrop, true);
    };
  }, [chooseFile]);

  const submit = async (): Promise<void> => {
    const input: FabricUploadInput = {
      file,
      tags: parseFabricTags(tagText),
    };
    const validationError = validateFabricUpload(input);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const created = await createFabric(input);
      setSuccess("面料已加入面料库");
      reset();
      onUploaded(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "面料上传失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="上传面料"
      className={styles.fabricUploadPanel}
      data-compact={compact}
      data-dragging={dragging}
      data-native-file-drop-owner="fabric-library"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setDragging(false);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        chooseFile(event.dataTransfer.files[0]);
      }}
      ref={panel}
    >
      <input
        accept={FABRIC_IMAGE_ACCEPT}
        aria-label="选择面料图片"
        hidden
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
        ref={fileInput}
        type="file"
      />

      {!file ? (
        <button
          className={styles.fabricUploadTrigger}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <strong>＋ 添加面料图片</strong>
          <span>
            {dragging ? "松开以上传图片" : "点击选择，或将本地图片拖到这里"}
          </span>
        </button>
      ) : (
        <form
          className={styles.fabricUploadForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={styles.fabricUploadPreview}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="待上传面料预览" src={previewUrl} />
            ) : null}
            <button onClick={() => fileInput.current?.click()} type="button">
              更换图片
            </button>
          </div>
          <div className={styles.fabricUploadFields}>
            <label>
              <span>标签</span>
              <input
                autoFocus
                onChange={(event) => setTagText(event.currentTarget.value)}
                placeholder="例如：轻薄、垂坠、夏季（逗号分隔）"
                required
                value={tagText}
              />
            </label>
            <p className={styles.tagHelp}>
              最多 12 个标签，每个不超过 30 个字。
            </p>
          </div>
          <div className={styles.fabricUploadActions}>
            <button disabled={submitting} onClick={reset} type="button">
              取消
            </button>
            <button disabled={submitting} type="submit">
              {submitting ? "正在上传…" : "保存到面料库"}
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p className={styles.fabricUploadError} role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className={styles.fabricUploadSuccess} role="status">
          {success}
        </p>
      ) : null}
    </section>
  );
}

interface FabricCardProps {
  readonly compact?: boolean;
  readonly fabric: Fabric;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly onChanged?: (() => void) | undefined;
  readonly variant?: "short" | "tall";
}

export function FabricCard({
  compact = false,
  fabric,
  onAdd,
  onChanged,
  variant = "short",
}: FabricCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editTagText, setEditTagText] = useState(fabric.tags.join("、"));
  const dialogRef = useRef<HTMLElement>(null);
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const label = fabric.tags.join("、") || "面料";
  const manageable = canManageFabric(fabric);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogCloseRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen) return;
    const handleDialogKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        event.stopPropagation();
        setDialogOpen(false);
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleDialogKeyDown, true);
  }, [dialogOpen, saving]);

  const openManager = (): void => {
    setActionError(null);
    setDeleteConfirm(false);
    setEditing(false);
    setEditTagText(fabric.tags.join("、"));
    setDialogOpen(true);
  };

  const beginDrag = (event: ReactDragEvent<HTMLElement>): void => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      FABRIC_DRAG_MIME,
      JSON.stringify(fabricToDragPayload(fabric)),
    );
    event.dataTransfer.setData("text/plain", label);
  };

  const saveTags = async (): Promise<void> => {
    const tags = normalizeFabricTags(parseFabricTags(editTagText));
    if (tags.length === 0) {
      setActionError("请至少添加一个标签");
      return;
    }
    if (tags.length > 12 || tags.some((tag) => tag.length > 30)) {
      setActionError("最多 12 个标签，每个不超过 30 个字");
      return;
    }

    setActionError(null);
    setSaving(true);
    try {
      await updateFabric(fabric.id, { tags });
      setEditing(false);
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "标签保存失败");
    } finally {
      setSaving(false);
    }
  };

  const removeFabric = async (): Promise<void> => {
    setActionError(null);
    setSaving(true);
    try {
      await deleteFabric(fabric.id);
      setDialogOpen(false);
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "面料删除失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      aria-label={`${label}，拖拽到白板`}
      className={styles.fabricCard}
      data-compact={compact}
      data-variant={variant}
      draggable
      onDragStart={beginDrag}
    >
      <div className={styles.cardVisual}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={label} draggable={false} src={fabric.mainImageUrl} />
        <span className={styles.dragHint}>拖至白板</span>
      </div>
      <div className={styles.cardBody}>
        <div aria-label="面料标签" className={styles.fabricTags}>
          {fabric.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        {onAdd || manageable ? (
          <div className={styles.fabricCardActions}>
            {onAdd ? (
              <button onClick={() => onAdd(fabric)} type="button">
                添加到白板
              </button>
            ) : null}
            {manageable ? (
              <button
                className={styles.fabricManageButton}
                onClick={openManager}
                type="button"
              >
                管理 / 删除
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {dialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.fabricDialogBackdrop}
              onMouseDown={(event) => {
                if (event.currentTarget === event.target && !saving) {
                  setDialogOpen(false);
                }
              }}
              role="presentation"
            >
              <section
                aria-busy={saving}
                aria-label="管理或删除面料"
                aria-modal="true"
                className={styles.fabricDialog}
                ref={dialogRef}
                role="dialog"
                tabIndex={-1}
              >
                <header>
                  <div>
                    <span>FABRIC SETTINGS</span>
                    <h2>管理面料</h2>
                  </div>
                  <button
                    aria-label="关闭"
                    disabled={saving}
                    onClick={() => setDialogOpen(false)}
                    ref={dialogCloseRef}
                    type="button"
                  >
                    ×
                  </button>
                </header>
                <div className={styles.fabricDialogImage}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={label} src={fabric.mainImageUrl} />
                </div>
                {editing ? (
                  <form
                    className={styles.fabricEditForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTags();
                    }}
                  >
                    <label>
                      <span>标签</span>
                      <input
                        autoFocus
                        onChange={(event) =>
                          setEditTagText(event.currentTarget.value)
                        }
                        placeholder="使用逗号分隔多个标签"
                        value={editTagText}
                      />
                    </label>
                    <footer>
                      <button
                        disabled={saving}
                        onClick={() => setEditing(false)}
                        type="button"
                      >
                        取消
                      </button>
                      <button disabled={saving} type="submit">
                        {saving ? "保存中…" : "保存标签"}
                      </button>
                    </footer>
                  </form>
                ) : (
                  <>
                    <div className={styles.fabricDialogTags}>
                      {fabric.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <footer className={styles.fabricDialogActions}>
                      {deleteConfirm ? (
                        <>
                          <span>
                            确认删除这张面料？删除后将不再显示在面料库中。
                          </span>
                          <button
                            disabled={saving}
                            onClick={() => setDeleteConfirm(false)}
                            type="button"
                          >
                            取消
                          </button>
                          <button
                            disabled={saving}
                            onClick={() => void removeFabric()}
                            type="button"
                          >
                            {saving ? "删除中…" : "确认删除"}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditing(true)}
                            type="button"
                          >
                            编辑标签
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(true)}
                            type="button"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </footer>
                  </>
                )}
                {actionError ? (
                  <p className={styles.fabricUploadError} role="alert">
                    {actionError}
                  </p>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" && element.tabIndex >= 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  if (document.activeElement === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
