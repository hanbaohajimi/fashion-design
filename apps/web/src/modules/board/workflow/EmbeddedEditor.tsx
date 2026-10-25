"use client";

import type { ReactNode } from "react";
import { Dialog } from "../../../components/ui";
import styles from "./workflow-detail-workspace.module.css";

/** Existing dialogs keep their public behavior outside the canvas workspace. */
export function EmbeddedEditor({
  embedded,
  label,
  className,
  onClose,
  children,
  returnFocusSelector,
}: {
  embedded?: boolean | undefined;
  label: string;
  className?: string | undefined;
  onClose: () => void;
  children: ReactNode;
  returnFocusSelector?: string;
}) {
  if (embedded)
    return (
      <section
        data-embedded-editor
        aria-label={label}
        className={`${styles.embedded} ${className ?? ""}`}
      >
        {children}
      </section>
    );
  return (
    <Dialog
      label={label}
      onClose={onClose}
      {...(className ? { className } : {})}
      {...(returnFocusSelector ? { returnFocusSelector } : {})}
    >
      {children}
    </Dialog>
  );
}
