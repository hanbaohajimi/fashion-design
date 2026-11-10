export type GeneratedFileKind = "image" | "video" | "audio" | "document";
export type GeneratedFileFilter = GeneratedFileKind | "all";
export type GeneratedFileDomain = "asset" | "runway" | "export";

export interface ProjectGeneratedFile {
  id: string;
  domain: GeneratedFileDomain;
  resourceId: string;
  kind: GeneratedFileKind;
  title: string;
  operation: string;
  createdAt: string;
  archived: boolean;
  status: "ready" | "expired" | "unavailable";
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  previewUrl: string | null;
  contentUrl: string | null;
  sourceHref: string | null;
  nodeId: string | null;
}

export interface ProjectGeneratedFilePage {
  items: ProjectGeneratedFile[];
  nextCursor: string | null;
}
