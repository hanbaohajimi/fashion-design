"use client";

import type { ReactNode } from "react";
import { Menu, Tooltip } from "../../../components/ui";
import { useAssistantWindow } from "../../../components/AssistantWindow";
import { AssistantIconButton } from "./AssistantIconButton";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./assistant-redesign.module.css";

export function AssistantHeader({
  title,
  busy,
  onNew,
  history,
  children,
}: {
  title: string;
  busy: boolean;
  onNew: () => void;
  history: ReactNode;
  children: ReactNode;
}) {
  const window = useAssistantWindow();
  const floating = window?.mode === "floating";
  return (
    <header
      className={styles.header}
      {...window?.dragProps}
      aria-label={floating ? "移动设计助手" : "设计助手工具栏"}
      aria-description={
        floating
          ? "拖动或使用方向键移动，Shift 加大步幅，Enter 确定，Escape 撤销。"
          : undefined
      }
    >
      <Menu
        label="历史对话"
        disabled={busy}
        className={styles.historyMenu}
        align="start"
        trigger={
          <>
            <span title={title}>{title}</span>
            <WorkspaceIcon name="chevron" />
          </>
        }
      >
        {history}
      </Menu>
      <div className={styles.headerActions}>
        <AssistantIconButton
          label="新建对话"
          icon="new_chat"
          disabled={busy}
          onClick={onNew}
        />
        {window && window.mode !== "mobile" ? (
          <AssistantIconButton
            label={
              floating
                ? window.canDock
                  ? "停靠到右侧"
                  : "空间不足，暂时无法停靠"
                : "切换为浮窗"
            }
            icon={floating ? "dock" : "float"}
            disabled={floating && !window.canDock}
            onClick={() =>
              window.setPresentation(floating ? "docked" : "floating")
            }
          />
        ) : null}
        <Tooltip content="更多助手操作">
          <Menu
            label="助手设置"
            className={styles.iconMenu}
            trigger={<WorkspaceIcon name="more" />}
          >
            {children}
            {floating ? (
              <button type="button" onClick={window.reset}>
                <WorkspaceIcon name="reset" />
                恢复默认位置
              </button>
            ) : null}
          </Menu>
        </Tooltip>
        {window ? (
          <AssistantIconButton
            label={window.mode === "mobile" ? "返回画布" : "收起设计助手"}
            icon={window.mode === "mobile" ? "back" : "minimize"}
            onClick={window.close}
          />
        ) : null}
      </div>
    </header>
  );
}
