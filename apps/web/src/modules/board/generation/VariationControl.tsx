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

const normalizedDimension = (value: number | undefined): number =>
  Math.max(256, Math.min(2048, Math.round((value ?? 1024) / 8) * 8));

export function VariationControl({
  candidate,
}: {
  readonly candidate: GenerationCandidate;
}) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [submitting, setSubmitting] = useState(false);
  const source = generation.tasks.find((task) => task.id === candidate.taskId);

  const generate = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await generation.startBatch(
        Array.from({ length: 3 }, () => ({
          parameters: {
            ...DEFAULT_GENERATION_PARAMETERS,
            height: normalizedDimension(candidate.height),
            width: normalizedDimension(candidate.width),
          },
          parentAssetId: candidate.assetId,
          projectId,
          prompt: source?.prompt ?? "生成相似设计变体",
          referenceImageUrl: candidate.url,
          shapeIds: editor.getSelectedShapeIds(),
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
      <p>基于当前成图提交三次独立的 GPT Image 2 高保真编辑。</p>
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
