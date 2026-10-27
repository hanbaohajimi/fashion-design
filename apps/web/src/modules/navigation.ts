import { flushWorkspaceDrafts } from "../components/drafts/draft-repository";

type SaveBeforeLeave = () => Promise<void>;
type NavigationState = {
  saveBeforeLeave: SaveBeforeLeave | null;
  beforeTraversal: ((event: PopStateEvent) => void) | null;
  lastPosition: number;
};
// Layout and route chunks, including hot replacements, share one window-owned registry.
const state = () => {
  const host = globalThis as unknown as Record<symbol, NavigationState | undefined>;
  return host[Symbol.for("fashion.workspace.navigation")] ??= { saveBeforeLeave: null, beforeTraversal: null, lastPosition: 0 };
};
export const HISTORY_POSITION = "fashion:history-position";
export const navigationPosition = () => state().lastPosition;

export function registerTraversalGuard(guard: (event: PopStateEvent) => void): () => void {
  state().beforeTraversal = guard;
  return () => { if (state().beforeTraversal === guard) state().beforeTraversal = null; };
}

export function registerNavigationGuard(save: SaveBeforeLeave): () => void {
  state().saveBeforeLeave = save;
  return () => { if (state().saveBeforeLeave === save) state().saveBeforeLeave = null; };
}

export async function navigateAfterSave(navigate: () => void): Promise<boolean> {
  try {
    await Promise.all([state().saveBeforeLeave?.(), flushWorkspaceDrafts()]);
    navigate();
    return true;
  } catch {
    return false;
  }
}

/** Track entries without changing Next's own state, so a blocked traversal can be restored. */
export function installNavigationHistory(): () => void {
  const push = history.pushState;
  const replace = history.replaceState;
  const position = () => Number(history.state?.[HISTORY_POSITION] ?? 0);
  state().lastPosition = position();
  replace.call(history, { ...history.state, [HISTORY_POSITION]: position() }, "");
  const trackedPush: History["pushState"] = (entry, unused, url) => {
    state().lastPosition = position() + 1;
    push.call(history, { ...entry, [HISTORY_POSITION]: state().lastPosition }, unused, url);
  };
  const trackedReplace: History["replaceState"] = (entry, unused, url) => {
    state().lastPosition = position();
    replace.call(history, { ...entry, [HISTORY_POSITION]: state().lastPosition }, unused, url);
  };
  history.pushState = trackedPush;
  history.replaceState = trackedReplace;
  const recordTraversal = (event: PopStateEvent) => {
    state().beforeTraversal?.(event);
    if (!event.cancelBubble) state().lastPosition = Number(event.state?.[HISTORY_POSITION] ?? 0);
  };
  type NavigationHost = EventTarget & { traverseTo: (key: string) => { finished: Promise<unknown> } };
  const navigation = (window as unknown as { navigation?: NavigationHost }).navigation;
  let active = true;
  let replay = false;
  let flight = false;
  const beforeNativeTraversal = (event: Event) => {
    const navigationEvent = event as Event & { navigationType?: string; canIntercept?: boolean; destination?: { key: string; sameDocument: boolean } };
    if (navigationEvent.navigationType !== "traverse" || !event.cancelable || !navigationEvent.canIntercept || !navigationEvent.destination?.sameDocument) return;
    if (replay) { replay = false; return; }
    const save = state().saveBeforeLeave;
    if (!save || !state().beforeTraversal) return;
    event.preventDefault();
    if (flight) return;
    flight = true;
    const key = navigationEvent.destination.key;
    void Promise.all([save(), flushWorkspaceDrafts()]).then(async () => {
      if (!active) return;
      replay = true;
      await navigation?.traverseTo(key).finished;
    }).catch(() => undefined).finally(() => { flight = false; replay = false; });
  };
  navigation?.addEventListener("navigate", beforeNativeTraversal);
  window.addEventListener("popstate", recordTraversal, true);
  return () => {
    if (history.pushState === trackedPush) history.pushState = push;
    if (history.replaceState === trackedReplace) history.replaceState = replace;
    active = false;
    navigation?.removeEventListener("navigate", beforeNativeTraversal);
    window.removeEventListener("popstate", recordTraversal, true);
  };
}
