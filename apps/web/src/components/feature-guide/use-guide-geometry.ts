"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { guideVisibleRect, placeGuideCard, type GuideRect, type GuideViewport } from "./guide-layout";

interface GuideGeometry {
  readonly target: GuideRect;
  readonly card: GuideRect;
  readonly viewport: GuideViewport;
}

function viewportRect(element: HTMLElement | null): GuideViewport {
  const view = window.visualViewport;
  const style = element ? getComputedStyle(element) : null;
  const safe = (edge: string) => parseFloat(style?.getPropertyValue(`--guide-safe-${edge}`) ?? "") || 0;
  return {
    x: (view?.offsetLeft ?? 0) + safe("left"),
    y: (view?.offsetTop ?? 0) + safe("top"),
    width: (view?.width ?? window.innerWidth) - safe("left") - safe("right"),
    height: (view?.height ?? window.innerHeight) - safe("top") - safe("bottom"),
    mobile: window.matchMedia("(max-width: 767px)").matches,
  };
}

function targetRect(element: HTMLElement): GuideRect {
  const box = element.getBoundingClientRect();
  let left = box.left, right = box.right, top = box.top, bottom = box.bottom;
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === "contents") continue;
    const clip = parent.getBoundingClientRect();
    const scaleX = parent.offsetWidth ? clip.width / parent.offsetWidth : 1;
    const scaleY = parent.offsetHeight ? clip.height / parent.offsetHeight : 1;
    // Overflow clips to the client box, excluding borders and scrollbar gutters.
    const clipLeft = clip.left + parent.clientLeft * scaleX;
    const clipTop = clip.top + parent.clientTop * scaleY;
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
      left = Math.max(left, clipLeft);
      right = Math.min(right, clipLeft + parent.clientWidth * scaleX);
    }
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
      top = Math.max(top, clipTop);
      bottom = Math.min(bottom, clipTop + parent.clientHeight * scaleY);
    }
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Event-driven tracking: layout shifts never require an idle animation-frame loop. */
export function useGuideGeometry(target: HTMLElement | undefined, contentKey: string, active: boolean, cardRef: RefObject<HTMLDivElement | null>): GuideGeometry | null {
  const [snapshot, setSnapshot] = useState<{ element: HTMLElement; contentKey: string; geometry: GuideGeometry } | null>(null);
  useLayoutEffect(() => {
    if (!target || !active) return;
    let frame = 0;
    let alive = true;
    let observedCard: HTMLDivElement | null = null;
    const observer = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      if (!alive || !target.isConnected) return;
      if (cardRef.current && observedCard !== cardRef.current) {
        if (observedCard) observer.unobserve(observedCard);
        observedCard = cardRef.current;
        observer.observe(observedCard);
      }
      const viewport = viewportRect(cardRef.current);
      let raw = targetRect(target);
      if (raw.width < 2 || raw.height < 2 || raw.y >= viewport.y + viewport.height || raw.y + raw.height <= viewport.y) {
        target.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
        raw = targetRect(target);
      }
      const highlight = guideVisibleRect(raw, viewport);
      const size = cardRef.current?.getBoundingClientRect();
      const copy = cardRef.current?.querySelector<HTMLElement>("[data-guide-copy]");
      const naturalHeight = (size?.height || 208) + (copy ? Math.max(0, copy.scrollHeight - copy.clientHeight) : 0);
      const geometry = {
        target: highlight,
        card: placeGuideCard(highlight, { width: viewport.mobile ? viewport.width - 32 : Math.min(352, viewport.width - 32), height: naturalHeight }, viewport),
        viewport,
      };
      setSnapshot(previous => previous?.element === target && previous.contentKey === contentKey && JSON.stringify(previous.geometry) === JSON.stringify(geometry) ? previous : { element: target, contentKey, geometry });
    };
    const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(measure); };
    const viewport = viewportRect(cardRef.current);
    const box = targetRect(target);
    if (box.height < 2 || box.y < viewport.y + 12 || box.y + box.height > viewport.y + viewport.height - (viewport.mobile ? 228 : 16)) {
      target.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
    }
    // Ancestor resizing or a sibling's reflow can move a fixed-size target.
    for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) observer.observe(parent);
    const mutation = new MutationObserver(records => {
      if (records.some(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return !element?.closest("[data-feature-guide]");
      })) schedule();
    });
    mutation.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "inert"] });
    document.addEventListener("load", schedule, true);
    document.fonts?.addEventListener("loadingdone", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      document.removeEventListener("load", schedule, true);
      document.fonts?.removeEventListener("loadingdone", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [target, contentKey, active, cardRef]);
  return snapshot && snapshot.element === target && snapshot.contentKey === contentKey ? snapshot.geometry : null;
}
