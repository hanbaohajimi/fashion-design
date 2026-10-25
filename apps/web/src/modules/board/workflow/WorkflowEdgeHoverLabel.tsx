import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "tldraw";
import styles from "./workflow-connections.module.css";

export function WorkflowEdgeHoverLabel({
  id, label, color, point, onDismiss,
}: {
  id: string;
  label: string;
  color: string;
  point: { x: number; y: number };
  onDismiss: () => void;
}) {
  const editor = useEditor();
  const ownerDocument = editor.getContainer().ownerDocument;
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!tip.current) return;
    const box = tip.current.getBoundingClientRect();
    const viewport = ownerDocument.documentElement;
    const x = Math.max(8, Math.min(point.x + 12, viewport.clientWidth - box.width - 8));
    const y = point.y >= box.height + 12 ? point.y - box.height - 12 : point.y + 12;
    tip.current.style.left = `${x}px`;
    tip.current.style.top = `${Math.max(8, Math.min(y, viewport.clientHeight - box.height - 8))}px`;
  }, [ownerDocument, point, label]);
  useEffect(() => {
    const view = ownerDocument.defaultView;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    const visibility = () => { if (ownerDocument.hidden) onDismiss(); };
    view?.addEventListener("blur", onDismiss);
    view?.addEventListener("resize", onDismiss);
    view?.addEventListener("scroll", onDismiss, true);
    view?.addEventListener("wheel", onDismiss, { passive: true });
    view?.addEventListener("pointercancel", onDismiss);
    ownerDocument.addEventListener("keydown", keydown, true);
    ownerDocument.addEventListener("visibilitychange", visibility);
    return () => {
      view?.removeEventListener("blur", onDismiss);
      view?.removeEventListener("resize", onDismiss);
      view?.removeEventListener("scroll", onDismiss, true);
      view?.removeEventListener("wheel", onDismiss);
      view?.removeEventListener("pointercancel", onDismiss);
      ownerDocument.removeEventListener("keydown", keydown, true);
      ownerDocument.removeEventListener("visibilitychange", visibility);
    };
  }, [ownerDocument, onDismiss]);
  // 放到画布变换之外，字号不随缩放变化，也不会被节点或画布边界裁切。
  return createPortal(
    <span id={id} ref={tip} role="tooltip" data-workflow-edge-label
      className={styles.edgeHoverLabel}
      style={{ "--edge-color": color } as CSSProperties}>
      {label}
    </span>,
    ownerDocument.body,
  );
}
