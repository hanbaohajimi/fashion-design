"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { motionEase, motionTime, observeMotionCancellation } from "./motion-policy";

interface PresenceOptions {
  enter: Keyframe;
  exit?: Keyframe;
  enterToken: string;
  exitToken: string;
  enterMs: number;
  exitMs: number;
  onOpening?: () => void;
  onClosing?: () => void;
  onClosed?: () => void;
}

/** Keeps closing DOM alive without delaying the owner's state change. */
export function useAnimatedPresence<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>, options: PresenceOptions) {
  const current = useRef(options);
  useLayoutEffect(() => { current.current = options; });
  const animation = useRef<Animation | null>(null);
  const epoch = useRef(0);
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState(open ? "opening" : "closed");
  useLayoutEffect(() => {
    // Native top-layer DOM must be present before measuring its opening frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && !present) { setPresent(true); return; }
    if (!present || !ref.current) return;
    const element = ref.current;
    const config = current.current;
    const sequence = ++epoch.current;
    if (open) config.onOpening?.();
    else config.onClosing?.();
    const computed = animation.current || !open ? getComputedStyle(element) : null;
    const from = computed ? { opacity: computed.opacity, transform: computed.transform } :
      open ? config.enter : { opacity: 1, transform: "none" };
    animation.current?.cancel();
    setPhase(open ? "opening" : "closing");
    let settled = false;
    let stopObserving = () => {};
    const finish = () => {
      if (epoch.current !== sequence || settled) return;
      settled = true;
      stopObserving();
      animation.current?.cancel();
      animation.current = null;
      setPhase(open ? "open" : "closed");
      if (!open) { setPresent(false); current.current.onClosed?.(); }
    };
    const duration = motionTime(open ? config.enterToken : config.exitToken, open ? config.enterMs : config.exitMs);
    if (!duration || !element.animate || document.hidden) { finish(); return; }
    const target = open ? { opacity: 1, transform: "none" } : (config.exit ?? config.enter);
    const next = element.animate([from, target], { duration, easing: motionEase(!open), fill: "both" });
    animation.current = next;
    next.onfinish = finish;
    stopObserving = observeMotionCancellation(finish);
    return () => { epoch.current = sequence + 1; next.onfinish = null; stopObserving(); };
  }, [open, present, ref]);
  useLayoutEffect(() => () => { animation.current?.cancel(); }, []);
  return { present, phase };
}
