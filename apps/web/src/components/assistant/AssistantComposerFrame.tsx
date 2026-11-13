"use client";

/**
 * AssistantComposerFrame — 输入区外壳（无状态展示组件）
 *
 * 结构：chips 行（引用/图片托盘）→ textarea 槽 → 底部操作条。
 * 业务逻辑在 WorkflowAssistantPanel 中。
 */

import type { ReactNode } from "react";
import styles from "./assistant-ui.module.css";

interface AssistantComposerFrameProps {
  /** chips 行内容（引用标签 / 图片托盘） */
  readonly chips?: ReactNode;
  /** textarea 插槽 */
  readonly textarea: ReactNode;
  /** 底部操作条左侧插槽（附件、引用图标按钮） */
  readonly actionsLeft?: ReactNode;
  /** 底部操作条右侧发送按钮 */
  readonly sendButton?: ReactNode;
  /** 居中键盘提示（Enter/Shift+Enter），移动端自动隐藏 */
  readonly hint?: ReactNode;
  /** spotlight 模式：空状态时居中大号呈现 */
  readonly spotlight?: boolean;
}

export function AssistantComposerFrame({
  chips,
  textarea,
  actionsLeft,
  sendButton,
  hint,
  spotlight = false,
}: AssistantComposerFrameProps) {
  return (
    <div
      className={
        spotlight
          ? `${styles.composerFrame} ${styles.composerFrameSpotlight}`
          : styles.composerFrame
      }
    >
      {chips && <div className={styles.composerChips}>{chips}</div>}
      {textarea}
      <div className={styles.composerActions}>
        <div className={styles.composerActionLeft}>{actionsLeft}</div>
        {hint && <span className={styles.composerHint}>{hint}</span>}
        {sendButton}
      </div>
    </div>
  );
}

/** 单个图标操作按钮（附件/引用） */
export function ComposerIconBtn({
  label,
  onClick,
  children,
  disabled,
}: {
  readonly label: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.composerIconBtn}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** 发送按钮 */
export function ComposerSendBtn({
  label = "发送需求",
  disabled,
  loading,
  onClick,
}: {
  readonly label?: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.composerSend}
      aria-label={label}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading}
    >
      {loading ? (
        // 环状 spinner
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
          <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.7s" repeatCount="indefinite" />
          </path>
        </svg>
      ) : (
        // 发送箭头
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
