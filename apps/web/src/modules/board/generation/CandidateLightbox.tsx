"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { InpaintPanel } from "./InpaintPanel";
import type { GenerationCandidate } from "./generation-types";
import { hasToneMismatch } from "./tone-analysis";
import { VariationControl } from "./VariationControl";
import styles from "./generation.module.css";

export function CandidateLightbox({
  candidate,
  initialMode,
  onAdopt,
  onClose,
  onDiscard,
}: {
  readonly candidate: GenerationCandidate;
  readonly initialMode: "view" | "inpaint";
  readonly onAdopt: () => void;
  readonly onClose: () => void;
  readonly onDiscard: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [toneWarning, setToneWarning] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    if (candidate.taskType === "inpaint" && candidate.sourceUrl) {
      void hasToneMismatch(candidate.sourceUrl, candidate.url).then(
        (mismatch) => {
          if (!disposed) setToneWarning(mismatch === true);
        },
      );
    }
    return () => {
      disposed = true;
    };
  }, [candidate]);

  return createPortal(
    <div
      aria-label="候选设计详情"
      aria-modal="true"
      className={styles.lightboxBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className={styles.lightbox}>
        <header>
          <div>
            <span>LIGHTBOX / EDIT</span>
            <strong>{mode === "inpaint" ? "局部编辑模式" : "候选设计"}</strong>
          </div>
          <nav aria-label="候选操作">
            <button onClick={() => setMode("view")} type="button">
              预览
            </button>
            <button onClick={() => setMode("inpaint")} type="button">
              局部重绘
            </button>
            <button onClick={onAdopt} type="button">
              采纳
            </button>
            <button onClick={onDiscard} type="button">
              丢弃
            </button>
            <button aria-label="关闭候选详情" onClick={onClose} type="button">
              关闭
            </button>
          </nav>
        </header>
        {toneWarning ? (
          <p className={styles.toneWarning} role="status">
            局部结果与原图平均色调差异较大，建议降低强度或重新生成。
          </p>
        ) : null}
        {mode === "inpaint" ? (
          <InpaintPanel candidate={candidate} onSubmitted={onClose} />
        ) : (
          <div className={styles.lightboxPreview}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="候选设计大图" src={candidate.url} />
            </figure>
            <VariationControl candidate={candidate} />
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
