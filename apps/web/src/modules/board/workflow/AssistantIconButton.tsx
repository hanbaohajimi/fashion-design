"use client";

import type { ButtonHTMLAttributes } from "react";
import { Tooltip } from "../../../components/ui";
import { WorkspaceIcon, type AssistantIconName } from "./WorkspaceIcon";
import styles from "./assistant-redesign.module.css";

export function AssistantIconButton({
  label,
  icon,
  primary = false,
  busy = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: AssistantIconName;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        {...props}
        type="button"
        aria-label={label}
        aria-busy={busy || undefined}
        className={`${styles.iconButton} ${primary ? styles.sendButton : ""} ${className}`}
      >
        <WorkspaceIcon name={icon} />
      </button>
    </Tooltip>
  );
}
