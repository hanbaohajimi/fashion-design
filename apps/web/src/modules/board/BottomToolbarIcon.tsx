import type { ReactNode } from "react";

export type BottomToolbarIconName = "select" | "sketch" | "upload" | "note" | "swatches" | "fabric" | "objects" | "modules" | "more";

const artwork: Record<BottomToolbarIconName, ReactNode> = {
  select: <><path d="m5 3 14 9-7 1.5L9 20Z" fill="currentColor" fillOpacity=".1" /><path d="m12 13.5 4 6" /></>,
  sketch: <><path d="m5 15 10.8-10.8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L9 19l-5 1Z" /><path d="m14 6 4 4M5 15l4 4M13 21h7" /></>,
  upload: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><circle cx="8" cy="9" r="1.3" fill="currentColor" stroke="none" /><path d="m3 17 5-5 4 4 3-3 6 6M18 3v6m-3-3h6" /></>,
  note: <><path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M15 21v-4a2 2 0 0 1 2-2h4M7 8h10M7 12h6" /></>,
  swatches: <><rect x="3" y="5" width="5" height="14" rx="1.2" fill="var(--color-action)" /><rect x="9.5" y="5" width="5" height="14" rx="1.2" fill="var(--swatch-linen)" /><rect x="16" y="5" width="5" height="14" rx="1.2" fill="var(--swatch-indigo)" /></>,
  fabric: <><path d="M7 4h11a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6ZM4 7v10a3 3 0 0 0 3 3h11V10M7 7h11" /><path d="M8 13h6M8 16h4" /></>,
  objects: <><path d="M7 3h12a2 2 0 0 1 2 2v12" /><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M7 11h6M7 15h4" /></>,
  modules: <><rect x="3" y="3" width="6.5" height="6.5" rx="1.6" /><path d="m17.5 2 4.5 4.5-4.5 4.5L13 6.5Z" fill="currentColor" fillOpacity=".12" /><rect x="3" y="14.5" width="6.5" height="6.5" rx="1.6" /><rect x="14.5" y="14.5" width="6.5" height="6.5" rx="1.6" /></>,
  more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
};

/** A single optical scale for the canvas dock; tool semantics stay distinct. */
export function BottomToolbarIcon({ name }: { name: BottomToolbarIconName }) {
  return <svg data-bottom-toolbar-icon={name} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{artwork[name]}</svg>;
}
