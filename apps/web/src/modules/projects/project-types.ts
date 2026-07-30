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
}

export interface ProjectPage {
  readonly hasMore: boolean;
  readonly items: readonly Project[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type ProjectStatusFilter = "active" | "archived";
