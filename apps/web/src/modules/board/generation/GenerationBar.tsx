"use client";

import { type CSSProperties, useContext, useState } from "react";
import { useEditor, useValue } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { isBoardShape, normalizeBoardRole } from "../shapes";
import { ConstraintChips } from "./ConstraintChips";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import type { GenerationParameters } from "./generation-types";
import styles from "./generation.module.css";

export const DEFAULT_GENERATION_PARAMETERS: GenerationParameters = {
  background: "opaque",
  cfg: 3.5,
  height: 1024,
  outputCompression: 90,
  outputFormat: "png",
  quality: "high",
  steps: 28,
  width: 1024,
};

export function GenerationBar() {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parameters, setParameters] = useState(DEFAULT_GENERATION_PARAMETERS);
  const [submitting, setSubmitting] = useState(false);
  const selection = useValue(
    "generation-selection",
    () => {
      const shapes = editor.getSelectedShapes().filter(isBoardShape);
      const bounds = editor.getSelectionPageBounds();
      if (!bounds || shapes.length === 0) return null;
      const viewport = editor.pageToViewport({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height,
      });
      return {
        roles: shapes.map((shape) => normalizeBoardRole(shape.props.role)),
        shapeIds: shapes.map((shape) => shape.id),
        viewport,
      };
    },
    [editor],
  );

  if (!selection) return null;

  const style = {
    "--generation-x": `${Math.min(
      Math.max(selection.viewport.x, 260),
      Math.max(260, window.innerWidth - 260),
    )}px`,
    "--generation-y": `${Math.min(
      selection.viewport.y + 14,
      window.innerHeight - 190,
    )}px`,
  } as CSSProperties;

  const submit = async (): Promise<void> => {
    if (submitting) {
      return;
    }
    const normalized = prompt.trim();
    if (normalized.length < 3) {
      setError("请用至少 3 个字描述希望生成的设计");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await generation.start({
        parameters,
        projectId,
        prompt: normalized,
        shapeIds: selection.shapeIds,
      });
      if (!result.ok) {
        setError(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="生成浮条"
      className={styles.generationBar}
      onPointerDown={(event) => event.stopPropagation()}
      style={style}
    >
      <div className={styles.generationBarTopline}>
        <ConstraintChips roles={selection.roles} />
        <span>{selection.shapeIds.length} 项参与编译</span>
      </div>
      <div className={styles.promptRow}>
        <label>
          <span>生成描述</span>
          <input
            aria-label="生成描述"
            maxLength={4000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                !submitting
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="例如：轻量廓形，保留面料肌理"
            value={prompt}
          />
        </label>
        <button
          disabled={submitting}
          onClick={() => void submit()}
          type="button"
        >
          {submitting ? "提交中…" : "生成"}
        </button>
      </div>
      <details className={styles.advancedOptions}>
        <summary>高级参数</summary>
        <div>
          <label>
            尺寸
            <select
              aria-label="生成尺寸"
              onChange={(event) => {
                const [width, height] = event.target.value
                  .split("x")
                  .map(Number);
                if (width && height) {
                  setParameters((current) => ({
                    ...current,
                    height,
                    width,
                  }));
                }
              }}
              value={`${parameters.width}x${parameters.height}`}
            >
              <option value="1024x1024">方形 1:1</option>
              <option value="768x1024">竖版 3:4</option>
              <option value="1024x768">横版 4:3</option>
            </select>
          </label>
          <label>
            质量
            <select
              aria-label="生成质量"
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  quality: event.target.value as
                    | "auto"
                    | "high"
                    | "low"
                    | "medium",
                }))
              }
              value={parameters.quality ?? "high"}
            >
              <option value="low">草稿 · 快速</option>
              <option value="medium">标准</option>
              <option value="high">精细</option>
              <option value="auto">模型自动</option>
            </select>
          </label>
          <label>
            格式
            <select
              aria-label="输出格式"
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  outputFormat: event.target.value as
                    | "jpeg"
                    | "png"
                    | "webp",
                }))
              }
              value={parameters.outputFormat ?? "png"}
            >
              <option value="png">PNG · 无损</option>
              <option value="jpeg">JPEG · 更快</option>
              <option value="webp">WebP · 更小</option>
            </select>
          </label>
          <span className={styles.providerParameterHint}>
            GPT Image 2 使用尺寸、质量和格式；CFG、步数已保留给后续 SD
            Provider，不会发送到 Amux。
          </span>
        </div>
      </details>
      {error ? <p role="status">{error}</p> : null}
    </section>
  );
}
