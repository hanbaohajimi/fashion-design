export interface PaletteColor {
  readonly hex: string;
  readonly name: string;
}

export interface CollectionDna {
  readonly extractionStatus: "failed" | "ready";
  readonly fabrics: readonly string[];
  readonly locks: {
    readonly fabrics: boolean;
    readonly moodWords: boolean;
    readonly palette: boolean;
    readonly silhouettes: boolean;
  };
  readonly moodWords: readonly string[];
  readonly palette: readonly PaletteColor[];
  readonly referenceFileIds: readonly string[];
  readonly silhouettes: readonly string[];
  readonly updatedAt: string;
}

export interface CollectionDetail {
  readonly createdAt: string;
  readonly dna: CollectionDna;
  readonly hero: {
    readonly assetId: string;
    readonly thumbnailUrl: string | null;
    readonly url: string;
  };
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly updatedAt: string;
}

export interface UpdateDnaInput {
  readonly fabrics?: readonly string[];
  readonly locks?: Partial<CollectionDna["locks"]>;
  readonly moodWords?: readonly string[];
  readonly palette?: readonly PaletteColor[];
  readonly referenceFileIds?: readonly string[];
  readonly silhouettes?: readonly string[];
}

export type CollectionVariationAxis =
  "silhouette" | "fabric" | "color" | "detail" | "styling";

export type SimilarityAnalysisStatus =
  "pending" | "running" | "ready" | "failed";

export interface CollectionLook {
  readonly analysisStatus: SimilarityAnalysisStatus;
  readonly assetId: string;
  readonly isHero: boolean;
  readonly ordinal: number;
  readonly similarityScore: number | null;
  readonly thumbnailUrl: string | null;
  readonly url: string;
  readonly variationAxis: CollectionVariationAxis | null;
  readonly warningIgnored: boolean;
}

export interface CollectionConsistency {
  readonly looks: readonly CollectionLook[];
  readonly referenceLabel: "参考相似度";
  readonly similarities: readonly {
    readonly leftAssetId: string;
    readonly rightAssetId: string;
    readonly score: number;
  }[];
}
