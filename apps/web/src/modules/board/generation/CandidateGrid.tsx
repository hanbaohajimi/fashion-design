"use client";

import { useContext, useState } from "react";
import { useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import { CandidateLightbox } from "./CandidateLightbox";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import {
  DEFAULT_GENERATION_PARAMETERS,
  type GenerationCandidate,
} from "./generation-types";
import styles from "./generation.module.css";

interface CandidateGridProps {
  readonly onTaskCreated?: (
    taskId: string,
    prompt: string,
  ) => Promise<void> | void;
  readonly showHeader?: boolean;
}

export function CandidateGrid({
  onTaskCreated,
  showHeader,
}: CandidateGridProps = {}) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
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
  const candidates = generation.tasks.flatMap((task) => task.candidates);
  const visibleSourceCandidates = candidates.filter(
    (candidate) => candidate.disposition !== "dismissed",
  );
  const renderHeader = showHeader ?? true;

  if (visibleSourceCandidates.length === 0) return null;

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
    <section aria-label="生成候选" className={styles.candidateDock}>
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
        {visibleSourceCandidates.map((candidate, index) => (
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
                      onClick={() =>
                        setLightbox({ candidate, mode: "inpaint" })
                      }
                      type="button"
                    >
                      局部改
                    </button>
                    <button
                      onClick={() =>
                        void generation.dismissCandidate(candidate.id)
                      }
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
      {lightbox ? (
        <CandidateLightbox
          {...(onTaskCreated ? { onTaskCreated } : {})}
          candidate={lightbox.candidate}
          initialMode={lightbox.mode}
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
