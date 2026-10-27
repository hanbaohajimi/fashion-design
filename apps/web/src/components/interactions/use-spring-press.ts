"use client";
import { useEffect, useRef } from "react";
import { animateSpring, SPRINGS } from "./spring";
import { observeMotionCancellation, reducedMotion } from "./motion-policy";

export function useSpringPress(enabled: boolean, disabled: boolean) {
  const visualRef = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const pressed = useRef(false);
  const reset = () => {
    animation.current?.cancel(); animation.current = null; pressed.current = false;
    if (visualRef.current) visualRef.current.style.transform = "";
  };
  useEffect(() => {
    if (!enabled || disabled) reset();
    const stop = observeMotionCancellation(reset);
    return () => { stop(); reset(); };
  }, [enabled, disabled]);
  return {
    visualRef,
    press: (event?: { button?: number }) => {
      if (!enabled || disabled || reducedMotion() || (event?.button ?? 0) !== 0) return;
      reset(); pressed.current = true;
      if (visualRef.current) visualRef.current.style.transform = "scale(.97)";
    },
    release: () => {
      if (!pressed.current || !visualRef.current) return;
      pressed.current = false;
      const element = visualRef.current;
      element.style.transform = "";
      animation.current = animateSpring(element, [.97], [1], ([scale]) => `scale(${scale})`, SPRINGS.button);
    },
    reset,
  };
}
