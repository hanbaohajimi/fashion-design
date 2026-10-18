"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { WorkflowLayoutSave, type LayoutBatch } from "./workflow-layout-save";

export function useWorkflowLayoutSave(save: (batch: LayoutBatch) => Promise<void>, onError: (error: unknown) => void) {
  const router = useRouter();
  const [queue] = useState(() => new WorkflowLayoutSave(async () => { throw new Error("保存服务尚未准备好"); }));
  useLayoutEffect(() => queue.setHandler(async (batch) => {
    try { await save(batch); }
    catch (error) { onError(error); throw error; }
  }), [queue, save, onError]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  useEffect(() => {
    const currentUrl = location.href;
    const currentHistoryState = history.state;
    let leaving = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (!queue.hasUnsaved() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault();
      event.stopPropagation();
      if (leaving) return;
      leaving = true;
      void queue.flush().then(() => router.push(url.pathname + url.search + url.hash)).catch(() => undefined).finally(() => { leaving = false; });
    };
    const popstate = (event: PopStateEvent) => {
      if (!queue.hasUnsaved()) return;
      const destination = location.href;
      event.stopImmediatePropagation();
      history.pushState(currentHistoryState, "", currentUrl);
      if (leaving) return;
      leaving = true;
      void queue.flush().then(() => router.replace(destination)).catch(() => undefined).finally(() => { leaving = false; });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", popstate, true);
    return () => {
      queue.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", popstate, true);
    };
  }, [queue, router]);

  return { queue, state };
}
