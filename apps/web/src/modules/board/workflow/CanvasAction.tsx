"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import WarmTooltip from "../../../components/WarmTooltip";
import { WorkspaceIcon, type AssistantIconName } from "./WorkspaceIcon";
import styles from "./canvas-action.module.css";

export function CanvasAction({ label, icon, text, shortcut, className = "", side = "top", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: AssistantIconName; text?: string; shortcut?: ReactNode; side?: "top" | "bottom" }) {
  return <WarmTooltip content={label} shortcut={shortcut} side={side}><button {...props} type={props.type ?? "button"} aria-label={label} className={`${styles.action} ${text ? styles.withText : ""} ${className}`}>
    <WorkspaceIcon name={icon} />{text ? <span data-action-label>{text}</span> : null}
  </button></WarmTooltip>;
}
