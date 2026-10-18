"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./workflow-canvas.module.css";

/** Native modal dialogs provide Escape, focus containment and an inert background. */
export function WorkflowDialog({ children, label, onClose, returnFocusSelector }: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose: () => void;
  readonly returnFocusSelector?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      const target = returnFocusSelector ? document.querySelector(returnFocusSelector) : previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [returnFocusSelector]);
  return <dialog aria-label={label} className={styles.nativeDialog} onCancel={(event) => { event.preventDefault(); onClose(); }} ref={ref}>{children}</dialog>;
}
