/** Fashion-specific metadata */
export interface ProjectMetadata {
  /** Season code: SS26, FW26, etc. */
  readonly season?: string;
  /** Style category */
  readonly style?: ProjectStyle;
  /** Primary silhouette */
  readonly silhouette?: ProjectSilhouette;
  /** Material type */
  readonly materialType?: MaterialType;
  /** Color palette (Pantone codes or hex) */
  readonly colorPalette?: readonly string[];
  /** Collection name this project belongs to */
  readonly collection?: string;
  /** Fabric sample count */
  readonly fabricCount?: number;
}

export type ProjectStyle =
  | "minimalist"
  | "avant-garde"
  | "streetwear"
  | "couture"
  | "casual"
  | "formal"
  | "sportswear";

export type ProjectSilhouette =
  | "a-line"
  | "straight"
  | "cocoon"
  | "fitted"
  | "oversized"
  | "asymmetric";

export type MaterialType = "knit" | "woven" | "hybrid" | "leather" | "technical";

export interface Project {
  readonly archived: boolean;
  readonly assetCount: number;
  readonly coverAssetId: string | null;
  readonly coverUrl: string | null;
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly optimistic?: boolean;
  readonly updatedAt: string;
  /** Fashion-specific metadata */
  readonly metadata?: ProjectMetadata;
}

export interface ProjectPage {
  readonly hasMore: boolean;
  readonly items: readonly Project[];
  readonly page: number;
  readonly pageSize: number;
  readonly stats: {
    readonly activeProjects: number;
    readonly coverRate: number;
    readonly totalAssets: number;
  };
  readonly total: number;
}

export type ProjectStatusFilter = "active" | "archived";

export type ProjectGroupBy = "none" | "season" | "style" | "collection";
