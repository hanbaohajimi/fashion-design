import type { CSSProperties } from "react";

export type IconName =
  | "arrow"
  | "back"
  | "grid"
  | "image"
  | "file"
  | "check"
  | "plus"
  | "search"
  | "layers"
  | "chat"
  | "close"
  | "download"
  | "clock"
  | "chevron";

const paths: Record<IconName, string> = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  grid: "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z",
  image: "M4 4h16v16H4zm0 12 5-5 4 4 3-3 4 4M14 8h.01",
  file: "M5 3h9l5 5v13H5zm9 0v6h5M8 13h8m-8 4h6",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  search: "m16 16 4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  layers: "m3 8 9-5 9 5-9 5zm0 5 9 5 9-5M3 18l9 5 9-5",
  chat: "M4 4h16v13H9l-5 4zM8 9h8m-8 4h5",
  close: "m6 6 12 12M6 18 18 6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2",
  chevron: "m9 5 7 7-7 7",
};

export function PrototypeIcon({
  name,
  style,
}: {
  name: IconName;
  style?: CSSProperties;
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
