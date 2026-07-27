"use client";

import { useContext, useState } from "react";
import { useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { DEFAULT_GENERATION_PARAMETERS } from "./GenerationBar";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import type { GenerationCandidate } from "./generation-types";
import styles from "./generation.module.css";

const MAX_SEED = 4_294_967_295;
const normalizedDimension = (value: number | undefined): number =>
  Math.max(256, Math.min(2048, Math.round((value ?? 1024) / 8) * 8));
const seedsFrom = (seed: number): readonly number[] =>
  [1, 2, 3].map((offset) => (seed + offset) % MAX_SEED);

export function VariationControl({
  candidate,
}: {
  readonly candidate: GenerationCandidate;
}) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [strength, setStrength] = useState(0.45);
  const [submitting, setSubmitting] = useState(false);
  const source = generation.tasks.find((task) => task.id === candidate.taskId);
  const variationSeeds =
    candidate.seed === undefined
      ? []
      : seedsFrom(candidate.seed);

  const generate = async (): Promise<void> => {
    if (variationSeeds.length !== 3) return;
    setSubmitting(true);
    try {
      await Promise.all(
        variationSeeds.map((seed) =>
          generation.start({
            parameters: {
              ...DEFAULT_GENERATION_PARAMETERS,
              height: normalizedDimension(candidate.height),
              seed,
              width: normalizedDimension(candidate.width),
            },
            projectId,
            prompt: source?.prompt ?? "生成相似设计变体",
            referenceImageUrl: candidate.url,
            shapeIds: editor.getSelectedShapeIds(),
            strength,
            taskType: "i2i",
          }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.variationControl} aria-label="变体生成">
      <span>VARIATION / 03</span>
      <h3>保留结构，展开三条方向</h3>
      <p>使用原任务 seed 的连续三个值，确保差异可控且仍与原图相似。</p>
      <label>
        <span>变化强度 · {strength.toFixed(2)}</span>
        <input
          aria-label="变体强度"
          max={0.8}
          min={0.2}
          onChange={(event) => setStrength(Number(event.target.value))}
          step={0.05}
          type="range"
          value={strength}
        />
      </label>
      {candidate.seed === undefined ? (
        <small>原任务缺少 seed，无法生成可追溯变体。</small>
      ) : (
        <small>
          SEED {variationSeeds.join(" / ")}
        </small>
      )}
      <button
        disabled={candidate.seed === undefined || submitting}
        onClick={() => void generate()}
        type="button"
      >
        {submitting ? "正在创建 3 个任务…" : "生成 3 个变体"}
      </button>
    </section>
  );
}
