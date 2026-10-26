"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function restorePresentationItems<T extends { assetId: string }>(current: readonly T[], original: readonly T[], removed: readonly T[]): T[] {
  const next = [...current]; const missing = removed.filter((item) => !next.some((value) => value.assetId === item.assetId));
  if (next.length + missing.length > 12) return next;
  for (const item of original) {
    const entry = missing.find((value) => value.assetId === item.assetId); if (!entry) continue;
    const nextAnchor = original.slice(original.indexOf(item) + 1).find((value) => next.some((value2) => value2.assetId === value.assetId));
    const target = nextAnchor ? next.findIndex((value) => value.assetId === nextAnchor.assetId) : next.length;
    next.splice(target, 0, entry);
  }
  return next;
}

/** 只撤销当前展示草稿的移出操作，既有项的新修改永不被旧快照覆盖。 */
export function usePresentationUndo<T extends { assetId: string }>(items: readonly T[], onChange: (items: T[]) => void) {
  const [batch, setBatch] = useState<{ original: readonly T[]; removed: T[]; revision: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(4000);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingTime = useRef(4000);
  const interactionPaused = useRef(false);
  const hidden = useRef(false);
  const latest = useRef(items);
  useLayoutEffect(() => { latest.current = items; }, [items]);
  const stopClock = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; started.current = null;
  }, []);
  const pauseClock = useCallback(() => {
    if (started.current !== null) {
      remainingTime.current = Math.max(0, remainingTime.current - (performance.now() - started.current));
      setRemaining(remainingTime.current);
    }
    stopClock();
  }, [stopClock]);
  useEffect(() => {
    const visibility = () => {
      hidden.current = document.visibilityState === "hidden";
      if (hidden.current) pauseClock();
      setPaused(hidden.current || interactionPaused.current);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); stopClock(); };
  }, [pauseClock, stopClock]);
  const clear = () => {
    stopClock(); remainingTime.current = 4000; interactionPaused.current = false;
    setBatch(null); setRemaining(4000); setPaused(hidden.current);
  };
  useEffect(() => {
    if (!batch || paused || hidden.current || interactionPaused.current) return;
    started.current = performance.now();
    timer.current = setTimeout(() => { stopClock(); setBatch(null); }, remaining);
    return stopClock;
  }, [batch, paused, remaining, stopClock]);
  const remove = (id: string) => {
    const item = items.find((value) => value.assetId === id); if (!item) return;
    stopClock(); remainingTime.current = 4000;
    setBatch((current) => ({ original: current?.original ?? [...items], removed: [...(current?.removed.filter((value) => value.assetId !== id) ?? []), item], revision: (current?.revision ?? 0) + 1 }));
    setRemaining(4000); onChange(items.filter((value) => value.assetId !== id));
  };
  const pause = () => { interactionPaused.current = true; pauseClock(); setPaused(true); };
  const resume = () => { interactionPaused.current = false; setPaused(hidden.current); };
  const count = batch?.removed.filter((item) => !items.some((value) => value.assetId === item.assetId)).length ?? 0;
  const canRestore = items.length + count <= 12;
  const restore = () => { if (!batch || !canRestore) return; onChange(restorePresentationItems(latest.current, batch.original, batch.removed)); clear(); };
  return { count, revision: batch?.revision ?? 0, remaining, paused, canRestore, remove, restore, clear, pause, resume };
}
