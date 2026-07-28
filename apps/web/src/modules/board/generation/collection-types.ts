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
