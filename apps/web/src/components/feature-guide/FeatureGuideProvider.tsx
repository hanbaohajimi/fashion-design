"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "../../modules/auth/AuthProvider";
import { FeatureGuideOverlay } from "./FeatureGuideOverlay";
import { guideLayoutSignature, guidePageRoot, hasGuideBlocker, isGuideInputFocused, resolveGuideSteps } from "./guide-dom";
import { GuidePreferences, guideSurfaceForPath, type GuideSurface, type ResolvedGuideStep } from "./guide-model";

interface GuideRun {
  readonly id: number;
  readonly accountId: string;
  readonly routeKey: string;
  readonly surface: GuideSurface;
  readonly steps: readonly ResolvedGuideStep[];
  readonly index: number;
  readonly paused: boolean;
  readonly closing: boolean;
}

interface GuideContextValue {
  readonly available: boolean;
  readonly startGuide: () => void;
}

const GuideContext = createContext<GuideContextValue>({ available: false, startGuide: () => {} });
export const useFeatureGuide = () => useContext(GuideContext);

interface GuideActions {
  readonly start: () => void;
  readonly move: (direction: number) => void;
  readonly finish: (completed: boolean) => void;
  readonly afterClose: (id: number) => void;
}

/** Route-dependent guide hydration never suspends the page it introduces. */
export function FeatureGuideProvider({ children }: { readonly children: ReactNode }) {
  const controllerRef = useRef<GuideActions | null>(null);
  const [available, setAvailable] = useState(false);
  const startGuide = useCallback(() => controllerRef.current?.start(), []);
  const value = useMemo(() => ({ available, startGuide }), [available, startGuide]);
  return <GuideContext value={value}>
    {children}
    <Suspense fallback={null}><FeatureGuideController controllerRef={controllerRef} onAvailable={setAvailable} /></Suspense>
  </GuideContext>;
}

/** One owner for automatic presentation, route lifetime and local preferences. */
function FeatureGuideController({ controllerRef, onAvailable }: {
  readonly controllerRef: { current: GuideActions | null };
  readonly onAvailable: (available: boolean) => void;
}) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = `${pathname}?${search.toString()}`;
  const surface = guideSurfaceForPath(pathname);
  const accountId = session?.user.id ?? null;
  const preferences = useRef(new GuidePreferences());
  const runSequence = useRef(0);
  const [run, setRun] = useState<GuideRun | null>(null);

  useEffect(() => { onAvailable(Boolean(accountId && surface && !loading)); }, [accountId, surface, loading, onAvailable]);

  useEffect(() => {
    if (loading || !accountId || !surface) return;
    let alive = true;
    let active: GuideRun | null = null;
    let manual = false;
    let pressed = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let signature = "";
    let stableSince = 0;
    const localPreferences = preferences.current;
    const publish = (next: GuideRun | null) => {
      active = next;
      if (alive) setRun(next);
    };
    const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
    const resetStability = () => { clearTimer(); signature = ""; stableSince = 0; };
    const inspect = () => {
      frame = 0;
      if (!alive) return;
      const ready = Boolean(guidePageRoot(surface));
      const blocked = document.hidden || hasGuideBlocker();
      if (active) {
        if (active.closing) return;
        if (!ready || blocked) {
          if (!active.paused) publish({ ...active, paused: true });
          return;
        }
        const steps = resolveGuideSteps(surface);
        if (!steps.length) { publish(null); return; }
        const previousId = active.steps[active.index]?.id;
        const sameStep = steps.findIndex(step => step.id === previousId);
        const index = sameStep >= 0 ? sameStep : Math.min(active.index, steps.length - 1);
        const changed = active.paused || index !== active.index || steps.length !== active.steps.length || steps.some((step, i) => step.target !== active?.steps[i]?.target || step.title !== active.steps[i]?.title || step.description !== active.steps[i]?.description);
        if (changed) publish({ ...active, steps, index, paused: false });
        return;
      }
      if (!manual && localPreferences.read(accountId, surface)) { resetStability(); return; }
      if (!ready || blocked || pressed || (!manual && isGuideInputFocused())) { resetStability(); return; }
      const steps = resolveGuideSteps(surface);
      if (!steps.length) { resetStability(); return; }
      const nextSignature = guideLayoutSignature(steps);
      const now = performance.now();
      if (signature !== nextSignature) { signature = nextSignature; stableSince = now; clearTimer(); }
      const remaining = 600 - (now - stableSince);
      if (remaining > 0) {
        if (timer === null) timer = setTimeout(() => { timer = null; schedule(); }, remaining + 1);
        return;
      }
      manual = false;
      resetStability();
      // A refresh or interrupted first look must not restart the automatic introduction.
      localPreferences.write(accountId, surface, "viewed");
      publish({ id: ++runSequence.current, accountId, routeKey, surface, steps, index: 0, paused: false, closing: false });
    };
    const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(inspect); };
    const finish = (completed: boolean) => {
      if (!active || active.paused || active.closing) return;
      localPreferences.write(accountId, surface, completed ? "completed" : "skipped");
      manual = false;
      resetStability();
      publish({ ...active, closing: true });
    };
    controllerRef.current = {
      start: () => { manual = true; resetStability(); if (!active?.closing) publish(null); schedule(); },
      move: direction => {
        if (!active || active.paused || active.closing) return;
        const index = active.index + direction;
        if (index >= active.steps.length) finish(true);
        else if (index >= 0) publish({ ...active, index });
      },
      finish,
      afterClose: id => {
        if (!active?.closing || active.id !== id) return;
        publish(null);
        schedule();
      },
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest("[data-feature-guide]")))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "inert", "hidden", "aria-hidden", "aria-modal", "aria-disabled", "disabled", "data-guide", "data-guide-page", "data-guide-ready", "data-guide-title", "data-guide-variant", "data-guide-switcher", "data-guide-revision", "class", "style"] });
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-feature-guide]")) return;
      pressed = true;
      resetStability();
    };
    const pointerEnd = () => { pressed = false; resetStability(); schedule(); };
    const activity = () => { if (!active) resetStability(); schedule(); };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerup", pointerEnd, true);
    document.addEventListener("pointercancel", pointerEnd, true);
    document.addEventListener("focusin", activity);
    document.addEventListener("focusout", activity);
    document.addEventListener("input", activity, true);
    document.addEventListener("compositionstart", activity, true);
    document.addEventListener("compositionend", activity, true);
    document.addEventListener("visibilitychange", activity);
    window.addEventListener("blur", pointerEnd);
    window.addEventListener("resize", activity);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", activity);
    const onStorage = () => { if (!active) schedule(); };
    window.addEventListener("storage", onStorage);
    schedule();
    return () => {
      alive = false;
      controllerRef.current = null;
      setRun(null);
      clearTimer();
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointerup", pointerEnd, true);
      document.removeEventListener("pointercancel", pointerEnd, true);
      document.removeEventListener("focusin", activity);
      document.removeEventListener("focusout", activity);
      document.removeEventListener("input", activity, true);
      document.removeEventListener("compositionstart", activity, true);
      document.removeEventListener("compositionend", activity, true);
      document.removeEventListener("visibilitychange", activity);
      window.removeEventListener("blur", pointerEnd);
      window.removeEventListener("resize", activity);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", activity);
      window.removeEventListener("storage", onStorage);
    };
  }, [accountId, loading, routeKey, surface, controllerRef]);

  const move = useCallback((direction: number) => controllerRef.current?.move(direction), [controllerRef]);
  const dismiss = useCallback(() => controllerRef.current?.finish(false), [controllerRef]);
  const current = run?.accountId === accountId && run.routeKey === routeKey && !loading ? run : null;
  return current ? <FeatureGuideOverlay key={current.id} step={current.steps[current.index]} index={current.index} total={current.steps.length} paused={current.paused} closing={current.closing} onMove={move} onDismiss={dismiss} onAfterClose={() => controllerRef.current?.afterClose(current.id)} /> : null;
}
