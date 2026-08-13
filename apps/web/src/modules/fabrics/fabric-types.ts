export type FabricScope = "preset" | "user";

export interface Fabric {
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly id: string;
  readonly mainFileId: string;
  readonly mainImageUrl: string;
  readonly scope: FabricScope;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

export interface FabricListPage {
  readonly items: readonly Fabric[];
  readonly limit: number;
  readonly page: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface FabricListQuery {
  readonly limit?: number;
  readonly page?: number;
  readonly scope?: "all" | FabricScope;
  readonly search?: string;
}
