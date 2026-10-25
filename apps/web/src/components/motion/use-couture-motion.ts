"use client";

import { useCallback, useEffect, useRef } from "react";
import { play, type MotionHandle, type MotionOptions } from "./runtime";
import type { CoutureEffect } from "./presets";

export function useCoutureMotion() {
  const handles = useRef(new Set<MotionHandle>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const owned = handles.current;
    return () => {
      mounted.current = false;
      owned.forEach((handle) => handle.cancel());
      owned.clear();
    };
  }, []);
  return useCallback((effect: CoutureEffect, options: MotionOptions) => {
    if (!mounted.current) return;
    let running: MotionHandle | undefined;
    let resolve!: () => void;
    const finished = new Promise<void>((done) => {
      resolve = done;
    });
    // Success often closes a modal or replaces a pending control. Measure after React commits.
    const frame = requestAnimationFrame(() => {
      running = play(effect, options);
      void running.finished.then(resolve);
    });
    const handle: MotionHandle = {
      finished,
      cancel() {
        cancelAnimationFrame(frame);
        running?.cancel();
        resolve();
      },
    };
    handles.current.add(handle);
    void handle.finished.then(() => handles.current.delete(handle));
    return handle;
  }, []);
}
