"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./workflow-canvas.module.css";

/** Native modality supplies an inert background; explicit tab wrapping keeps focus inside. */
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
    dialog?.querySelector<HTMLElement>('[autofocus],input:not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();
    return () => {
      dialog?.close();
      const target = returnFocusSelector ? document.querySelector(returnFocusSelector) : previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [returnFocusSelector]);
  return <dialog aria-label={label} className={styles.nativeDialog} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDownCapture={(event) => {
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.getClientRects().length > 0);
    const first = targets[0];
    const last = targets.at(-1);
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }} ref={ref}>{children}</dialog>;
}
