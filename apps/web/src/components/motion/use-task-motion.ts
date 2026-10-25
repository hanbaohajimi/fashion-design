"use client";

import { useEffect, useRef, type RefObject } from "react";
import { claimTaskMotion } from "./events";
import { useCoutureMotion } from "./use-couture-motion";

export function useTaskMotion(
  key: string,
  status: string,
  anchor: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const previous = useRef({ key, status });
  const play = useCoutureMotion();
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      const changed =
        previous.current.key === key && previous.current.status !== status;
      const receipt = claimTaskMotion(key, status, changed);
      if (receipt)
        play(receipt.effect, {
          anchor: anchor.current,
          eventKey: receipt.eventKey,
        });
      previous.current = { key, status };
    });
    return () => cancelAnimationFrame(frame);
  }, [key, status, anchor, enabled, play]);
}
