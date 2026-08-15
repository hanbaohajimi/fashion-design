"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useEditor, useValue } from "tldraw";

import { BoardProjectContext } from "../board-context";
import {
  SWATCH_SHAPE_TYPE,
  normalizeBoardRole,
  type SwatchShape,
} from "../shapes/shape-types";
import { getSwatchColors, normalizeSwatchHex } from "../shapes/swatch-colors";
import { uploadTemporaryMask } from "./generation-api";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import {
  MaskCanvas,
  type MaskCanvasHandle,
  type MaskCanvasState,
} from "./MaskCanvas";
import {
  DEFAULT_GENERATION_PARAMETERS,
  type GenerationCandidate,
  type GenerationPaletteColor,
} from "./generation-types";
import styles from "./generation.module.css";

type SubmissionStage = "creating" | "exporting" | "idle" | "uploading";

interface ImageDimensions {
  readonly height: number;
  readonly width: number;
}

interface LoadedImageDimensions extends ImageDimensions {
  readonly url: string;
}

interface AvailablePalette {
  readonly colors: readonly GenerationPaletteColor[];
  readonly id: string;
}

const MAX_MASK_DIMENSION = 2048;

function validImageDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function generationDimension(value: number): number {
  const safe = Math.min(2048, Math.max(256, value));
  return Math.max(256, Math.round(safe / 8) * 8);
}

function loadImageDimensions(url: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        !validImageDimension(image.naturalWidth) ||
        !validImageDimension(image.naturalHeight)
      ) {
        reject(new Error("无法读取原图尺寸，请重新加载后重试"));
        return;
      }
      if (
        image.naturalWidth > MAX_MASK_DIMENSION ||
        image.naturalHeight > MAX_MASK_DIMENSION
      ) {
        reject(
          new Error(
            `原图尺寸 ${image.naturalWidth}×${image.naturalHeight} 超过局部重绘上限 ${MAX_MASK_DIMENSION}×${MAX_MASK_DIMENSION}`,
          ),
        );
        return;
      }
      resolve({ height: image.naturalHeight, width: image.naturalWidth });
    };
    image.onerror = () => reject(new Error("原图加载失败，请检查图片后重试"));
    image.src = url;
  });
}

export function InpaintPanel({
  candidate,
  onSubmitted,
}: {
  readonly candidate: GenerationCandidate;
  readonly onSubmitted: (
    taskId: string,
    prompt: string,
  ) => Promise<void> | void;
}) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const mask = useRef<MaskCanvasHandle>(null);
  const availablePalettes = useValue(
    "局部编辑可用色卡",
    () =>
      editor.getCurrentPageShapes().flatMap((shape): AvailablePalette[] => {
        if (shape.type !== SWATCH_SHAPE_TYPE) return [];
        const swatch = shape as SwatchShape;
        if (normalizeBoardRole(swatch.props.role) !== "palette") return [];
        const colors = getSwatchColors(swatch.props).flatMap(
          (entry): GenerationPaletteColor[] => {
            const hex = normalizeSwatchHex(entry.color);
            if (!hex) return [];
            const name = entry.label.trim().slice(0, 48) || hex.toUpperCase();
            return [{ hex: hex.toUpperCase(), name }];
          },
        );
        return colors.length ? [{ colors, id: swatch.id }] : [];
      }),
    [editor],
  );
  const [maskState, setMaskState] = useState<MaskCanvasState>({
    coverage: 0,
    strokeCount: 0,
  });
  const [brushRatio, setBrushRatio] = useState(0.06);
  const [prompt, setPrompt] = useState("");
  const [usePalette, setUsePalette] = useState(false);
  const [selectedPaletteId, setSelectedPaletteId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submissionStage, setSubmissionStage] =
    useState<SubmissionStage>("idle");
  const [loadedImageDimensions, setLoadedImageDimensions] =
    useState<LoadedImageDimensions | null>(null);
  const maskHelpId = useId();
  const paletteHeadingId = useId();
  useEffect(() => {
    let disposed = false;
    void loadImageDimensions(candidate.url)
      .then((dimensions) => {
        if (!disposed) {
          setLoadedImageDimensions({ ...dimensions, url: candidate.url });
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "原图加载失败");
        }
      });
    return () => {
      disposed = true;
    };
  }, [candidate.url]);

  const imageDimensions =
    loadedImageDimensions?.url === candidate.url ? loadedImageDimensions : null;
  const width = imageDimensions?.width ?? 1;
  const height = imageDimensions?.height ?? 1;
  const paletteEnabled = usePalette && availablePalettes.length > 0;
  const selectedPalette = paletteEnabled
    ? (availablePalettes.find((palette) => palette.id === selectedPaletteId) ??
      availablePalettes[0])
    : undefined;
  const onMaskChange = useCallback((state: MaskCanvasState) => {
    setMaskState(state);
    setError(null);
  }, []);

  const submit = async (): Promise<void> => {
    if (!imageDimensions) {
      setError("正在读取原图尺寸，请稍候再试");
      return;
    }
    if (!mask.current || maskState.strokeCount === 0) {
      setError("请先涂抹需要修改的区域");
      return;
    }
    if (prompt.trim().length < 3) {
      setError("请描述局部区域需要如何修改");
      return;
    }
    if (paletteEnabled && !selectedPalette) {
      setError("请选择本次局部重绘使用的色卡");
      return;
    }
    setSubmissionStage("exporting");
    setError(null);
    try {
      const blob = await mask.current.exportPng();
      setSubmissionStage("uploading");
      const maskImageUrl = await uploadTemporaryMask(
        projectId,
        blob,
        width,
        height,
      );
      setSubmissionStage("creating");
      const result = await generation.start({
        parameters: {
          ...DEFAULT_GENERATION_PARAMETERS,
          height: generationDimension(height),
          width: generationDimension(width),
        },
        maskImageUrl,
        ...(paletteEnabled && selectedPalette
          ? { palette: selectedPalette.colors }
          : {}),
        parentAssetId: candidate.assetId,
        projectId,
        prompt: prompt.trim(),
        referenceImageUrl: candidate.url,
        shapeIds: editor.getSelectedShapeIds(),
        taskType: "inpaint",
      });
      if (result.ok) {
        await onSubmitted(result.taskId, prompt.trim());
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "局部重绘提交失败");
    } finally {
      setSubmissionStage("idle");
    }
  };

  const submitting = submissionStage !== "idle";
  const submitLabel =
    submissionStage === "exporting"
      ? "正在准备掩码…"
      : submissionStage === "uploading"
        ? "正在上传掩码…"
        : submissionStage === "creating"
          ? "正在创建任务…"
          : "提交局部重绘";

  return (
    <div aria-busy={submitting} className={styles.inpaintLayout}>
      <figure className={styles.maskStage}>
        <div className={styles.maskMedia} data-busy={submitting}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="局部重绘原图" src={candidate.url} />
          {imageDimensions ? (
            <MaskCanvas
              brushRatio={brushRatio}
              descriptionId={maskHelpId}
              height={height}
              onChange={onMaskChange}
              ref={mask}
              width={width}
            />
          ) : null}
        </div>
        <figcaption id={maskHelpId}>
          涂抹需要修改的区域，也可以使用右侧“标记中央区域”
        </figcaption>
      </figure>
      <aside className={styles.inpaintControls}>
        <div>
          <span>LOCAL EDIT</span>
          <strong>选择并描述修改</strong>
        </div>
        <label>
          <span>修改说明</span>
          <textarea
            aria-label="局部重绘说明"
            disabled={submitting}
            maxLength={1000}
            onChange={(event) => {
              setPrompt(event.target.value);
              setError(null);
            }}
            placeholder="例如：将领口改为窄驳领，保持面料与光线"
            value={prompt}
          />
        </label>
        <section
          aria-labelledby={paletteHeadingId}
          className={styles.inpaintPalette}
        >
          <label className={styles.paletteToggle}>
            <span>
              <strong id={paletteHeadingId}>使用色卡</strong>
              <small>可选 · 只约束涂抹区域的颜色</small>
            </span>
            <input
              checked={paletteEnabled}
              disabled={availablePalettes.length === 0 || submitting}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setUsePalette(enabled);
                setSelectedPaletteId(
                  enabled ? (availablePalettes[0]?.id ?? null) : null,
                );
                setError(null);
              }}
              role="switch"
              type="checkbox"
            />
          </label>
          {availablePalettes.length === 0 ? (
            <p>画布中暂无色卡，可关闭窗口后通过“添加色卡”创建。</p>
          ) : paletteEnabled ? (
            <div
              aria-label="选择本次局部重绘色卡"
              className={styles.paletteChoices}
              role="radiogroup"
            >
              {availablePalettes.map((palette, index) => {
                const selected = palette.id === selectedPaletteId;
                const paletteLabel = palette.colors
                  .map((color) => `${color.name} ${color.hex}`)
                  .join("、");
                return (
                  <label className={styles.paletteChoice} key={palette.id}>
                    <input
                      aria-label={`色卡 ${String(index + 1).padStart(2, "0")}：${paletteLabel}`}
                      checked={selected}
                      disabled={submitting}
                      name={`inpaint-palette-${paletteHeadingId}`}
                      onChange={() => {
                        setSelectedPaletteId(palette.id);
                        setError(null);
                      }}
                      type="radio"
                      value={palette.id}
                    />
                    <span aria-hidden="true" className={styles.palettePreview}>
                      {palette.colors.map((color) => (
                        <i
                          key={`${palette.id}-${color.hex}-${color.name}`}
                          style={{ backgroundColor: color.hex }}
                        />
                      ))}
                    </span>
                    <span className={styles.paletteMeta}>
                      <strong>色卡 {String(index + 1).padStart(2, "0")}</strong>
                      <small>{paletteLabel}</small>
                    </span>
                    <b aria-hidden="true">{selected ? "使用中" : "选择"}</b>
                  </label>
                );
              })}
            </div>
          ) : (
            <p>保持原图配色，不上传色卡信息。</p>
          )}
        </section>
        <label>
          <span>画笔尺寸 · {Math.round(brushRatio * 100)}%</span>
          <input
            aria-label="掩码画笔尺寸"
            disabled={submitting}
            max={0.16}
            min={0.02}
            onChange={(event) => setBrushRatio(Number(event.target.value))}
            step={0.01}
            type="range"
            value={brushRatio}
          />
        </label>
        <div className={styles.maskActions}>
          <button
            disabled={submitting}
            onClick={() => mask.current?.addCenterRegion()}
            type="button"
          >
            标记中央区域
          </button>
          <button
            disabled={submitting || maskState.strokeCount === 0}
            onClick={() => mask.current?.undo()}
            type="button"
          >
            撤销一笔
          </button>
          <button
            disabled={submitting || maskState.strokeCount === 0}
            onClick={() => mask.current?.clear()}
            type="button"
          >
            清空
          </button>
        </div>
        {submitting ? (
          <p aria-live="polite" role="status">
            {submitLabel}
          </p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
        <button
          className={styles.inpaintSubmit}
          disabled={submitting || !imageDimensions}
          onClick={() => void submit()}
          type="button"
        >
          {imageDimensions ? submitLabel : "正在读取原图…"}
        </button>
      </aside>
    </div>
  );
}
