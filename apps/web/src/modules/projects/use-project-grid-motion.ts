"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Project } from "./project-types";

interface CardPosition { node: HTMLElement; rect: DOMRect; scroll: number }
export function useProjectGridMotion(projects: readonly Project[]) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(new Map<string, CardPosition>());
  const animations = useRef(new Set<Animation>());
  const ghosts = useRef(new Set<HTMLElement>());
  const first = useRef(true);
  const stop = () => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    ghosts.current.forEach((ghost) => ghost.remove());
    ghosts.current.clear();
  };
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    media?.addEventListener("change", stop);
    document.addEventListener("visibilitychange", stop);
    return () => { stop(); media?.removeEventListener("change", stop); document.removeEventListener("visibilitychange", stop); };
  }, []);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    stop();
    const elements = [...root.querySelectorAll<HTMLElement>(":scope > [data-project-card]")];
    // FLIP：先集中读取布局，随后仅用 transform 补位，不逐卡交错读写。
    const next = new Map<string, CardPosition>(elements.map((node) => [node.dataset.projectId ?? "", { node, rect: node.getBoundingClientRect(), scroll: window.scrollY }]));
    const allowed = !document.hidden && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const play = (node: HTMLElement, frames: Keyframe[], duration: number, delay = 0, done?: () => void) => {
      const animation = node.animate?.(frames, { duration, delay, easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" });
      if (!animation) { done?.(); return; }
      animations.current.add(animation);
      animation.onfinish = () => { animations.current.delete(animation); done?.(); };
    };
    if (allowed) {
      let entered = 0;
      for (const [id, current] of next) {
        const old = previous.current.get(id);
        const visible = current.rect.top < innerHeight && current.rect.bottom > 0;
        if (!visible) continue;
        if (old) {
          const x = old.rect.left - current.rect.left;
          const y = old.rect.top - (window.scrollY - old.scroll) - current.rect.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1) play(current.node, [{ transform: `translate(${x}px,${y}px)` }, { transform: "none" }], 280);
        } else if (entered < 6) {
          play(current.node, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], first.current ? 400 : 300, entered * (first.current ? 60 : 50));
          entered += 1;
        }
      }
      const bounds = root.getBoundingClientRect();
      let removed = 0;
      for (const [id, old] of previous.current) {
        const top = old.rect.top - (window.scrollY - old.scroll);
        if (next.has(id) || top > innerHeight || top + old.rect.height < 0 || removed >= 6) continue;
        const ghost = old.node.cloneNode(true) as HTMLElement;
        ghost.inert = true;
        ghost.setAttribute("aria-hidden", "true");
        ghost.removeAttribute("data-project-id");
        ghost.removeAttribute("data-project-card");
        ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        ghost.querySelectorAll("details").forEach((node) => node.removeAttribute("open"));
        Object.assign(ghost.style, { position: "absolute", left: `${old.rect.left - bounds.left}px`, top: `${top - bounds.top}px`, width: `${old.rect.width}px`, height: `${old.rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "1" });
        root.append(ghost);
        ghosts.current.add(ghost);
        play(ghost, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px) scale(.98)" }], 280, 0,
          () => { ghost.remove(); ghosts.current.delete(ghost); });
        removed += 1;
      }
    }
    previous.current = next;
    first.current = false;
  }, [projects]);
  return ref;
}
