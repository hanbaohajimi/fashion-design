"use client";

import { useRef } from "react";
import styles from "./canvas-welcome.module.css";

export function CanvasWelcome({
  canEdit,
  assistantOpen,
  onStart,
  onUpload,
  onSketch,
}: {
  canEdit: boolean;
  assistantOpen: boolean;
  onStart?: ((focusInput: boolean) => void) | undefined;
  onUpload: () => void;
  onSketch: () => void;
}) {
  const pointer = useRef("mouse");
  return (
    <section className={styles.welcome} aria-label="开始创作">
      <div className={styles.content}>
        <svg
          className={styles.mark}
          width="64"
          height="56"
          viewBox="0 0 64 56"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 12h29v33H10z"
            fill="var(--color-surface)"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="m26 6 29 5-6 34-29-5z"
            fill="var(--color-paper)"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="m35 17 8 1 5 7-5 2-3 12-11-2 2-12-4-3 8-5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path
            d="M9 49h38"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <h2>
          {!canEdit
            ? "白板中还没有素材"
            : assistantOpen
              ? "把参考素材放在这里"
              : "从一个想法开始"}
        </h2>
        <p>
          {!canEdit
            ? "项目中的素材和作品将在这里展示。"
            : assistantOpen
              ? "把面料、参考图和草图放在一起，选中后就能引用到对话。"
              : "描述你想做的服装，或先放入参考图和草图。"}
        </p>
        {canEdit ? (
          <>
            {!assistantOpen && onStart ? (
              <button
                className={styles.primary}
                type="button"
                onPointerDown={(event) => {
                  pointer.current = event.pointerType;
                }}
                onClick={(event) =>
                  onStart(event.detail === 0 || pointer.current !== "touch")
                }
              >
                描述设计想法 <span aria-hidden="true">↗</span>
              </button>
            ) : null}
            <div className={styles.actions}>
              <button type="button" onClick={onUpload}>
                上传参考图
              </button>
              <button type="button" onClick={onSketch}>
                绘制草图
              </button>
            </div>
            <small>图片可直接拖入，也可以复制后粘贴。</small>
          </>
        ) : null}
      </div>
    </section>
  );
}
