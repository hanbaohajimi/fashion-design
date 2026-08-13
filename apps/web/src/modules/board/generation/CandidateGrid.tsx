"use client";

import { useContext, useState } from "react";
import { createShapeId, useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { IMAGE_SHAPE_TYPE, type ImageShape } from "../shapes";
import { CandidateLightbox } from "./CandidateLightbox";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import {
  DEFAULT_GENERATION_PARAMETERS,
  type GenerationCandidate,
} from "./generation-types";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";

interface CandidateGridProps {
  readonly onTaskCreated?: (
    taskId: string,
    prompt: string,
  ) => Promise<void> | void;
  readonly showHeader?: boolean;
  readonly taskId?: string;
  readonly variant?: "conversation" | "history" | "workspace";
}

const CONVERSATION_PREVIEW_COUNT = 2;

export function CandidateGrid({
  onTaskCreated,
  showHeader,
  taskId,
  variant = "workspace",
}: CandidateGridProps = {}) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<{
    readonly candidate: GenerationCandidate;
    readonly mode: "view" | "inpaint";
  } | null>(null);
  const [rerunningCandidateId, setRerunningCandidateId] = useState<
    string | null
  >(null);
  const [openMenuCandidateId, setOpenMenuCandidateId] = useState<string | null>(
    null,
  );
  const candidates = taskId
    ? (generation.tasks.find((task) => task.id === taskId)?.candidates ?? [])
    : generation.tasks.flatMap((task) => task.candidates);
  const compact = variant === "conversation";
  const visibleSourceCandidates = candidates.filter(
    (candidate) =>
      variant === "history"
        ? candidate.disposition !== "dismissed"
        : candidate.disposition === undefined,
  );
  const visibleCandidates =
    compact && !expanded
      ? visibleSourceCandidates.slice(0, CONVERSATION_PREVIEW_COUNT)
      : visibleSourceCandidates;
  const renderHeader = showHeader ?? !compact;

  if (visibleSourceCandidates.length === 0) return null;

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
        generationCandidateId: candidate.id,
        generationTaskId: candidate.taskId,
        h: height,
        role: "garment_ref",
        roleInferenceState: "ready",
        roleSource: "default",
        title: "候选设计",
        uploadStatus: "ready",
        url: candidate.url,
        w: width,
      },
    });
    editor.select(shapeId);
    captureAnalytics("generation_adopted", {
      task_type: candidate.taskType,
    });
    void generation.dismissCandidate(candidate.id, "adopted");
  };

  const rerun = async (candidate: GenerationCandidate): Promise<void> => {
    if (rerunningCandidateId) {
      return;
    }
    const source = generation.tasks.find(
      (task) => task.id === candidate.taskId,
    );
    setRerunningCandidateId(candidate.id);
    try {
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
    } finally {
      setRerunningCandidateId(null);
    }
  };

  return (
    <section
      aria-label={compact ? "本轮生成候选" : "生成候选"}
      className={styles.candidateDock}
      data-variant={variant}
    >
      {renderHeader ? (
        <header>
          <div>
            <span>GENERATED / OPTIONS</span>
            <strong>候选工作台</strong>
          </div>
          <b>{candidates.length.toString().padStart(2, "0")}</b>
        </header>
      ) : null}
      <div className={styles.candidateGrid}>
        {visibleCandidates.map((candidate, index) => (
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
              <img alt="候选设计" src={candidate.url} />
            </button>
            <div className={styles.candidateActions}>
              <button onClick={() => adopt(candidate)} type="button">
                采纳
              </button>
              <div className={styles.candidateMenu}>
                <button
                  aria-expanded={openMenuCandidateId === candidate.id}
                  aria-label="更多候选操作"
                  onClick={() =>
                    setOpenMenuCandidateId((current) =>
                      current === candidate.id ? null : candidate.id,
                    )
                  }
                  title="更多操作"
                  type="button"
                >
                  <MoreIcon />
                </button>
                {openMenuCandidateId === candidate.id ? (
                  <div>
                  <button
                    disabled={rerunningCandidateId !== null}
                    onClick={() => void rerun(candidate)}
                    type="button"
                  >
                    {rerunningCandidateId === candidate.id
                      ? "创建中…"
                      : "再来一版"}
                  </button>
                  <button
                    onClick={() => setLightbox({ candidate, mode: "inpaint" })}
                    type="button"
                  >
                    局部改
                  </button>
                  <button
                    onClick={() => void generation.dismissCandidate(candidate.id)}
                    type="button"
                  >
                    丢弃
                  </button>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {compact && visibleSourceCandidates.length > CONVERSATION_PREVIEW_COUNT ? (
        <button
          aria-expanded={expanded}
          className={styles.candidateExpand}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded
            ? "收起候选"
            : `查看全部 ${visibleSourceCandidates.length} 个候选`}
        </button>
      ) : null}
      {lightbox ? (
        <CandidateLightbox
          {...(onTaskCreated ? { onTaskCreated } : {})}
          candidate={lightbox.candidate}
          initialMode={lightbox.mode}
          onAdopt={(candidate) => {
            adopt(candidate);
            setLightbox(null);
          }}
          onClose={() => setLightbox(null)}
          onDiscard={() => {
            void generation.dismissCandidate(lightbox.candidate.id);
            setLightbox(null);
          }}
        />
      ) : null}
    </section>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
