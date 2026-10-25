import type { ReactNode } from "react";

type WorkspaceIconName = "image" | "annotate" | "comment" | "remove_background" | "erase" | "resize" | "inpaint" | "variation" | "download" | "share" | "close" | "chevron";

const paths: Record<WorkspaceIconName, ReactNode> = {
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  annotate: <><path d="m4 16-1 5 5-1L20 8a2.1 2.1 0 0 0-4-4Z" /><path d="m14 6 4 4M4 16l4 4" /></>,
  comment: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-6a8 8 0 1 1 18-5Z" /><path d="M8 10h8M8 14h5" /></>,
  remove_background: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m4 16 5-5 5 5 3-3 4 4M3 3l18 18M8 3l13 13M3 8l13 13" /></>,
  erase: <><path d="m4 14 9-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 9H9l-5-4a2 2 0 0 1 0-3Z" /><path d="m9 9 9 9M13 21h8" /></>,
  resize: <><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" /></>,
  inpaint: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" /><path d="m8 14 6-6 2 2-6 6H8Z" /></>,
  variation: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  share: <><path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
};

/** One stroke system for image controls; artwork and annotations retain their colors. */
export function WorkspaceIcon({ name }: { readonly name: WorkspaceIconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
