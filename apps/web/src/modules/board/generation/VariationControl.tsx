"use client";

import { useContext, useState } from "react";
import { useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import {
  DEFAULT_GENERATION_PARAMETERS,
  type GenerationCandidate,
} from "./generation-types";
import styles from "./generation.module.css";

const MAX_SEED = 4_294_967_295;
const normalizedDimension = (value: number | undefined): number =>
  Math.max(256, Math.min(2048, Math.round((value ?? 1024) / 8) * 8));
const seedsFrom = (seed: number): readonly number[] =>
  [1, 2, 3].map((offset) => (seed + offset) % MAX_SEED);
const trackingSeedFrom = (value: string): number => {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

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
  const variationSeeds = seedsFrom(
    candidate.seed ?? trackingSeedFrom(candidate.assetId),
  );

  const generate = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await generation.startBatch(
        variationSeeds.map((seed) => ({
            parameters: {
              ...DEFAULT_GENERATION_PARAMETERS,
              height: normalizedDimension(candidate.height),
              seed,
              width: normalizedDimension(candidate.width),
            },
            parentAssetId: candidate.assetId,
            projectId,
            prompt: source?.prompt ?? "生成相似设计变体",
            referenceImageUrl: candidate.url,
            shapeIds: editor.getSelectedShapeIds(),
            strength,
            taskType: "i2i",
          })),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.variationControl} aria-label="变体生成">
      <span>VARIATION / 03</span>
      <h3>保留结构，展开三条方向</h3>
      <p>
        {candidate.seed === undefined
          ? "基于当前成图展开三条受控变化，并为每条任务写入可追踪 seed。"
          : "使用原任务 seed 的连续三个值，确保差异可控且仍与原图相似。"}
      </p>
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
        <small>TRACKING SEED {variationSeeds.join(" / ")}</small>
      ) : (
        <small>
          SEED {variationSeeds.join(" / ")}
        </small>
      )}
      <button
        disabled={submitting}
        onClick={() => void generate()}
        type="button"
      >
        {submitting ? "正在创建 3 个任务…" : "生成 3 个变体"}
      </button>
    </section>
  );
}
