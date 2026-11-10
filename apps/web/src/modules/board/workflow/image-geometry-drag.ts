import type { PointerEvent as ReactPointerEvent } from "react";

/** Own exactly one pointer and release every listener on commit, cancel or teardown. */
export function startImageGeometryDrag(
  event: ReactPointerEvent<HTMLElement>,
  move: (event: PointerEvent) => void,
  rollback: () => void,
  finished: () => void,
): () => void {
  const element = event.currentTarget;
  const pointerId = event.pointerId;
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", moving);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancelPointer);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", visibility);
    element.removeEventListener("lostpointercapture", cancelPointer);
    if (element.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId);
    finished();
  };
  const cancel = () => {
    if (active) {
      cleanup();
      rollback();
    }
  };
  const moving = (next: PointerEvent) => {
    if (next.pointerId === pointerId) move(next);
  };
  const up = (next: PointerEvent) => {
    if (next.pointerId === pointerId) cleanup();
  };
  const cancelPointer = (next: PointerEvent) => {
    if (next.pointerId === pointerId) cancel();
  };
  const key = (next: KeyboardEvent) => {
    if (next.key !== "Escape") return;
    next.preventDefault();
    next.stopPropagation();
    cancel();
  };
  const visibility = () => {
    if (document.hidden) cancel();
  };
  event.preventDefault();
  event.stopPropagation();
  element.focus({ preventScroll: true });
  element.setPointerCapture(pointerId);
  window.addEventListener("pointermove", moving);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancelPointer);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", visibility);
  element.addEventListener("lostpointercapture", cancelPointer);
  return cleanup;
}
