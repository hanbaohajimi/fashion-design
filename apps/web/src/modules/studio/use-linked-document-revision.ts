import { useEffect, useRef } from "react";

/** Source links disclose and focus a saved revision without replacing the editable draft. */
export function useLinkedDocumentRevision(revisionId: string | undefined, ids: readonly string[]) {
  const target = useRef<HTMLElement>(null);
  const available = Boolean(revisionId && ids.includes(revisionId));
  useEffect(() => {
    if (!available) return;
    const frame = requestAnimationFrame(() => {
      target.current?.scrollIntoView({ block: "center" });
      target.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [available, revisionId]);
  return { target, available, missing: Boolean(revisionId && !available) };
}
