"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { WorkflowLayoutSave, type LayoutBatch } from "./workflow-layout-save";
import { HISTORY_POSITION, navigationPosition, registerNavigationGuard, registerTraversalGuard } from "../../navigation";

export function useWorkflowLayoutSave(save: (batch: LayoutBatch) => Promise<void>, onError: (error: unknown) => void, beforeLeave?: () => Promise<void>, hasUnsavedDetails?: () => boolean) {
  const router = useRouter();
  const [queue] = useState(() => new WorkflowLayoutSave(async () => { throw new Error("保存服务尚未准备好"); }));
  useLayoutEffect(() => queue.setHandler(async (batch) => {
    try { await save(batch); }
    catch (error) { onError(error); throw error; }
  }), [queue, save, onError]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const pendingCount = useSyncExternalStore(queue.subscribe, queue.getPendingCount, queue.getPendingCount);

  useEffect(() => {
    let leaving = false;
    let restoring = false;
    let permitted = false;
    let traversal = 0;
    const flushAndLeave = async () => { await queue.flush(); await beforeLeave?.(); };
    const unregister = registerNavigationGuard(flushAndLeave);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasUnsaved() && !hasUnsavedDetails?.()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if ((!queue.hasUnsaved() && !hasUnsavedDetails?.()) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault();
      event.stopPropagation();
      if (leaving) return;
      leaving = true;
      void flushAndLeave().then(() => router.push(url.pathname + url.search + url.hash)).catch(() => undefined).finally(() => { leaving = false; });
    };
    const popstate = (event: PopStateEvent) => {
      if (permitted) { permitted = false; return; }
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        void flushAndLeave().then(() => {
          permitted = true;
          history.go(-traversal);
        }).catch(() => { leaving = false; });
        return;
      }
      if (!queue.hasUnsaved()) return;
      event.stopImmediatePropagation();
      if (leaving) return;
      traversal = navigationPosition() - Number(event.state?.[HISTORY_POSITION] ?? 0);
      if (!traversal) return;
      leaving = true;
      restoring = true;
      history.go(traversal);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    const unregisterTraversal = registerTraversalGuard(popstate);
    return () => {
      queue.dispose();
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      unregisterTraversal();
    };
  }, [beforeLeave, hasUnsavedDetails, queue, router]);

  return { queue, state, pendingCount };
}
