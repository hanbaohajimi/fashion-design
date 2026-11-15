import type { ProjectDestination } from "./workspace-tools";

export function WorkspaceToolIcon({
  name,
  size = 24,
}: {
  name:
    | ProjectDestination
    | "home"
    | "projects"
    | "assets"
    | "discover"
    | "fabrics"
    | "plus"
    | "arrow";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "home" ? (
        <>
          <path d="m3 10 9-7 9 7v10H3Z" />
          <path d="M9 20v-7h6v7" />
        </>
      ) : name === "plus" ? (
        <path d="M12 4v16M4 12h16" />
      ) : name === "arrow" ? (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      ) : name === "projects" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : name === "assets" ? (
        <>
          <rect x="3" y="7" width="13" height="13" rx="2" />
          <path d="M8 7V4h13v12h-5" />
        </>
      ) : name === "discover" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m16 8-2 6-6 2 2-6Z" />
        </>
      ) : name === "fabrics" || name === "patterns" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </>
      ) : name === "experiments" ? (
        <>
          <path d="M8 3h8M10 3v7L4 20h16l-6-10V3M8 14h8" />
          <path d="M10 17h.01M14 18h.01" />
        </>
      ) : name === "wardrobe" ? (
        <>
          <path d="M10 6a2 2 0 1 1 4 0c0 2-2 2-2 4l9 7v2H3v-2l9-7" />
        </>
      ) : name === "realtime" ? (
        <>
          <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
          <circle cx="12" cy="9" r="2" />
          <path d="M7 17c0-5 10-5 10 0" />
        </>
      ) : name === "runway" ? (
        <>
          <path d="m8 3-5 18h18L16 3M12 4v3m0 4v3m0 4v2" />
        </>
      ) : name === "presentation" ? (
        <>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 22l4-4 4 4M8 10l3 3 5-5" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 15 4-5 3 3 3-5" />
        </>
      )}
    </svg>
  );
}
