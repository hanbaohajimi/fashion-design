"use client";

import type { DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FABRIC_DRAG_MIME, fabricToDragPayload } from "../board/fabric-drag";
import {
  FABRIC_CATEGORY_LABELS,
  FABRIC_METRIC_STEPS,
  FABRIC_OPACITY_LABELS,
  FABRIC_SEASON_LABELS,
  FABRIC_STRETCH_LABELS,
  FABRIC_WEAVE_LABELS,
  formatFabricComposition,
  getCompositionEntries,
  getFabricMetrics,
  getFabricSeasons,
  type Fabric,
} from "./fabric-types";
import {
  createFabric,
  deleteFabric,
  type FabricUploadCategory,
  type FabricUploadInput,
  type FabricUploadWeave,
  validateFabricUpload,
  updateFabric,
} from "./fabric-api";
import styles from "./fabrics.module.css";

const METRIC_STEPS = Array.from(
  { length: FABRIC_METRIC_STEPS },
  (_, index) => index + 1,
);
const FABRIC_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif";

const UPLOAD_CATEGORY_OPTIONS: readonly {
  readonly label: string;
  readonly value: FabricUploadCategory;
}[] = [
  { label: "混纺", value: "blend" },
  { label: "棉", value: "cotton" },
  { label: "真丝", value: "silk" },
  { label: "羊毛", value: "wool" },
  { label: "化纤", value: "synthetic" },
];

const UPLOAD_WEAVE_OPTIONS: readonly {
  readonly label: string;
  readonly value: FabricUploadWeave;
}[] = [
  { label: "平纹", value: "plain" },
  { label: "斜纹", value: "twill" },
  { label: "缎纹", value: "satin" },
  { label: "针织", value: "knit" },
  { label: "提花", value: "jacquard" },
];

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
  const [category, setCategory] = useState<FabricUploadCategory>("blend");
  const [compositionName, setCompositionName] = useState("棉");
  const [compositionPercentage, setCompositionPercentage] = useState("60");
  const [secondaryCompositionName, setSecondaryCompositionName] =
    useState("聚酯纤维");
  const [secondaryCompositionPercentage, setSecondaryCompositionPercentage] =
    useState("40");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [weave, setWeave] = useState<FabricUploadWeave>("plain");
  const [weight, setWeight] = useState("180");

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
    setCategory("blend");
    setCompositionName("棉");
    setCompositionPercentage("60");
    setSecondaryCompositionName("聚酯纤维");
    setSecondaryCompositionPercentage("40");
    setError(null);
    setFile(null);
    setName("");
    setWeave("plain");
    setWeight("180");
    if (fileInput.current) fileInput.current.value = "";
  };

  const chooseFile = useCallback(
    (nextFile: File | undefined): void => {
      if (!nextFile) return;
      const nextName =
        nextFile.name.replace(/\.[^.]+$/u, "").trim() || "未命名面料";
      const input: FabricUploadInput = {
        category,
        composition:
          category === "blend"
            ? {
                [compositionName]: Number(compositionPercentage),
                [secondaryCompositionName]: Number(
                  secondaryCompositionPercentage,
                ),
              }
            : { [compositionName]: 100 },
        compositionName,
        file: nextFile,
        name: nextName,
        weight: Number(weight),
        weave,
      };
      const nextError = validateFabricUpload(input);
      if (
        nextError &&
        !["请填写面料名称", "请填写主要成分"].includes(nextError)
      ) {
        setError(nextError);
        return;
      }
      setError(null);
      setSuccess(null);
      setFile(nextFile);
      setName(nextName);
    },
    [
      category,
      compositionName,
      compositionPercentage,
      secondaryCompositionName,
      secondaryCompositionPercentage,
      weave,
      weight,
    ],
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
      const nextFile = event.dataTransfer?.files[0];
      event.preventDefault();
      event.stopImmediatePropagation();
      setDragging(false);
      chooseFile(nextFile);
    };

    // tldraw consumes file drops inside the canvas before React's bubble
    // handler. Own this marked region at window capture phase first.
    window.addEventListener("dragover", onWindowDragOver, true);
    window.addEventListener("drop", onWindowDrop, true);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver, true);
      window.removeEventListener("drop", onWindowDrop, true);
    };
  }, [chooseFile]);

  const submit = async (): Promise<void> => {
    const input: FabricUploadInput = {
      category,
      composition:
        category === "blend"
          ? {
              [compositionName]: Number(compositionPercentage),
              [secondaryCompositionName]: Number(
                secondaryCompositionPercentage,
              ),
            }
          : { [compositionName]: 100 },
      compositionName,
      file,
      name,
      weight: Number(weight),
      weave,
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
      setSuccess(`“${created.name}”已加入我的面料`);
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
      ref={panel}
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
          <strong>＋ 添加面料</strong>
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
              <span>面料名称</span>
              <input
                maxLength={120}
                onChange={(event) => setName(event.currentTarget.value)}
                required
                value={name}
              />
            </label>
            <label>
              <span>品类</span>
              <select
                onChange={(event) =>
                  setCategory(event.currentTarget.value as FabricUploadCategory)
                }
                value={category}
              >
                {UPLOAD_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{category === "blend" ? "成分一" : "主要成分"}</span>
              <input
                maxLength={50}
                onChange={(event) =>
                  setCompositionName(event.currentTarget.value)
                }
                required
                value={compositionName}
              />
            </label>
            {category === "blend" ? (
              <>
                <label>
                  <span>成分一占比 / %</span>
                  <input
                    max={99}
                    min={1}
                    onChange={(event) =>
                      setCompositionPercentage(event.currentTarget.value)
                    }
                    required
                    type="number"
                    value={compositionPercentage}
                  />
                </label>
                <label>
                  <span>成分二</span>
                  <input
                    maxLength={50}
                    onChange={(event) =>
                      setSecondaryCompositionName(event.currentTarget.value)
                    }
                    required
                    value={secondaryCompositionName}
                  />
                </label>
                <label>
                  <span>成分二占比 / %</span>
                  <input
                    max={99}
                    min={1}
                    onChange={(event) =>
                      setSecondaryCompositionPercentage(
                        event.currentTarget.value,
                      )
                    }
                    required
                    type="number"
                    value={secondaryCompositionPercentage}
                  />
                </label>
              </>
            ) : null}
            <label>
              <span>克重 / GSM</span>
              <input
                max={2000}
                min={1}
                onChange={(event) => setWeight(event.currentTarget.value)}
                required
                type="number"
                value={weight}
              />
            </label>
            <label>
              <span>织法</span>
              <select
                onChange={(event) =>
                  setWeave(event.currentTarget.value as FabricUploadWeave)
                }
                value={weave}
              >
                {UPLOAD_WEAVE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editName, setEditName] = useState(fabric.name);
  const [editCategory, setEditCategory] = useState<FabricUploadCategory>(
    fabric.category as FabricUploadCategory,
  );
  const [editWeight, setEditWeight] = useState(
    String(fabric.attributes.weight ?? ""),
  );
  const [editWidth, setEditWidth] = useState(
    String(fabric.attributes.width ?? ""),
  );
  const [editWeave, setEditWeave] = useState(
    fabric.attributes.weave ?? "plain",
  );
  const [editStretch, setEditStretch] = useState(
    typeof fabric.attributes.stretch === "string"
      ? fabric.attributes.stretch
      : "none",
  );
  const [editOpacity, setEditOpacity] = useState(
    typeof fabric.attributes.opacity === "string"
      ? fabric.attributes.opacity
      : "opaque",
  );
  const [editComposition, setEditComposition] = useState(
    getCompositionEntries(fabric.attributes)
      .map(([name, percentage]) => `${name}:${percentage}`)
      .join("\n"),
  );
  const composition = formatFabricComposition(fabric.attributes);
  const metrics = getFabricMetrics(fabric.attributes);
  const weave = fabric.attributes.weave;
  const seasons = getFabricSeasons(fabric.attributes)
    .map((season) => FABRIC_SEASON_LABELS[season] ?? season)
    .join("/");

  const onDragStart = (event: ReactDragEvent<HTMLElement>): void => {
    const payload = fabricToDragPayload(fabric);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(FABRIC_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", fabric.name);
  };

  const saveEdits = async (): Promise<void> => {
    const composition = Object.fromEntries(
      editComposition.split(/\r?\n/u).flatMap((line) => {
        const separator = line.lastIndexOf(":");
        if (separator <= 0) return [];
        const name = line.slice(0, separator).trim();
        const percentage = Number(line.slice(separator + 1).trim());
        return name && Number.isFinite(percentage)
          ? [[name, percentage] as const]
          : [];
      }),
    );
    if (
      !editName.trim() ||
      Object.keys(composition).length === 0 ||
      Math.abs(
        Object.values(composition).reduce((sum, value) => sum + value, 0) - 100,
      ) > 0.000_001
    ) {
      setActionError("名称不能为空，成分请按“名称:占比”逐行填写且总和为 100");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await updateFabric(fabric.id, {
        attributes: {
          ...fabric.attributes,
          composition,
          opacity: editOpacity as "opaque" | "semi" | "sheer",
          stretch: editStretch as "none" | "slight" | "high",
          weave: editWeave,
          ...(editWeight ? { weight: Number(editWeight) } : {}),
          ...(editWidth ? { width: Number(editWidth) } : {}),
        },
        category: editCategory,
        name: editName.trim(),
      });
      setEditing(false);
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "面料更新失败");
    } finally {
      setSaving(false);
    }
  };

  const removeFabric = async (): Promise<void> => {
    setSaving(true);
    setActionError(null);
    try {
      await deleteFabric(fabric.id);
      setDetailsOpen(false);
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "面料删除失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      aria-label={`${fabric.name}，拖拽到白板`}
      className={styles.fabricCard}
      data-compact={compact}
      data-variant={variant}
      draggable
      onDragStart={onDragStart}
    >
      <div className={styles.cardVisual}>
        <span className={styles.cardIndex}>
          {fabric.scope === "preset" ? "ARCHIVE" : "MY FABRIC"}
        </span>
        {/* The authenticated same-origin endpoint redirects to the private object URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={fabric.name}
          draggable={false}
          loading="lazy"
          src={fabric.mainImageUrl}
        />
        <span className={styles.dragHint}>拖至白板 ↗</span>
      </div>
      <div className={styles.cardBody}>
        <span className={styles.categoryPill}>
          {FABRIC_CATEGORY_LABELS[fabric.category] ?? fabric.category}
        </span>
        <h3>{fabric.name}</h3>
        <p>{composition || fabric.subCategory || "成分待补充"}</p>
        {metrics.length > 0 ? (
          <dl className={styles.handfeel}>
            {metrics.map((metric) => (
              <div className={styles.metricRow} key={metric.name}>
                <dt>{metric.name}</dt>
                <span aria-hidden className={styles.metricGauge}>
                  {METRIC_STEPS.map((step) => (
                    <b data-on={step <= metric.level} key={step} />
                  ))}
                </span>
                <dd>{metric.label}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className={styles.cardFacts}>
          <span>
            {fabric.attributes.weight
              ? `${fabric.attributes.weight} GSM`
              : "GSM —"}
          </span>
          <span>
            {weave ? (FABRIC_WEAVE_LABELS[weave] ?? weave) : "织法未标注"}
          </span>
          {seasons ? <span>{seasons}</span> : null}
        </div>
        {onAdd ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAdd(fabric);
            }}
            type="button"
          >
            添加到白板
          </button>
        ) : null}
        {!compact ? (
          <button
            className={styles.fabricDetailButton}
            onClick={() => {
              setActionError(null);
              setDeleteConfirm(false);
              setDetailsOpen(true);
            }}
            type="button"
          >
            查看详情
          </button>
        ) : null}
      </div>
      {detailsOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.fabricDialogBackdrop}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !saving) {
                  setDetailsOpen(false);
                }
              }}
            >
              <section
                aria-label={`${fabric.name}详情`}
                aria-modal="true"
                className={styles.fabricDialog}
                role="dialog"
              >
                <header>
                  <div>
                    <span>FABRIC RECORD</span>
                    <h2>{fabric.name}</h2>
                  </div>
                  <button
                    aria-label="关闭面料详情"
                    disabled={saving}
                    onClick={() => setDetailsOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </header>
                {editing ? (
                  <form
                    className={styles.fabricEditForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdits();
                    }}
                  >
                    <label>
                      <span>名称</span>
                      <input
                        maxLength={120}
                        onChange={(event) =>
                          setEditName(event.currentTarget.value)
                        }
                        value={editName}
                      />
                    </label>
                    <label>
                      <span>品类</span>
                      <select
                        onChange={(event) =>
                          setEditCategory(
                            event.currentTarget.value as FabricUploadCategory,
                          )
                        }
                        value={editCategory}
                      >
                        {UPLOAD_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.fabricCompositionEditor}>
                      <span>成分与占比</span>
                      <textarea
                        onChange={(event) =>
                          setEditComposition(event.currentTarget.value)
                        }
                        rows={4}
                        value={editComposition}
                      />
                    </label>
                    <label>
                      <span>克重 / GSM</span>
                      <input
                        min={1}
                        max={2000}
                        onChange={(event) =>
                          setEditWeight(event.currentTarget.value)
                        }
                        type="number"
                        value={editWeight}
                      />
                    </label>
                    <label>
                      <span>门幅 / cm</span>
                      <input
                        min={1}
                        max={1000}
                        onChange={(event) =>
                          setEditWidth(event.currentTarget.value)
                        }
                        type="number"
                        value={editWidth}
                      />
                    </label>
                    <label>
                      <span>织法</span>
                      <select
                        onChange={(event) =>
                          setEditWeave(event.currentTarget.value)
                        }
                        value={editWeave}
                      >
                        {UPLOAD_WEAVE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>弹力</span>
                      <select
                        onChange={(event) =>
                          setEditStretch(event.currentTarget.value)
                        }
                        value={editStretch}
                      >
                        <option value="none">无弹</option>
                        <option value="slight">微弹</option>
                        <option value="high">高弹</option>
                      </select>
                    </label>
                    <label>
                      <span>透明度</span>
                      <select
                        onChange={(event) =>
                          setEditOpacity(event.currentTarget.value)
                        }
                        value={editOpacity}
                      >
                        <option value="opaque">不透</option>
                        <option value="semi">半透</option>
                        <option value="sheer">透明</option>
                      </select>
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
                        {saving ? "保存中…" : "保存修改"}
                      </button>
                    </footer>
                  </form>
                ) : (
                  <>
                    <dl className={styles.fabricDetailList}>
                      <div>
                        <dt>成分</dt>
                        <dd>{composition || "未标注"}</dd>
                      </div>
                      <div>
                        <dt>克重</dt>
                        <dd>
                          {fabric.attributes.weight
                            ? `${fabric.attributes.weight} GSM`
                            : "未标注"}
                        </dd>
                      </div>
                      <div>
                        <dt>门幅</dt>
                        <dd>
                          {fabric.attributes.width
                            ? `${fabric.attributes.width} cm`
                            : "未标注"}
                        </dd>
                      </div>
                      <div>
                        <dt>织法</dt>
                        <dd>
                          {weave
                            ? (FABRIC_WEAVE_LABELS[weave] ?? weave)
                            : "未标注"}
                        </dd>
                      </div>
                      <div>
                        <dt>弹力</dt>
                        <dd>
                          {typeof fabric.attributes.stretch === "string"
                            ? (FABRIC_STRETCH_LABELS[
                                fabric.attributes.stretch
                              ] ?? fabric.attributes.stretch)
                            : "未标注"}
                        </dd>
                      </div>
                      <div>
                        <dt>透明度</dt>
                        <dd>
                          {typeof fabric.attributes.opacity === "string"
                            ? (FABRIC_OPACITY_LABELS[
                                fabric.attributes.opacity
                              ] ?? fabric.attributes.opacity)
                            : "未标注"}
                        </dd>
                      </div>
                      <div>
                        <dt>季节</dt>
                        <dd>{seasons || "未标注"}</dd>
                      </div>
                      <div>
                        <dt>用途</dt>
                        <dd>
                          {Array.isArray(fabric.attributes.useCases)
                            ? fabric.attributes.useCases.join("、")
                            : "未标注"}
                        </dd>
                      </div>
                    </dl>
                    {fabric.scope === "user" ? (
                      <footer className={styles.fabricDialogActions}>
                        {deleteConfirm ? (
                          <>
                            <span>确认删除这条个人面料？</span>
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
                              编辑
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
                    ) : null}
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
