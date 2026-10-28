"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { MotionDialog } from "../interactions/motion-dialog";
import { Button } from "../ui";
import type { ResolvedGuideStep } from "./guide-model";
import { useGuideGeometry } from "./use-guide-geometry";
import styles from "./feature-guide.module.css";

export function FeatureGuideOverlay({ step, index, total, paused, closing, onMove, onDismiss, onAfterClose }: {
  readonly step: ResolvedGuideStep | undefined;
  readonly index: number;
  readonly total: number;
  readonly paused: boolean;
  readonly closing: boolean;
  readonly onMove: (direction: number) => void;
  readonly onDismiss: () => void;
  readonly onAfterClose: () => void;
}) {
  const maskId = useId().replaceAll(":", "");
  const descriptionId = useId();
  const card = useRef<HTMLDivElement>(null);
  const stepId = step?.id;
  const target = step?.target;
  const geometry = useGuideGeometry(target, `${stepId}:${step?.title}:${step?.description}`, !paused && !closing, card);

  useLayoutEffect(() => {
    const dialog = card.current?.closest("dialog");
    if (geometry && dialog === document.activeElement) card.current?.querySelector<HTMLElement>("[data-guide-next]")?.focus({ preventScroll: true });
  }, [geometry]);

  const highlight = geometry?.target;
  return <MotionDialog open={!paused && !closing && Boolean(step)} variant="guide" label="界面功能指引" describedBy={descriptionId} onClose={onDismiss} onAfterClose={onAfterClose}>
    <div data-feature-guide-content data-guide-step={stepId} className={styles.overlay}>
      <svg aria-hidden="true" className={styles.scrim} width="100%" height="100%">
        <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />{highlight && highlight.width > 0 && highlight.height > 0 ? <rect {...highlight} rx="10" fill="black" /> : null}</mask></defs>
        <rect width="100%" height="100%" fill="var(--color-scrim-soft)" mask={`url(#${maskId})`} />
        {highlight && highlight.width > 0 && highlight.height > 0 ? <g data-feature-guide-highlight><rect {...highlight} rx="10" fill="none" stroke="var(--color-paper)" strokeWidth="5" /><rect {...highlight} rx="10" fill="none" stroke="var(--color-action)" strokeWidth="2" /></g> : null}
      </svg>
      <div ref={card} data-feature-guide-card className={styles.card} style={{ left: geometry?.card.x ?? 16, top: geometry?.card.y ?? 16, width: geometry?.card.width, maxHeight: geometry?.card.height, visibility: geometry ? "visible" : "hidden" }}>
        <div className={styles.topline}>
          <span role="status" aria-live="polite" aria-atomic="true">功能指引 {index + 1} / {total}</span>
          <Button variant="ghost" size="small" onClick={onDismiss}>跳过</Button>
        </div>
        <div key={stepId} data-guide-copy className={styles.copy} aria-live="polite" aria-atomic="true">
          <h2>{step?.title}</h2>
          <p id={descriptionId}>{step?.description}</p>
        </div>
        <div className={styles.actions}>
          <Button disabled={index === 0} onClick={() => onMove(-1)}>上一步</Button>
          <Button data-guide-next variant="primary" onClick={() => onMove(1)}>{index === total - 1 ? "完成" : "下一步"}</Button>
        </div>
      </div>
    </div>
  </MotionDialog>;
}
