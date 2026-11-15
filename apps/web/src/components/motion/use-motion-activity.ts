"use client";

import { useEffect, useState, type RefObject } from "react";

/** Animation lifetime follows visibility; it never drives a React render per frame. */
export function useMotionActivity(
  host: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const [state, setState] = useState({ visible: false, reduced: false });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let alive = true;
    let intersects = !element.closest("[hidden]");
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (!alive) return;
      const visible = enabled && intersects && !document.hidden;
      setState((previous) =>
        previous.visible === visible && previous.reduced === media.matches
          ? previous
          : { visible, reduced: media.matches },
      );
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            intersects = entries.some((entry) => entry.isIntersecting);
            update();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    update();
    return () => {
      alive = false;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
    };
  }, [enabled, host]);
  return state;
}
