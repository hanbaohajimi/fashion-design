"use client";

/**
 * AssistantSurface — 助手面板外壳（无状态展示组件）
 *
 * 只管外观：大圆角浮动卡片、玻璃头部、可滚动消息区、底部 composer 槽。
 * 业务逻辑全部在 WorkflowAssistantPanel 中，这里只提供 slot 注入。
 */

import type { ReactNode, CSSProperties } from "react";
import styles from "./assistant-ui.module.css";

interface AssistantSurfaceProps {
  /** 头部区域（标题 + 图标按钮组） */
  readonly header?: ReactNode;
  /** 消息滚动区内容 */
  readonly children: ReactNode;
  /** composer 插槽 */
  readonly composer?: ReactNode;
  /** spotlight 模式：空状态时 composer 居中展示 */
  readonly spotlightComposer?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** 滚动区 ref（用于自动滚底） */
  readonly scrollRef?: React.RefObject<HTMLDivElement>;
}

export function AssistantSurface({
  header,
  children,
  composer,
  spotlightComposer = false,
  className,
  style,
  scrollRef,
}: AssistantSurfaceProps) {
  return (
    <div className={`${styles.surface} ${className ?? ""}`} style={style}>
      {header && <header className={styles.surfaceHeader}>{header}</header>}
      <div
        className={styles.scrollArea}
        ref={scrollRef}
        aria-label="助手对话"
      >
        {children}
      </div>
      {composer && (
        <div
          className={
            spotlightComposer
              ? `${styles.composerFrame} ${styles.composerFrameSpotlight}`
              : styles.composerFrame
          }
        >
          {composer}
        </div>
      )}
    </div>
  );
}

/** 助手头部：标题 + 右侧图标按钮组 */
export function AssistantHeader({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <>
      <span className={styles.surfaceTitle}>{title}</span>
      {children && (
        <div className={styles.headerActions}>{children}</div>
      )}
    </>
  );
}

/** 单个头部图标按钮 */
export function AssistantHeaderBtn({
  label,
  active,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.headerBtn}
      aria-label={label}
      aria-pressed={active}
      data-active={active ? "true" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
