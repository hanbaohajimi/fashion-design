import { useCallback, useEffect, useRef, useState } from "react";
import type { WardrobeSummary } from "@fashion/shared";
import { userFacingError } from "../../../components/user-facing-error";
import { wardrobeApi } from "./wardrobe-api";

export function useWardrobeData(projectId: string) {
  const [data, setData] = useState<WardrobeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await wardrobeApi.summary(projectId, controller.signal);
      if (!controller.signal.aborted && mounted.current) { setData(value); setError(null); }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(userFacingError(cause));
    } finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
  }, [projectId]);
  useEffect(() => { mounted.current = true; void Promise.resolve().then(() => mounted.current ? refresh() : undefined); return () => { mounted.current = false; request.current?.abort(); }; }, [refresh]);
  const pending = data?.preparations.some(item => item.status === "queued" || item.status === "running") || data?.tryOns.some(item => item.status === "queued" || item.status === "running");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 4000);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [pending, refresh]);
  return { data, error, loading, refresh };
}
