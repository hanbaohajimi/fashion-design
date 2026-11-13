"use client";

/**
 * AssistantMessage — 消息渲染壳（无状态展示组件）
 *
 * 四类消息形态：用户软卡、AI prose、工具时间线、结果卡。
 * 业务逻辑在 WorkflowAssistantPanel 中，这里只提供结构。
 */

import type { ReactNode } from "react";
import styles from "./assistant-ui.module.css";

type MessageRole = "user" | "assistant";

interface AssistantMessageProps {
  readonly role: MessageRole;
  /** 标记为新入场消息（触发 stagger 动画） */
  readonly isNew?: boolean;
  readonly children: ReactNode;
}

export function AssistantMessage({
  role,
  isNew = false,
  children,
}: AssistantMessageProps) {
  if (role === "user") {
    return (
      <div className={styles.messageGroup} data-new={isNew ? "true" : undefined}>
        <div className={styles.messageUser}>{children}</div>
      </div>
    );
  }

  // AI 消息：茜草签名圆点 + prose 内容
  return (
    <div className={styles.messageGroup} data-new={isNew ? "true" : undefined}>
      <div className={styles.messageAssistant}>
        <span className={styles.aiSignature} aria-hidden="true">✦</span>
        <div className={styles.messageAssistantContent}>{children}</div>
      </div>
    </div>
  );
}

/** 时间戳分隔（组级，间隔 >5 分钟显示） */
export function AssistantTimestamp({ children }: { readonly children: ReactNode }) {
  return <span className={styles.messageTimestamp}>{children}</span>;
}

/** 工具/思考时间线 */
interface ActivityRowProps {
  readonly status?: "running" | "done" | "error";
  readonly label: string;
  readonly meta?: string;
  readonly icon?: ReactNode;
}

export function AssistantActivityRow({ status, label, meta, icon }: ActivityRowProps) {
  return (
    <div className={styles.activityRow} data-status={status}>
      <span className={styles.activityIcon} aria-hidden="true">{icon}</span>
      <span className={styles.activityLabel}>{label}</span>
      {meta && <span className={styles.activityMeta}>{meta}</span>}
    </div>
  );
}

/** 折叠活动行摘要（连续 ≥2 条时） */
export function AssistantActivitySummary({
  label,
  meta,
  children,
}: {
  readonly label: string;
  readonly meta?: string;
  readonly children: ReactNode;
}) {
  return (
    <details className={styles.activityTimeline}>
      <summary className={styles.activitySummary}>
        <span aria-hidden="true" />
        <span>{label}</span>
        {meta && <span className={styles.activityMeta}>{meta}</span>}
      </summary>
      {children}
    </details>
  );
}
