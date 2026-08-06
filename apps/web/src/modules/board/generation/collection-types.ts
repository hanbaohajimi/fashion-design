export interface PaletteColor {
  readonly hex: string;
  readonly name: string;
}

export type StandardGarmentType =
  | "jacket"
  | "coat"
  | "vest"
  | "shirt"
  | "blouse"
  | "tshirt"
  | "top"
  | "knit"
  | "pants"
  | "shorts"
  | "skirt"
  | "dress"
  | "jumpsuit"
  | "custom";

export interface GarmentType {
  readonly code: StandardGarmentType;
  readonly label: string;
}

export const GARMENT_TYPE_OPTIONS: readonly GarmentType[] = [
  { code: "jacket", label: "夹克" },
  { code: "coat", label: "大衣" },
  { code: "vest", label: "背心" },
  { code: "shirt", label: "衬衫" },
  { code: "blouse", label: "女式衬衫" },
  { code: "tshirt", label: "短袖" },
  { code: "top", label: "上装" },
  { code: "knit", label: "针织上装" },
  { code: "pants", label: "长裤" },
  { code: "shorts", label: "短裤" },
  { code: "skirt", label: "半裙" },
  { code: "dress", label: "连衣裙" },
  { code: "jumpsuit", label: "连体衣" },
  { code: "custom", label: "自定义类型" },
];

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
  readonly signatureDetails: readonly string[];
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
  readonly sourceGarmentType: GarmentType | null;
  readonly updatedAt: string;
}

export interface UpdateDnaInput {
  readonly fabrics?: readonly string[];
  readonly locks?: Partial<CollectionDna["locks"]>;
  readonly moodWords?: readonly string[];
  readonly palette?: readonly PaletteColor[];
  readonly referenceFileIds?: readonly string[];
  readonly signatureDetails?: readonly string[];
  readonly silhouettes?: readonly string[];
}

export type CollectionVariationAxis =
  "silhouette" | "fabric" | "color" | "detail" | "styling" | "garmentType";

export type SimilarityAnalysisStatus =
  "pending" | "running" | "ready" | "failed";

export interface CollectionLook {
  readonly analysisStatus: SimilarityAnalysisStatus;
  readonly assetId: string;
  readonly garmentType: GarmentType | null;
  readonly isHero: boolean;
  readonly ordinal: number;
  readonly similarityScore: number | null;
  readonly slotKey: string | null;
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
