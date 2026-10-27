"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STUDIO_LAYOUT } from "./ui-config";

type Anchor = { id: string; offset: number };
const positions = new Map<string, { follow: boolean; anchor: Anchor | null }>();

/** The only owner of conversation scrolling, including streamed layout changes. */
export function useConversationViewport(conversationId: string) {
  const conversationView = useRef<HTMLDivElement>(null);
  const composerSurface = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const readingAnchor = useRef<Anchor | null>(null);
  const followedConversation = useRef("");
  const frame = useRef(0);
  const scrollIntentUntil = useRef(0);
  const scrollWrite = useRef(false);
  const readingPointer = useRef(false);
  const [newMessages, setNewMessages] = useState(false);
  const stopScroll = useCallback(() => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  const capture = useCallback(() => {
    const view = conversationView.current;
    if (!view) return;
    const top = view.getBoundingClientRect().top;
    const item = Array.from(view.querySelectorAll<HTMLElement>("[data-message-id]")).find(node => node.getBoundingClientRect().bottom > top);
    readingAnchor.current = item?.dataset.messageId ? { id: item.dataset.messageId, offset: item.getBoundingClientRect().top - top } : null;
  }, []);
  const scrollToLatest = useCallback((view: HTMLElement, instant = false) => {
    stopScroll();
    const start = view.scrollTop;
    const at = performance.now();
    const step = (now: number) => {
      const progress = instant || matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : Math.min(1, (now - at) / 180);
      view.scrollTop = start + (view.scrollHeight - view.clientHeight - start) * (1 - (1 - progress) ** 3);
      frame.current = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    frame.current = requestAnimationFrame(step);
  }, [stopScroll]);
  useEffect(() => {
    const saved = positions.get(conversationId);
    followMessages.current = saved?.follow ?? true;
    readingAnchor.current = saved?.anchor ?? null;
    const view = conversationView.current;
    if (!view) return;
    let alive = true;
    const reconcile = () => {
      stopScroll();
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (!alive) return;
        scrollWrite.current = true;
        requestAnimationFrame(() => { scrollWrite.current = false; });
        if (followMessages.current) view.scrollTop = view.scrollHeight;
        else {
          const anchor = readingAnchor.current;
          const node = anchor && Array.from(view.querySelectorAll<HTMLElement>("[data-message-id]")).find(item => item.dataset.messageId === anchor.id);
          if (node && anchor) view.scrollTop += node.getBoundingClientRect().top - view.getBoundingClientRect().top - anchor.offset;
          setNewMessages(Boolean(view.querySelector("[data-message-id]")) && view.scrollHeight - view.scrollTop - view.clientHeight > STUDIO_LAYOUT.followThreshold);
        }
      });
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reconcile);
    resize?.observe(view);
    if (composerSurface.current) resize?.observe(composerSurface.current);
    for (const child of view.children) resize?.observe(child);
    const mutation = new MutationObserver(records => {
      for (const record of records) for (const child of record.addedNodes) if (child instanceof Element) resize?.observe(child);
      reconcile();
    });
    mutation.observe(view, { childList: true });
    reconcile();
    return () => {
      positions.set(conversationId, { follow: followMessages.current, anchor: readingAnchor.current });
      const oldest = positions.keys().next().value;
      if (positions.size > 100 && oldest) positions.delete(oldest);
      alive = false; stopScroll(); resize?.disconnect(); mutation.disconnect();
    };
  }, [conversationId, stopScroll]);
  const interrupt = () => { scrollIntentUntil.current = performance.now() + 1200; stopScroll(); capture(); };
  return {
    conversationView, composerSurface, followMessages, readingAnchor, followedConversation,
    newMessages, setNewMessages, stopScroll, scrollToLatest,
    viewportProps: {
      onWheel: (event: React.WheelEvent) => { interrupt(); if (event.deltaY < 0) followMessages.current = false; },
      onPointerDown: (event: React.PointerEvent) => {
        if ((event.target as Element).closest("button,a,input,textarea,summary,select")) return;
        readingPointer.current = true; interrupt(); scrollIntentUntil.current = performance.now() + 60000;
      },
      onPointerUp: () => { if (readingPointer.current) scrollIntentUntil.current = performance.now() + 1200; readingPointer.current = false; },
      onPointerCancel: () => { scrollIntentUntil.current = 0; },
      onKeyDown: (event: React.KeyboardEvent) => { if (!["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "].includes(event.key)) return; interrupt(); if (["PageUp", "ArrowUp", "Home"].includes(event.key)) followMessages.current = false; },
      onScroll: () => {
        if (frame.current || scrollWrite.current || performance.now() > scrollIntentUntil.current) return;
        const view = conversationView.current;
        if (!view) return;
        scrollIntentUntil.current = performance.now() + 1200;
        followMessages.current = view.scrollHeight - view.scrollTop - view.clientHeight <= STUDIO_LAYOUT.followThreshold;
        if (followMessages.current) { setNewMessages(false); readingAnchor.current = null; } else capture();
      },
    },
  };
}
