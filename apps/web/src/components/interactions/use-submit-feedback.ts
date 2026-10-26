"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SubmitFeedbackSnapshot {
  phase: "idle" | "pending" | "success" | "error";
  actionKey: string | null;
  revision: number;
}
export interface SubmitFeedbackController {
  snapshot: SubmitFeedbackSnapshot;
  begin(actionKey: string): { succeed(): void; fail(): void };
  reset(): void;
}

/** Receipts are presentation only; callers own flight locks and real outcomes. */
export function useSubmitFeedback(): SubmitFeedbackController {
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapshot, setSnapshot] = useState<SubmitFeedbackSnapshot>({ phase: "idle", actionKey: null, revision: 0 });
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const reset = useCallback(() => {
    clear();
    const revision = ++attempt.current;
    setSnapshot({ phase: "idle", actionKey: null, revision });
  }, [clear]);
  const begin = useCallback((actionKey: string) => {
    clear();
    const revision = ++attempt.current;
    setSnapshot({ phase: "pending", actionKey, revision });
    const finish = (phase: "success" | "error") => {
      if (attempt.current !== revision) return;
      if (document.hidden) {
        setSnapshot({ phase: "idle", actionKey: null, revision });
        return;
      }
      setSnapshot({ phase, actionKey, revision });
      if (phase === "success") timer.current = setTimeout(() => {
        if (attempt.current === revision) setSnapshot({ phase: "idle", actionKey: null, revision });
        timer.current = null;
      }, 1000);
    };
    return { succeed: () => finish("success"), fail: () => finish("error") };
  }, [clear]);
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden) return;
      clear();
      setSnapshot(current => current.phase === "pending" ? current : { phase: "idle", actionKey: null, revision: current.revision });
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [clear]);
  useEffect(() => () => { ++attempt.current; clear(); }, [clear]);
  return useMemo(() => ({ snapshot, begin, reset }), [snapshot, begin, reset]);
}
