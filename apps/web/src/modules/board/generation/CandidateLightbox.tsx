"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { InpaintPanel } from "./InpaintPanel";
import type { GenerationCandidate } from "./generation-types";
import { hasToneMismatch } from "./tone-analysis";
import { VariationControl } from "./VariationControl";
import { VersionTimeline } from "./VersionTimeline";
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
  readonly onAdopt: (candidate: GenerationCandidate) => void;
  readonly onClose: () => void;
  readonly onDiscard: () => void;
}) {
  const [activeCandidate, setActiveCandidate] = useState(candidate);
  const [mode, setMode] = useState<"history" | "inpaint" | "view">(
    initialMode,
  );
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
    if (
      activeCandidate.taskType === "inpaint" &&
      activeCandidate.sourceUrl
    ) {
      void hasToneMismatch(
        activeCandidate.sourceUrl,
        activeCandidate.url,
      ).then(
        (mismatch) => {
          if (!disposed) setToneWarning(mismatch === true);
        },
      );
    }
    return () => {
      disposed = true;
    };
  }, [activeCandidate]);

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
            <strong>
              {mode === "inpaint"
                ? "局部编辑模式"
                : mode === "history"
                  ? "版本与血缘"
                  : "候选设计"}
            </strong>
          </div>
          <nav aria-label="候选操作">
            <button onClick={() => setMode("view")} type="button">
              预览
            </button>
            <button onClick={() => setMode("inpaint")} type="button">
              局部重绘
            </button>
            <button onClick={() => setMode("history")} type="button">
              版本
            </button>
            <button onClick={() => onAdopt(activeCandidate)} type="button">
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
          <InpaintPanel candidate={activeCandidate} onSubmitted={onClose} />
        ) : mode === "history" ? (
          <VersionTimeline
            assetId={activeCandidate.assetId}
            onRestore={(asset) =>
              setActiveCandidate((current) => ({
                ...current,
                assetId: asset.id,
                url: asset.url,
                ...(asset.height === null ? {} : { height: asset.height }),
                ...(asset.seed === null ? {} : { seed: asset.seed }),
                ...(asset.width === null ? {} : { width: asset.width }),
              }))
            }
          />
        ) : (
          <div className={styles.lightboxPreview}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="候选设计大图" src={activeCandidate.url} />
            </figure>
            <VariationControl candidate={activeCandidate} />
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
