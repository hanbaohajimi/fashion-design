"use client";

import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { createShapeId, useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { IMAGE_SHAPE_TYPE, type ImageShape } from "../shapes";
import { CandidateLightbox } from "./CandidateLightbox";
import { DEFAULT_GENERATION_PARAMETERS } from "./GenerationBar";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import type { GenerationCandidate } from "./generation-types";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";

export function CandidateGrid() {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [lightbox, setLightbox] = useState<{
    readonly candidate: GenerationCandidate;
    readonly mode: "view" | "inpaint";
  } | null>(null);
  const candidates = generation.tasks.flatMap((task) => task.candidates);

  if (candidates.length === 0) return null;

  const adopt = (candidate: GenerationCandidate): void => {
    const selection = editor.getSelectionPageBounds();
    const viewport = editor.getViewportPageBounds();
    const width = Math.min(candidate.width ?? 360, 480);
    const ratio =
      candidate.width && candidate.height
        ? candidate.height / candidate.width
        : 1;
    const height = Math.max(160, Math.round(width * ratio));
    const x = selection
      ? selection.x + selection.width + 48
      : viewport.center.x - width / 2;
    const y = selection ? selection.y : viewport.center.y - height / 2;
    const shapeId = createShapeId();
    editor.createShape<ImageShape>({
      id: shapeId,
      type: IMAGE_SHAPE_TYPE,
      x,
      y,
      props: {
        assetId: candidate.assetId,
        h: height,
        role: "style_ref",
        roleInferenceState: "ready",
        roleSource: "default",
        title: "AI 候选设计",
        uploadStatus: "ready",
        url: candidate.url,
        w: width,
      },
    });
    editor.select(shapeId);
    captureAnalytics("generation_adopted", {
      task_type: candidate.taskType,
    });
    generation.dismissCandidate(candidate.id);
  };

  const rerun = async (
    candidate: GenerationCandidate,
  ): Promise<void> => {
    const source = generation.tasks.find((task) => task.id === candidate.taskId);
    await generation.start({
      parameters: DEFAULT_GENERATION_PARAMETERS,
      parentAssetId: candidate.assetId,
      projectId,
      prompt: source?.prompt || "生成设计变体",
      shapeIds: editor.getSelectedShapeIds(),
      taskType: "i2i",
      referenceImageUrl: candidate.url,
      strength: 0.5,
    });
  };

  return createPortal(
    <section className={styles.candidateDock} aria-label="生成候选">
      <header>
        <div>
          <span>GENERATED / OPTIONS</span>
          <strong>候选工作台</strong>
        </div>
        <b>{candidates.length.toString().padStart(2, "0")}</b>
      </header>
      <div className={styles.candidateGrid}>
        {candidates.map((candidate, index) => (
          <article
            className={styles.candidateCard}
            key={candidate.id}
            style={{ animationDelay: `${Math.min(index, 6) * 80}ms` }}
          >
            <button
              aria-label="打开候选详情"
              className={styles.candidateImageButton}
              onClick={() => setLightbox({ candidate, mode: "view" })}
              type="button"
            >
              {/* Provider result URLs are persisted by the generation task. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="AI 生成候选设计" src={candidate.url} />
            </button>
            <div className={styles.candidateActions}>
              <button onClick={() => adopt(candidate)} type="button">
                采纳
              </button>
              <button
                onClick={() => generation.dismissCandidate(candidate.id)}
                type="button"
              >
                丢弃
              </button>
              <button onClick={() => void rerun(candidate)} type="button">
                再来一版
              </button>
              <button
                onClick={() => setLightbox({ candidate, mode: "inpaint" })}
                type="button"
              >
                局部改
              </button>
            </div>
          </article>
        ))}
      </div>
      {lightbox ? (
        <CandidateLightbox
          candidate={lightbox.candidate}
          initialMode={lightbox.mode}
          onAdopt={(candidate) => {
            adopt(candidate);
            setLightbox(null);
          }}
          onClose={() => setLightbox(null)}
          onDiscard={() => {
            generation.dismissCandidate(lightbox.candidate.id);
            setLightbox(null);
          }}
        />
      ) : null}
    </section>,
    document.body,
  );
}
