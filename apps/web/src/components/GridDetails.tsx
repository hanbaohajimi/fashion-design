"use client";
import { Children, isValidElement, useEffect, useId, useRef, useState, type DetailsHTMLAttributes, type HTMLAttributes, type Ref } from "react";
import { reducedMotion, observeMotionCancellation } from "./interactions/motion-policy";
import { UI_TIMING } from "./ui-config";
import styles from "./grid-details.module.css";

/** Keep native disclosure and validation semantics while retaining mounted form drafts. */
export function GridDetails({ children, open, onOpenChange, onToggle, ref: forwardedRef, ...props }: DetailsHTMLAttributes<HTMLDetailsElement> & { onOpenChange?: (open: boolean) => void; ref?: Ref<HTMLDetailsElement> }) {
  const [expanded, setExpanded] = useState(Boolean(open));
  const [present, setPresent] = useState(Boolean(open));
  const [revealed, setRevealed] = useState(Boolean(open));
  const contentId = useId();
  const element = useRef<HTMLDetailsElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const parts = Children.toArray(children);
  const summary = parts.shift();
  const change = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (!next && element.current?.querySelector(".grid-content")?.contains(document.activeElement)) element.current.querySelector("summary")?.focus();
    if (next) {
      setPresent(true);
      if (reducedMotion() || present) setRevealed(true);
      else frame.current = requestAnimationFrame(() => { element.current?.getBoundingClientRect(); setRevealed(true); frame.current = null; });
    }
    else if (reducedMotion()) { setRevealed(false); setPresent(false); }
    else timer.current = setTimeout(() => setPresent(false), UI_TIMING.disclosure);
    if (!next) setRevealed(false);
    setExpanded(next); onOpenChange?.(next);
  };
  const lastOpen = useRef(open);
  useEffect(() => { if (open !== undefined && lastOpen.current !== open) change(open); lastOpen.current = open; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => observeMotionCancellation(() => {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setPresent(expanded); setRevealed(expanded);
  }), [expanded]);
  const summaryProps = isValidElement<HTMLAttributes<HTMLElement>>(summary) ? summary.props : {};
  const trigger = <summary {...summaryProps} aria-expanded={expanded} aria-controls={contentId} onClick={(event) => { summaryProps.onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); change(!expanded); } }} />;
  return <details {...props} ref={(node) => { element.current = node; if (typeof forwardedRef === "function") forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }} open={present} data-grid-expanded={expanded} onToggle={(event) => {
    // Form validation may open a native ancestor directly.
    if (event.currentTarget.open && !present) change(true);
    onToggle?.(event);
  }}>
    {trigger}
    <div id={contentId} className={styles.grid} data-expanded={revealed} aria-hidden={!expanded} inert={!expanded}>
      <div className={`${styles.clip} grid-content`}>{parts}</div>
    </div>
  </details>;
}
