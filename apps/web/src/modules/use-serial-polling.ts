"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One request per lane; hidden pages pause, failures back off, and old responses are aborted. */
export function useSerialPolling(key: string, enabled: boolean, intervalMs: number, task: (signal: AbortSignal) => Promise<void>) {
  const handler = useRef(task);
  useLayoutEffect(() => { handler.current = task; }, [task]);
  const [state, setState] = useState<{ error: string | null; lastSuccess: number | null }>({ error: null, lastSuccess: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let failures = 0;
    let flight = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!disposed && !document.hidden) timer = setTimeout(() => { void run(); }, delay);
    };
    const run = async () => {
      if (disposed || document.hidden || flight) return;
      flight = true;
      controller = new AbortController();
      const signal = controller.signal;
      try {
        await handler.current(signal);
        if (!disposed && !signal.aborted) { failures = 0; setState({ error: null, lastSuccess: Date.now() }); }
      } catch (error) {
        if (!disposed && !signal.aborted) {
          failures += 1;
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : "同步失败" }));
        }
      } finally {
        flight = false;
        schedule(signal.aborted ? 0 : Math.min(30_000, intervalMs * 2 ** Math.min(failures, 5)));
      }
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else if (!flight) void run();
    };
    document.addEventListener("visibilitychange", visibility);
    schedule(0);
    return () => { disposed = true; if (timer) clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [key, enabled, intervalMs, retry]);
  return { ...state, retry: () => setRetry((value) => value + 1) };
}
