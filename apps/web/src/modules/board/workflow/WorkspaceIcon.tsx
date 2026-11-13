import type { ReactNode } from "react";

type WorkspaceIconName = "image" | "annotate" | "comment" | "remove_background" | "erase" | "resize" | "inpaint" | "variation" | "download" | "share" | "close" | "chevron" | "orient" | "adjust" | "rotate_left" | "flip_horizontal" | "flip_vertical" | "reset" | "text_edit" | "history" | "results" | "new_chat" | "requirements" | "settings" | "review" | "skills" | "delegation";

const paths: Record<WorkspaceIconName, ReactNode> = {
  history: <><path d="M3 4v5h5M3 9a9 9 0 1 1 0 7" /><path d="M12 7v5l3 2" /></>,
  results: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5M8 17h3" /></>,
  new_chat: <><path d="M14 4H5a2 2 0 0 0-2 2v15l5-4h11a2 2 0 0 0 2-2v-4M18 2v6m-3-3h6" /></>,
  requirements: <><path d="M9 5h11M9 12h11M9 19h11M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3" /></>,
  settings: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  review: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>,
  skills: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="4" /><path d="m5.6 5.6 2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8" /></>,
  delegation: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2M4 4l-1.5 1.5M20 4l1.5 1.5" /></>,
  text_edit: <><path d="M4 5V3h16v2M12 3v18M8 21h8" /></>,
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
  orient: <><path d="M20 3v6h-6M20 9a8 8 0 1 0 0 6" /><path d="m5 8 4-4" /></>,
  adjust: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  rotate_left: <><path d="M4 3v6h6M4 9a8 8 0 1 1 0 6" /><path d="m19 8-4-4" /></>,
  flip_horizontal: <><path d="M12 3v3m0 3v3m0 3v3m0 3v0M3 6v12l6-6ZM21 6v12l-6-6Z" /></>,
  flip_vertical: <><path d="M3 12h3m3 0h3m3 0h3m3 0h0M6 3h12l-6 6ZM6 21h12l-6-6Z" /></>,
  reset: <path d="M4 4v6h6M4 10a8 8 0 1 1 0 5" />,
};

/** One stroke system for image controls; artwork and annotations retain their colors. */
export function WorkspaceIcon({ name }: { readonly name: WorkspaceIconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
