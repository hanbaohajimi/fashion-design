type SaveBeforeLeave = () => Promise<void>;
let saveBeforeLeave: SaveBeforeLeave | null = null;
let beforeTraversal: ((event: PopStateEvent) => void) | null = null;
export const HISTORY_POSITION = "fashion:history-position";
let lastPosition = 0;
export const navigationPosition = () => lastPosition;

export function registerTraversalGuard(guard: (event: PopStateEvent) => void): () => void {
  beforeTraversal = guard;
  return () => { if (beforeTraversal === guard) beforeTraversal = null; };
}

export function registerNavigationGuard(save: SaveBeforeLeave): () => void {
  saveBeforeLeave = save;
  return () => { if (saveBeforeLeave === save) saveBeforeLeave = null; };
}

export async function navigateAfterSave(navigate: () => void): Promise<boolean> {
  try {
    await saveBeforeLeave?.();
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
  lastPosition = position();
  replace.call(history, { ...history.state, [HISTORY_POSITION]: position() }, "");
  const trackedPush: History["pushState"] = (state, unused, url) => {
    lastPosition = position() + 1;
    push.call(history, { ...state, [HISTORY_POSITION]: lastPosition }, unused, url);
  };
  const trackedReplace: History["replaceState"] = (state, unused, url) => {
    lastPosition = position();
    replace.call(history, { ...state, [HISTORY_POSITION]: lastPosition }, unused, url);
  };
  history.pushState = trackedPush;
  history.replaceState = trackedReplace;
  const recordTraversal = (event: PopStateEvent) => {
    beforeTraversal?.(event);
    if (!event.cancelBubble) lastPosition = Number(event.state?.[HISTORY_POSITION] ?? 0);
  };
  window.addEventListener("popstate", recordTraversal, true);
  return () => {
    if (history.pushState === trackedPush) history.pushState = push;
    if (history.replaceState === trackedReplace) history.replaceState = replace;
    window.removeEventListener("popstate", recordTraversal, true);
  };
}
