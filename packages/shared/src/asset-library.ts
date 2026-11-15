import type { GeneratedFileKind } from "./project-generated-files";

export type LibraryAssetDomain = "asset" | "file" | "runway" | "export";
export type LibraryAssetSource = "generated" | "uploaded" | "exported";
export type LibraryAssetSort =
  "newest" | "oldest" | "rating-desc" | "rating-asc";
export interface LibraryAsset {
  id: string;
  domain: LibraryAssetDomain;
  resourceId: string;
  kind: GeneratedFileKind;
  source: LibraryAssetSource;
  title: string;
  createdAt: string;
  projects: { id: string; name: string; archived: boolean }[];
  archived: boolean;
  status: "ready" | "expired" | "unavailable";
  rating: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  previewUrl: string | null;
  contentUrl: string | null;
  sourceHref: string | null;
}
export interface LibraryAssetPage {
  items: LibraryAsset[];
  counts: Record<GeneratedFileKind | "all", number>;
  nextCursor: string | null;
}
