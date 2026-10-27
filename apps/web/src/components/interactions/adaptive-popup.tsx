"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MotionDialog } from "./motion-dialog";
import { afterSurfaceMotion, placeFloatingPanel } from "./floating-position";
import { useMenuMotion } from "./use-menu-motion";
import styles from "../choice-controls.module.css";

export interface PopupSession {
  readonly sheet: boolean;
  readonly phone: boolean;
  readonly container: Element;
}

/** Decide once per opening, before a search keyboard changes the visible viewport. */
export function popupSession(
  anchor: HTMLElement,
  height: number,
): PopupSession {
  const bounds = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const phone =
    window.matchMedia?.("(max-width: 767px)").matches ??
    window.innerWidth < 768;
  return {
    phone,
    sheet:
      phone &&
      (bounds.top + bounds.height / 2 >= (top + bottom) / 2 ||
        bottom - bounds.bottom - 8 < Math.min(height, 264)),
    container: anchor.closest("dialog[open]") ?? document.body,
  };
}

export function AdaptivePopup({
  open,
  session,
  anchor,
  label,
  children,
  onClose,
  id,
  align = "start",
  className = "",
}: {
  readonly open: boolean;
  readonly session: PopupSession | null;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly children: ReactNode;
  readonly onClose: (restoreFocus?: boolean) => void;
  readonly id: string;
  readonly align?: "start" | "end";
  readonly className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const sheet = session?.sheet ?? false;
  useLayoutEffect(() => {
    if (!open || !session) return;
    const position = () => {
      const popup = panel.current;
      const trigger = anchor.current;
      if (!popup || !trigger) return;
      const viewport = window.visualViewport;
      const edgeTop = (viewport?.offsetTop ?? 0) + 8;
      const edgeLeft = (viewport?.offsetLeft ?? 0) + 8;
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      popup.style.setProperty(
        "--popup-available-height",
        `${Math.max(0, height - (sheet ? 112 : 16))}px`,
      );
      if (sheet) {
        popup
          .closest("dialog")
          ?.style.setProperty("max-height", `${Math.max(0, height - 16)}px`);
        return;
      }
      const bounds = trigger.getBoundingClientRect();
      if (session.phone)
        popup.style.maxHeight = `${Math.max(0, Math.min(264, edgeTop + height - 16 - bounds.bottom - 8))}px`;
      popup.style.minWidth = `${Math.min(Math.max(bounds.width, 176), width - 16)}px`;
      const size = popup.getBoundingClientRect();
      const below = edgeTop + height - 16 - bounds.bottom - 8;
      const above = bounds.top - 8 - edgeTop;
      const isAbove = !session.phone && below < size.height && above > below;
      const top = isAbove ? bounds.top - size.height - 8 : bounds.bottom + 8;
      const left = align === "end" ? bounds.right - size.width : bounds.left;
      placeFloatingPanel(
        popup,
        Math.max(edgeLeft, Math.min(left, edgeLeft + width - 16 - size.width)),
        Math.max(edgeTop, Math.min(top, edgeTop + height - 16 - size.height)),
      );
      popup.dataset.actualPlacement = isAbove ? "top" : "bottom";
    };
    position();
    const stop = afterSurfaceMotion(panel.current, position);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(position);
    if (panel.current) observer?.observe(panel.current);
    const outside = (event: Event) => {
      if (
        !sheet &&
        !panel.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        onClose(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, session, anchor, align, onClose, sheet]);
  useMenuMotion(open && !sheet, panel, "bottom");

  if (!session) return null;
  const content = (
    <div
      id={id}
      ref={panel}
      style={sheet ? undefined : { position: "fixed" }}
      aria-label={`${label}选项`}
      className={`${styles.popup} ${sheet ? styles.sheetContent : ""} ${className}`}
      data-popup-kind={sheet ? "sheet" : "anchored"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      {children}
    </div>
  );
  if (sheet)
    return createPortal(
      <MotionDialog
        open={open}
        variant="sheet"
        label={label}
        className={styles.sheet}
        onClose={() => onClose(true)}
        onAfterClose={() => {
          const top = [...document.querySelectorAll("dialog[open]")].at(-1);
          if (
            anchor.current?.isConnected &&
            (!top || top.contains(anchor.current))
          )
            anchor.current.focus();
        }}
      >
        <div className={styles.sheetHeading}>
          <strong>{label}</strong>
          <button type="button" onClick={() => onClose(true)}>
            关闭
          </button>
        </div>
        {content}
      </MotionDialog>,
      session.container,
    );
  return open ? createPortal(content, session.container) : null;
}
