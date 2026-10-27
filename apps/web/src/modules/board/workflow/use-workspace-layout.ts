"use client";

import { useCallback, useEffect, useState } from "react";
import { STUDIO_LAYOUT } from "../../../components/ui-config";

export type WorkspaceMode = "mobile" | "overlay" | "docked";
export type MobileView = "canvas" | "nodes" | "assistant";
export interface WorkspaceLayout {
  mode: WorkspaceMode;
  mobileView: MobileView;
  sidebarOpen: boolean;
}

export function changeWorkspaceMode(
  current: WorkspaceLayout,
  mode: WorkspaceMode,
  initial = false,
): WorkspaceLayout {
  if (mode === current.mode && !initial) return current;
  if (initial) return { ...current, mode, sidebarOpen: mode === "docked" };
  if (mode === "mobile")
    return {
      ...current,
      mode,
      mobileView: current.sidebarOpen ? "assistant" : current.mobileView,
    };
  if (current.mode === "mobile")
    return {
      ...current,
      mode,
      sidebarOpen: current.mobileView === "assistant" || current.sidebarOpen,
    };
  return {
    ...current,
    mode,
    sidebarOpen: mode === "docked" ? current.sidebarOpen : false,
  };
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayout>({
    mode: "docked",
    mobileView: "canvas",
    sidebarOpen: true,
  });
  useEffect(() => {
    const mobile = matchMedia(`(max-width: ${STUDIO_LAYOUT.mobileMax}px)`);
    let surface = document.querySelector("main");
    const available = () => (surface?.isConnected ? surface : document.querySelector("main"))?.clientWidth ?? window.innerWidth;
    const mode = (): WorkspaceMode =>
      mobile.matches ? "mobile" : available() >= STUDIO_LAYOUT.canvasMin + STUDIO_LAYOUT.sidebarMin + 6 ? "docked" : "overlay";
    let initialized = false;
    let focusFrame = 0;
    const update = () => {
      const next = mode();
      const initial = !initialized;
      initialized = true;
      const focused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setLayout((current) => { const result = changeWorkspaceMode(current, next, initial); return initial && new URLSearchParams(window.location.search).has("conversationId") ? { ...result, sidebarOpen: true, mobileView: "assistant" } : result; });
      cancelAnimationFrame(focusFrame);
      if (!initial && focused?.closest("main"))
        focusFrame = requestAnimationFrame(() => {
          if (
            focused.isConnected &&
            !focused.checkVisibility({ checkVisibilityCSS: true })
          ) {
            const surface = focused.closest("main");
            const target =
              next === "mobile"
                ? surface?.querySelector<HTMLElement>(
                    '[aria-label="工作视图"] [aria-pressed="true"]',
                  )
                : surface?.querySelector<HTMLElement>(
                    '[aria-label="展开设计助手"]',
                  );
            target?.focus();
          }
        });
    };
    const frame = requestAnimationFrame(update);
    mobile.addEventListener("change", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (surface) observer?.observe(surface);
    const mutation = new MutationObserver(() => { const current = document.querySelector("main"); if (current !== surface) { observer?.disconnect(); surface = current; if (surface) observer?.observe(surface); update(); } });
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      mobile.removeEventListener("change", update);
      mutation.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  const setMobileView = useCallback(
    (mobileView: MobileView) =>
      setLayout((current) => ({ ...current, mobileView })),
    [],
  );
  const setSidebarOpen = useCallback(
    (sidebarOpen: boolean) =>
      setLayout((current) => ({ ...current, sidebarOpen })),
    [],
  );
  return {
    ...layout,
    sidebarOpen:
      layout.mode === "mobile"
        ? layout.mobileView === "assistant"
        : layout.sidebarOpen,
    setMobileView,
    setSidebarOpen,
  };
}
