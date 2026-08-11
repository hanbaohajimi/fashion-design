"use client";

import { useCallback, useContext, useId, useRef, useState } from "react";
import { useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
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
} from "./generation-types";
import styles from "./generation.module.css";

function normalizedDimension(value: number | undefined): number {
  const safe = Math.min(2048, Math.max(256, value ?? 1024));
  return Math.max(256, Math.round(safe / 8) * 8);
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
  const [maskState, setMaskState] = useState<MaskCanvasState>({
    coverage: 0,
    strokeCount: 0,
  });
  const [brushRatio, setBrushRatio] = useState(0.06);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmSmall, setConfirmSmall] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const maskHelpId = useId();
  const width = normalizedDimension(candidate.width);
  const height = normalizedDimension(candidate.height);
  const onMaskChange = useCallback((state: MaskCanvasState) => {
    setMaskState(state);
    setConfirmSmall(false);
    setError(null);
  }, []);

  const submit = async (): Promise<void> => {
    if (!mask.current || maskState.strokeCount === 0) {
      setError("掩码为空，请先涂抹需要重绘的区域");
      return;
    }
    if (prompt.trim().length < 3) {
      setError("请描述局部区域需要如何修改");
      return;
    }
    if (maskState.coverage < 0.05 && !confirmSmall) {
      setConfirmSmall(true);
      setError("当前掩码不足图片面积的 5%，再次提交可继续");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const blob = await mask.current.exportPng();
      const maskImageUrl = await uploadTemporaryMask(
        projectId,
        blob,
        width,
        height,
      );
      const result = await generation.start({
        parameters: {
          ...DEFAULT_GENERATION_PARAMETERS,
          height,
          width,
          ...(candidate.seed !== undefined ? { seed: candidate.seed } : {}),
        },
        maskImageUrl,
        parentAssetId: candidate.assetId,
        projectId,
        prompt: prompt.trim(),
        referenceImageUrl: candidate.url,
        shapeIds: editor.getSelectedShapeIds(),
        strength: 0.82,
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
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.inpaintLayout}>
      <figure className={styles.maskStage}>
        <div className={styles.maskMedia}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="局部重绘原图" src={candidate.url} />
          <MaskCanvas
            brushRatio={brushRatio}
            descriptionId={maskHelpId}
            height={height}
            onChange={onMaskChange}
            ref={mask}
            width={width}
          />
        </div>
        <figcaption id={maskHelpId}>
          白色区域将被重绘；键盘用户可用右侧“标记中央区域”
        </figcaption>
      </figure>
      <aside className={styles.inpaintControls}>
        <div>
          <span>INPAINT / MASK</span>
          <strong>局部重绘</strong>
        </div>
        <label>
          <span>修改说明</span>
          <textarea
            aria-label="局部重绘说明"
            maxLength={1000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：将领口改为窄驳领，保持面料与光线"
            value={prompt}
          />
        </label>
        <label>
          <span>画笔尺寸 · {Math.round(brushRatio * 100)}%</span>
          <input
            aria-label="掩码画笔尺寸"
            max={0.16}
            min={0.02}
            onChange={(event) => setBrushRatio(Number(event.target.value))}
            step={0.01}
            type="range"
            value={brushRatio}
          />
        </label>
        <div className={styles.maskMetrics}>
          <span>覆盖率</span>
          <strong>{(maskState.coverage * 100).toFixed(1)}%</strong>
        </div>
        <div className={styles.maskActions}>
          <button
            onClick={() => mask.current?.addCenterRegion()}
            type="button"
          >
            标记中央区域
          </button>
          <button
            disabled={maskState.strokeCount === 0}
            onClick={() => mask.current?.undo()}
            type="button"
          >
            撤销一笔
          </button>
          <button
            disabled={maskState.strokeCount === 0}
            onClick={() => mask.current?.clear()}
            type="button"
          >
            清空
          </button>
        </div>
        <small>掩码仅上传到临时目录，不会进入用户资产库。</small>
        {error ? <p role="alert">{error}</p> : null}
        <button
          className={styles.inpaintSubmit}
          disabled={submitting}
          onClick={() => void submit()}
          type="button"
        >
          {submitting ? "正在上传掩码…" : "提交局部重绘"}
        </button>
      </aside>
    </div>
  );
}
