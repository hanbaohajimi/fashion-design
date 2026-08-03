"use client";

import type { DragEvent as ReactDragEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FABRIC_DRAG_MIME,
  fabricToDragPayload,
} from "../board/fabric-drag";
import {
  FABRIC_CATEGORY_LABELS,
  FABRIC_METRIC_STEPS,
  FABRIC_SEASON_LABELS,
  FABRIC_WEAVE_LABELS,
  getCompositionEntries,
  getFabricMetrics,
  getFabricSeasons,
  type Fabric,
} from "./fabric-types";
import {
  createFabric,
  type FabricUploadCategory,
  type FabricUploadInput,
  type FabricUploadWeave,
  validateFabricUpload,
} from "./fabric-api";
import styles from "./fabrics.module.css";

const METRIC_STEPS = Array.from({ length: FABRIC_METRIC_STEPS }, (_, index) => index + 1);
const FABRIC_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

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
  const [compositionName, setCompositionName] = useState("混合纤维");
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
    setCompositionName("混合纤维");
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
    [category, compositionName, weave, weight],
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
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
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
          <span>{dragging ? "松开以上传图片" : "点击选择，或将本地图片拖到这里"}</span>
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
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>主要成分</span>
              <input
                maxLength={50}
                onChange={(event) => setCompositionName(event.currentTarget.value)}
                required
                value={compositionName}
              />
            </label>
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
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.fabricUploadActions}>
            <button disabled={submitting} onClick={reset} type="button">取消</button>
            <button disabled={submitting} type="submit">
              {submitting ? "正在上传…" : "保存到面料库"}
            </button>
          </div>
        </form>
      )}

      {error ? <p className={styles.fabricUploadError} role="alert">{error}</p> : null}
      {success ? <p className={styles.fabricUploadSuccess} role="status">{success}</p> : null}
    </section>
  );
}

interface FabricCardProps {
  readonly compact?: boolean;
  readonly fabric: Fabric;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly variant?: "short" | "tall";
}

export function FabricCard({
  compact = false,
  fabric,
  onAdd,
  variant = "short",
}: FabricCardProps) {
  const composition = getCompositionEntries(fabric.attributes)
    .slice(0, 2)
    .map(([name, percentage]) => `${name} ${percentage}%`)
    .join(" · ");
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
        <span className={styles.cardIndex}>{fabric.scope === "preset" ? "ARCHIVE" : "MY FABRIC"}</span>
        {/* The authenticated same-origin endpoint redirects to the private object URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={fabric.name} draggable={false} loading="lazy" src={fabric.mainImageUrl} />
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
          <span>{fabric.attributes.weight ? `${fabric.attributes.weight} GSM` : "GSM —"}</span>
          <span>{weave ? FABRIC_WEAVE_LABELS[weave] ?? weave : "织法未标注"}</span>
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
      </div>
    </article>
  );
}
