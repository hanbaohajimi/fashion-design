"use client";
import { ImagePreview } from "../../components/ui";

import type { DragEvent as ReactDragEvent } from "react";
import { Dialog } from "../../components/ui";
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
import { useCoutureMotion } from "../../components/motion/use-couture-motion";
import {
  createFabricDetailsDraft,
  parseFabricDetailsDraft,
  FabricDetailsEditor,
  FabricDetailsSummary,
} from "./FabricDetailsEditor";

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
  const play = useCoutureMotion();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [detailsDraft, setDetailsDraft] = useState(createFabricDetailsDraft);
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
    setDetailsDraft(createFabricDetailsDraft());
    if (fileInput.current) fileInput.current.value = "";
  };

  const chooseFile = useCallback(
    (nextFile: File | undefined): void => {
      if (!nextFile || submitting) return;
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
    },
    [submitting],
  );

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
    if (submitting) return;
    const parsed = parseFabricDetailsDraft(detailsDraft);
    if (!parsed.success) {
      setError(parsed.error);
      return;
    }
    const input: FabricUploadInput = {
      file,
      details: parsed.details,
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
      play("material", {
        anchor: panel.current,
        eventKey: `fabric-upload:${created.id}`,
      });
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
      data-has-file={Boolean(file)}
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
        disabled={submitting}
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
          <strong>
            <span aria-hidden="true">＋</span>
            添加面料
          </strong>
          <span>{dragging ? "松开以上传" : "选择图片或拖放到这里"}</span>
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
            <button
              disabled={submitting}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              更换图片
            </button>
          </div>
          <div className={styles.fabricUploadFields}>
            <label>
              <span>标签</span>
              <input
                autoFocus
                disabled={submitting}
                onChange={(event) => setTagText(event.currentTarget.value)}
                placeholder="例如：轻薄、垂坠、夏季（逗号分隔）"
                required
                value={tagText}
              />
            </label>
            <p className={styles.tagHelp}>
              最多 12 个标签，每个不超过 30 个字。
            </p>
            <FabricDetailsEditor
              value={detailsDraft}
              onChange={setDetailsDraft}
              disabled={submitting}
            />
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
  readonly adding?: boolean;
  readonly addDisabled?: boolean;
  readonly compact?: boolean;
  readonly fabric: Fabric;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly onChanged?: (() => void) | undefined;
}

export function FabricCard({
  adding = false,
  addDisabled = false,
  compact = false,
  fabric: sourceFabric,
  onAdd,
  onChanged,
}: FabricCardProps) {
  const [updatedFabric, setUpdatedFabric] = useState<Fabric | null>(null);
  const fabric =
    updatedFabric &&
    updatedFabric.id === sourceFabric.id &&
    new Date(updatedFabric.updatedAt) >= new Date(sourceFabric.updatedAt)
      ? updatedFabric
      : sourceFabric;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editTagText, setEditTagText] = useState(fabric.tags.join("、"));
  const [editDetails, setEditDetails] = useState(() =>
    createFabricDetailsDraft(fabric.details),
  );
  const label = fabric.details?.name || fabric.tags.join("、") || "面料";
  const manageable = canManageFabric(fabric);
  const scopeLabel = fabric.scope === "preset" ? "系统内置" : "用户上传";

  const openManager = (): void => {
    setActionError(null);
    setDeleteConfirm(false);
    setEditing(false);
    setEditTagText(fabric.tags.join("、"));
    setEditDetails(createFabricDetailsDraft(fabric.details));
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
    if (saving) return;
    const tags = normalizeFabricTags(parseFabricTags(editTagText));
    if (tags.length === 0) {
      setActionError("请至少添加一个标签");
      return;
    }
    if (tags.length > 12 || tags.some((tag) => tag.length > 30)) {
      setActionError("最多 12 个标签，每个不超过 30 个字");
      return;
    }

    const parsed = parseFabricDetailsDraft(editDetails);
    if (!parsed.success) {
      setActionError(parsed.error);
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateFabric(fabric.id, {
        tags,
        details: parsed.details,
      });
      setUpdatedFabric(updated);
      setEditing(false);
      onChanged?.();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "面料档案保存失败",
      );
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
      draggable
      onDragStart={beginDrag}
    >
      <div className={styles.cardVisual}>
        <ImagePreview
          alt={label}
          src={fabric.mainImageUrl}
          fit="cover"
          retryable={false}
          draggable={false}
        />
        <span className={styles.dragHint}>拖至白板</span>
        <button
          aria-label={`${manageable ? "管理" : "查看"}面料：${label}`}
          className={styles.fabricManageButton}
          onClick={openManager}
          type="button"
        >
          {manageable ? "管理" : "详情"}
        </button>
      </div>
      <div className={styles.cardBody}>
        <h3>{fabric.details?.name || "未命名面料"}</h3>
        <p className={styles.cardSpec}>
          {[
            fabric.details?.code,
            fabric.details?.weightGsm
              ? `${fabric.details.weightGsm} g/m²`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || "规格未填写"}
        </p>
        <div className={styles.fabricTags}>
          <span className={styles.categoryPill} data-scope={fabric.scope}>
            {scopeLabel}
          </span>
          <p aria-label={`面料标签：${label}`} title={label}>
            {fabric.tags.map((tag) => `#${tag}`).join("  ")}
          </p>
        </div>
        {onAdd ? (
          <div className={styles.fabricCardActions}>
            <button
              disabled={addDisabled}
              aria-busy={adding}
              onClick={() => onAdd(fabric)}
              type="button"
            >
              {adding ? "正在加入…" : "加入当前项目"}
            </button>
          </div>
        ) : null}
      </div>

      {dialogOpen ? (
        <Dialog
          busy={saving}
          label={manageable ? "管理或删除面料" : "面料档案"}
          className={styles.fabricDialog}
          onClose={() => {
            if (!saving) setDialogOpen(false);
          }}
        >
          <header>
            <h2>{manageable ? "管理面料" : "面料档案"}</h2>
            <button
              aria-label="关闭"
              disabled={saving}
              onClick={() => setDialogOpen(false)}
              type="button"
            >
              ×
            </button>
          </header>
          <div className={styles.fabricDialogImage}>
            <ImagePreview alt={label} src={fabric.mainImageUrl} />
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
                  disabled={saving}
                  onChange={(event) =>
                    setEditTagText(event.currentTarget.value)
                  }
                  placeholder="使用逗号分隔多个标签"
                  value={editTagText}
                />
              </label>
              <FabricDetailsEditor
                value={editDetails}
                onChange={setEditDetails}
                disabled={saving}
              />
              <footer>
                <button
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setEditTagText(fabric.tags.join("、"));
                    setEditDetails(createFabricDetailsDraft(fabric.details));
                    setActionError(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button disabled={saving} type="submit">
                  {saving ? "保存中…" : "保存档案"}
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
              <FabricDetailsSummary details={fabric.details} />
              <footer className={styles.fabricDialogActions}>
                {manageable && deleteConfirm ? (
                  <>
                    <span>确认删除这张面料？删除后将不再显示在面料库中。</span>
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
                ) : manageable ? (
                  <>
                    <button onClick={() => setEditing(true)} type="button">
                      编辑档案
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                ) : (
                  <span>此面料为只读资料</span>
                )}
              </footer>
            </>
          )}
          {actionError ? (
            <p className={styles.fabricUploadError} role="alert">
              {actionError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </article>
  );
}
