"use client";

import { useEffect, useRef, type RefObject } from "react";
import { motionAllowed } from "./runtime";
import { useCoutureMotion } from "./use-couture-motion";

export function useArchiveOpening(
  root: RefObject<HTMLElement | null>,
  ready: boolean,
  animateCards = true,
) {
  const opened = useRef(false);
  const play = useCoutureMotion();
  useEffect(() => {
    if (!ready || opened.current) return;
    const animations: Animation[] = [];
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const stop = () => animations.forEach((animation) => animation.cancel());
    const frame = requestAnimationFrame(() => {
      if (!root.current || opened.current) return;
      opened.current = true;
      if (!motionAllowed()) return;
      const tokens = getComputedStyle(document.documentElement);
      const time = (key: string) =>
        Number.parseFloat(tokens.getPropertyValue(key));
      play("archive", {
        anchor: root.current.querySelector("h1"),
        eventKey: `archive:${crypto.randomUUID()}`,
      });
      if (!animateCards) return;
      const cards = [
        ...root.current.querySelectorAll<HTMLElement>("[data-project-card]"),
      ]
        .filter((card) => {
          const bounds = card.getBoundingClientRect();
          return bounds.top < innerHeight && bounds.bottom > 0;
        })
        .slice(0, 9);
      cards.forEach((card, index) => {
        const animation = card.animate?.(
          [
            { opacity: 0, transform: "translateY(12px) rotate(-0.5deg)" },
            { opacity: 1, transform: "translateY(0) rotate(0)" },
          ],
          {
            duration: time("--motion-card"),
            delay: index * time("--motion-stagger"),
            easing: tokens.getPropertyValue("--ease-enter").trim(),
            fill: "backwards",
          },
        );
        if (animation) animations.push(animation);
      });
    });
    document.addEventListener("visibilitychange", stop);
    preference?.addEventListener("change", stop);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      document.removeEventListener("visibilitychange", stop);
      preference?.removeEventListener("change", stop);
    };
  }, [ready, root, play, animateCards]);
}
