"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import { revealInvalidField } from "../../components/workspace-ui";
import styles from "./studio-edit-section.module.css";

/** Presentation state only: fields stay mounted and their owning form keeps the draft. */
export function StudioEditSection({
  title = "编辑资料",
  summary,
  children,
  defaultOpen = false,
  save = false,
  busy = false,
  error,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  persistent = false,
}: {
  readonly title?: string;
  readonly summary?: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly save?: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly hideTrigger?: boolean;
  readonly persistent?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const open = controlledOpen ?? expanded;
  const setOpen = (next: boolean) => {
    setExpanded(next);
    onOpenChange?.(next);
  };
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const userOpened = useRef(false);
  const id = useId();
  useEffect(() => {
    const element = panel.current;
    const form = element?.closest("form") ?? element?.querySelector("form");
    if (!element || !form) return;
    const revealOutsideError = (event: Event) => {
      if (
        element.matches(":modal") &&
        event.target instanceof Node &&
        !element.contains(event.target)
      ) {
        element.close();
        setExpanded(false);
        onOpenChange?.(false);
        // The owning form's invalid handler selects the chapter and focuses the field.
      }
    };
    form.addEventListener("invalid", revealOutsideError, true);
    return () => form.removeEventListener("invalid", revealOutsideError, true);
  }, [onOpenChange]);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 767px)")
        : null;
    const sync = () => {
      if (typeof element.close !== "function") {
        element.toggleAttribute("open", open);
        return;
      }
      element.close();
      if (
        open &&
        media?.matches &&
        (userOpened.current || controlledOpen !== undefined)
      )
        element.showModal();
      else element.toggleAttribute("open", open);
    };
    sync();
    media?.addEventListener("change", sync);
    return () => media?.removeEventListener("change", sync);
  }, [open, controlledOpen]);
  const close = () => {
    setOpen(false);
    trigger.current?.querySelector("button")?.focus({ preventScroll: true });
  };
  if (persistent)
    return (
      <section className={styles.persistent} data-studio-settings>
        <header>
          <h3>{title}</h3>
          {summary ? <p>{summary}</p> : null}
        </header>
        <div className={styles.fields}>{children}</div>
      </section>
    );
  return (
    <section
      className={styles.section}
      hidden={hideTrigger && !open}
      data-studio-edit-section
      onInvalidCapture={(event) => {
        userOpened.current = true;
        setOpen(true);
        revealInvalidField(event);
      }}
    >
      <div className={styles.summary} hidden={hideTrigger}>
        <div>{summary}</div>
        <div ref={trigger}>
          <Button
            aria-expanded={open}
            aria-controls={id}
            onClick={() => {
              userOpened.current = true;
              setOpen(!open);
            }}
          >
            {open ? "收起编辑" : title}
          </Button>
        </div>
      </div>
      <dialog
        ref={panel}
        id={id}
        aria-label={title}
        className={styles.panel}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <header className={styles.header}>
          <strong>{title}</strong>
          <Button onClick={close}>返回作品</Button>
        </header>
        <div className={styles.fields}>{children}</div>
        {error ? (
          <p role="status">保存未完成，请检查输入；返回作品查看详细原因。</p>
        ) : null}
        <footer className={styles.footer}>
          <span>收起后保留未保存的修改</span>
          {save ? (
            <Button type="submit" variant="primary" loading={busy}>
              保存修改
            </Button>
          ) : null}
        </footer>
      </dialog>
    </section>
  );
}
