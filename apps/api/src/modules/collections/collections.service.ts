import {
  CollectionVariationAxis,
  DnaExtractionStatus,
  SimilarityAnalysisStatus,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  type CreateCollectionLookInput,
  dnaDraftSchema,
  type DnaDraft,
  type UpdateDnaInput,
} from "./collections.schemas";
import type { DnaExtractor } from "./dna-extractor";
import { GenerationService } from "../generation/generation.service";

export const COLLECTIONS_DB = Symbol("COLLECTIONS_DB");
export const DNA_EXTRACTOR = Symbol("DNA_EXTRACTOR");

interface PaletteColor {
  readonly hex: string;
  readonly name: string;
}

export interface DnaView {
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
  readonly updatedAt: Date;
}

export interface CollectionView {
  readonly createdAt: Date;
  readonly dna: DnaView;
  readonly hero: {
    readonly assetId: string;
    readonly thumbnailUrl: string | null;
    readonly url: string;
  };
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly updatedAt: Date;
}

export interface CollectionConsistencyView {
  readonly looks: readonly CollectionLookView[];
  readonly referenceLabel: "参考相似度";
  readonly similarities: readonly {
    readonly leftAssetId: string;
    readonly rightAssetId: string;
    readonly score: number;
  }[];
}

export interface CollectionLookView {
  readonly analysisStatus: "failed" | "pending" | "ready" | "running";
  readonly assetId: string;
  readonly isHero: boolean;
  readonly ordinal: number;
  readonly similarityScore: number | null;
  readonly thumbnailUrl: string | null;
  readonly url: string;
  readonly variationAxis:
    "color" | "detail" | "fabric" | "silhouette" | "styling" | null;
  readonly warningIgnored: boolean;
}

interface CollectionRecord {
  readonly createdAt: Date;
  readonly dna: DnaRecord | null;
  readonly heroAsset: {
    readonly id: string;
    readonly thumbnailUrl: string | null;
    readonly url: string;
  };
  readonly id: string;
  readonly name: string;
  readonly project: {
    readonly workspace: { readonly ownerId: string };
  };
  readonly projectId: string;
  readonly updatedAt: Date;
}

interface DnaRecord {
  readonly extractionStatus: DnaExtractionStatus;
  readonly fabrics: readonly string[];
  readonly fabricsLocked: boolean;
  readonly moodWords: readonly string[];
  readonly moodWordsLocked: boolean;
  readonly palette: unknown;
  readonly paletteLocked: boolean;
  readonly referenceFileIds: readonly string[];
  readonly silhouettes: readonly string[];
  readonly silhouettesLocked: boolean;
  readonly updatedAt: Date;
}

const collectionInclude = {
  dna: true,
  heroAsset: {
    select: { id: true, thumbnailUrl: true, url: true },
  },
  project: {
    select: { workspace: { select: { ownerId: true } } },
  },
} as const;

const emptyDraft: DnaDraft = {
  fabrics: [],
  moodWords: [],
  palette: [],
  silhouettes: [],
};

@Injectable()
export class CollectionsService {
  constructor(
    @Inject(COLLECTIONS_DB)
    private readonly database: PrismaClient,
    @Inject(DNA_EXTRACTOR)
    private readonly extractor: DnaExtractor,
    @Inject(GenerationService)
    private readonly generation: GenerationService,
  ) {}

  async createFromHero(
    userId: string,
    heroAssetId: string,
  ): Promise<CollectionView> {
    const hero = await this.ownedHero(userId, heroAssetId);
    const existing = await this.database.collection.findUnique({
      where: { heroAssetId },
      include: collectionInclude,
    });
    if (existing) {
      return this.toView(existing);
    }

    let extractionStatus: DnaExtractionStatus = DnaExtractionStatus.READY;
    let draft: DnaDraft;
    try {
      draft = await this.extractor.extract(hero.url);
    } catch {
      extractionStatus = DnaExtractionStatus.FAILED;
      draft = emptyDraft;
    }

    const collection = await this.database.collection.upsert({
      where: { heroAssetId },
      update: {},
      create: {
        dna: {
          create: {
            extractionStatus,
            fabrics: draft.fabrics,
            moodWords: draft.moodWords,
            palette: [...draft.palette],
            referenceFileIds: [],
            silhouettes: draft.silhouettes,
          },
        },
        heroAssetId,
        looks: {
          create: {
            analysisStatus: SimilarityAnalysisStatus.PENDING,
            designAssetId: hero.id,
            isHero: true,
            ordinal: 1,
          },
        },
        name: `系列 · ${hero.id.slice(0, 8).toUpperCase()}`,
        projectId: hero.projectId,
      },
      include: collectionInclude,
    });
    return this.toView(collection);
  }

  async get(userId: string, collectionId: string): Promise<CollectionView> {
    return this.toView(await this.ownedCollection(userId, collectionId));
  }

  async getByHero(
    userId: string,
    heroAssetId: string,
  ): Promise<CollectionView | null> {
    await this.ownedHero(userId, heroAssetId);
    const collection = await this.database.collection.findUnique({
      where: { heroAssetId },
      include: collectionInclude,
    });
    return collection ? this.toView(collection) : null;
  }

  async updateDna(
    userId: string,
    collectionId: string,
    input: UpdateDnaInput,
  ): Promise<DnaView> {
    const collection = await this.ownedCollection(userId, collectionId);
    const dna = this.requireDna(collection.dna);
    this.assertUnlocked(dna, input);
    await this.assertOwnedFileReferences(userId, input.referenceFileIds);

    const updated = await this.database.collectionDna.update({
      where: { collectionId },
      data: {
        ...(input.fabrics === undefined ? {} : { fabrics: input.fabrics }),
        ...(input.moodWords === undefined
          ? {}
          : { moodWords: input.moodWords }),
        ...(input.palette === undefined ? {} : { palette: [...input.palette] }),
        ...(input.referenceFileIds === undefined
          ? {}
          : { referenceFileIds: [...new Set(input.referenceFileIds)] }),
        ...(input.silhouettes === undefined
          ? {}
          : { silhouettes: input.silhouettes }),
        ...(input.locks?.fabrics === undefined
          ? {}
          : { fabricsLocked: input.locks.fabrics }),
        ...(input.locks?.moodWords === undefined
          ? {}
          : { moodWordsLocked: input.locks.moodWords }),
        ...(input.locks?.palette === undefined
          ? {}
          : { paletteLocked: input.locks.palette }),
        ...(input.locks?.silhouettes === undefined
          ? {}
          : { silhouettesLocked: input.locks.silhouettes }),
      },
    });
    return this.toDnaView(updated);
  }

  async createLook(
    userId: string,
    collectionId: string,
    input: CreateCollectionLookInput,
  ): Promise<{ taskId: string }> {
    const collection = await this.ownedCollection(userId, collectionId);
    const dna = this.requireDna(collection.dna);
    this.assertVariationAxisUnlocked(dna, input.variationAxis);
    const variationAxis = toDatabaseVariationAxis(input.variationAxis);
    const parameters = input.parameters;

    return this.generation.createForCollection(
      userId,
      {
        cfg: parameters?.cfg ?? 7,
        height: parameters?.height ?? 1_024,
        parentAssetId: collection.heroAsset.id,
        projectId: collection.projectId,
        prompt: collectionPrompt(collection, dna, input),
        referenceImageUrl: collection.heroAsset.url,
        shapeIds: [],
        steps: parameters?.steps ?? 28,
        strength: variationStrength(input.variationAxis),
        taskType: "i2i",
        width: parameters?.width ?? 768,
        ...(parameters?.seed === undefined ? {} : { seed: parameters.seed }),
      },
      { collectionId, variationAxis },
    );
  }

  async getConsistency(
    userId: string,
    collectionId: string,
  ): Promise<CollectionConsistencyView> {
    await this.ownedCollection(userId, collectionId);
    const [looks, similarities] = await Promise.all([
      this.database.collectionLook.findMany({
        where: { collectionId },
        orderBy: { ordinal: "asc" },
        include: {
          designAsset: {
            select: { thumbnailUrl: true, url: true },
          },
        },
      }),
      this.database.collectionLookSimilarity.findMany({
        where: { collectionId },
        orderBy: [{ leftAssetId: "asc" }, { rightAssetId: "asc" }],
      }),
    ]);
    return {
      looks: looks.map((look) => ({
        analysisStatus:
          look.analysisStatus.toLowerCase() as CollectionLookView["analysisStatus"],
        assetId: look.designAssetId,
        isHero: look.isHero,
        ordinal: look.ordinal,
        similarityScore: look.similarityScore,
        thumbnailUrl: look.designAsset.thumbnailUrl,
        url: look.designAsset.url,
        variationAxis: look.variationAxis
          ? (look.variationAxis.toLowerCase() as NonNullable<
              CollectionLookView["variationAxis"]
            >)
          : null,
        warningIgnored: look.warningIgnored,
      })),
      referenceLabel: "参考相似度",
      similarities: similarities.map((pair) => ({
        leftAssetId: pair.leftAssetId,
        rightAssetId: pair.rightAssetId,
        score: pair.score,
      })),
    };
  }

  async forceKeep(
    userId: string,
    collectionId: string,
    designAssetId: string,
  ): Promise<CollectionLookView> {
    await this.ownedCollection(userId, collectionId);
    const existing = await this.database.collectionLook.findUnique({
      where: {
        collectionId_designAssetId: { collectionId, designAssetId },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "COLLECTION_LOOK_NOT_FOUND",
        message: "系列 Look 不存在",
      });
    }
    await this.database.collectionLook.update({
      where: {
        collectionId_designAssetId: { collectionId, designAssetId },
      },
      data: { warningIgnored: true },
    });
    const consistency = await this.getConsistency(userId, collectionId);
    const updated = consistency.looks.find(
      (look) => look.assetId === designAssetId,
    );
    if (!updated) {
      throw new NotFoundException({
        code: "COLLECTION_LOOK_NOT_FOUND",
        message: "系列 Look 不存在",
      });
    }
    return updated;
  }

  private async ownedHero(userId: string, heroAssetId: string) {
    const hero = await this.database.designAsset.findUnique({
      where: { id: heroAssetId },
      include: {
        project: {
          select: {
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!hero) {
      throw new NotFoundException({
        code: "HERO_ASSET_NOT_FOUND",
        message: "Hero Look 不存在",
      });
    }
    if (hero.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "HERO_ASSET_FORBIDDEN",
        message: "无权使用该 Hero Look",
      });
    }
    return hero;
  }

  private async ownedCollection(
    userId: string,
    collectionId: string,
  ): Promise<CollectionRecord> {
    const collection = await this.database.collection.findUnique({
      where: { id: collectionId },
      include: collectionInclude,
    });
    if (!collection) {
      throw new NotFoundException({
        code: "COLLECTION_NOT_FOUND",
        message: "系列不存在",
      });
    }
    if (collection.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "COLLECTION_FORBIDDEN",
        message: "无权访问该系列",
      });
    }
    return collection;
  }

  private assertUnlocked(dna: DnaRecord, input: UpdateDnaInput): void {
    const currentPalette = dnaDraftSchema.shape.palette.safeParse(dna.palette);
    const blocked =
      (input.palette !== undefined &&
        !sameValue(
          input.palette,
          currentPalette.success ? currentPalette.data : [],
        ) &&
        dna.paletteLocked &&
        input.locks?.palette !== false) ||
      (input.silhouettes !== undefined &&
        !sameValue(input.silhouettes, dna.silhouettes) &&
        dna.silhouettesLocked &&
        input.locks?.silhouettes !== false) ||
      (input.fabrics !== undefined &&
        !sameValue(input.fabrics, dna.fabrics) &&
        dna.fabricsLocked &&
        input.locks?.fabrics !== false) ||
      (input.moodWords !== undefined &&
        !sameValue(input.moodWords, dna.moodWords) &&
        dna.moodWordsLocked &&
        input.locks?.moodWords !== false);
    if (blocked) {
      throw new BadRequestException({
        code: "DNA_DIMENSION_LOCKED",
        message: "请先解锁该 DNA 维度再编辑",
      });
    }
  }

  private assertVariationAxisUnlocked(
    dna: DnaRecord,
    axis: CreateCollectionLookInput["variationAxis"],
  ): void {
    const locked =
      (axis === "color" && dna.paletteLocked) ||
      (axis === "silhouette" && dna.silhouettesLocked) ||
      (axis === "fabric" && dna.fabricsLocked) ||
      (axis === "styling" && dna.moodWordsLocked);
    if (locked) {
      throw new BadRequestException({
        code: "VARIATION_AXIS_LOCKED",
        message: "该变化轴已在 DNA 中锁定，请选择其他维度",
      });
    }
  }

  private async assertOwnedFileReferences(
    userId: string,
    referenceFileIds: readonly string[] | undefined,
  ): Promise<void> {
    if (!referenceFileIds) return;
    const uniqueIds = [...new Set(referenceFileIds)];
    const ownedCount = await this.database.fileAsset.count({
      where: { id: { in: uniqueIds }, ownerId: userId },
    });
    if (ownedCount !== uniqueIds.length) {
      throw new BadRequestException({
        code: "INVALID_DNA_FILE_REFERENCE",
        message: "DNA 中包含无效或无权访问的 file_id",
      });
    }
  }

  private toView(collection: CollectionRecord): CollectionView {
    return {
      createdAt: collection.createdAt,
      dna: this.toDnaView(this.requireDna(collection.dna)),
      hero: {
        assetId: collection.heroAsset.id,
        thumbnailUrl: collection.heroAsset.thumbnailUrl,
        url: collection.heroAsset.url,
      },
      id: collection.id,
      name: collection.name,
      projectId: collection.projectId,
      updatedAt: collection.updatedAt,
    };
  }

  private toDnaView(dna: DnaRecord): DnaView {
    const palette = dnaDraftSchema.shape.palette.safeParse(dna.palette);
    return {
      extractionStatus:
        dna.extractionStatus === DnaExtractionStatus.FAILED
          ? "failed"
          : "ready",
      fabrics: dna.fabrics,
      locks: {
        fabrics: dna.fabricsLocked,
        moodWords: dna.moodWordsLocked,
        palette: dna.paletteLocked,
        silhouettes: dna.silhouettesLocked,
      },
      moodWords: dna.moodWords,
      palette: palette.success ? palette.data : [],
      referenceFileIds: dna.referenceFileIds,
      silhouettes: dna.silhouettes,
      updatedAt: dna.updatedAt,
    };
  }

  private requireDna(dna: DnaRecord | null): DnaRecord {
    if (!dna) {
      throw new NotFoundException({
        code: "COLLECTION_DNA_NOT_FOUND",
        message: "系列 DNA 不存在",
      });
    }
    return dna;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toDatabaseVariationAxis(
  axis: CreateCollectionLookInput["variationAxis"],
): CollectionVariationAxis {
  return {
    color: CollectionVariationAxis.COLOR,
    detail: CollectionVariationAxis.DETAIL,
    fabric: CollectionVariationAxis.FABRIC,
    silhouette: CollectionVariationAxis.SILHOUETTE,
    styling: CollectionVariationAxis.STYLING,
  }[axis];
}

function variationStrength(
  axis: CreateCollectionLookInput["variationAxis"],
): number {
  return {
    color: 0.36,
    detail: 0.32,
    fabric: 0.42,
    silhouette: 0.58,
    styling: 0.48,
  }[axis];
}

function collectionPrompt(
  collection: CollectionRecord,
  dna: DnaRecord,
  input: CreateCollectionLookInput,
): string {
  const palette = dnaDraftSchema.shape.palette.safeParse(dna.palette);
  const locked = [
    dna.paletteLocked
      ? `色板=${formatTerms(
          palette.success
            ? palette.data.map((color) => `${color.name} ${color.hex}`)
            : [],
        )}`
      : null,
    dna.silhouettesLocked ? `廓形=${formatTerms(dna.silhouettes)}` : null,
    dna.fabricsLocked ? `面料=${formatTerms(dna.fabrics)}` : null,
    dna.moodWordsLocked ? `情绪词=${formatTerms(dna.moodWords)}` : null,
  ].filter((value): value is string => value !== null);
  const reference = [
    `色板=${formatTerms(
      palette.success
        ? palette.data.map((color) => `${color.name} ${color.hex}`)
        : [],
    )}`,
    `廓形=${formatTerms(dna.silhouettes)}`,
    `面料=${formatTerms(dna.fabrics)}`,
    `情绪词=${formatTerms(dna.moodWords)}`,
  ].join("；");
  return [
    `为系列“${collection.name}”扩展一套新的完整服装 Look。`,
    `本次变化轴：${input.variationAxis}。在保持系列家族感的同时，围绕该轴做清晰、可辨识但受控的变化。`,
    `必须保持的锁定 DNA：${locked.length > 0 ? locked.join("；") : "无硬锁维度"}。锁定维度不得被重新解释或替换。`,
    `其余系列 DNA 作为视觉参考：${reference}。`,
    "延续 Hero Look 的设计语言、造型完成度与摄影呈现，输出单人全身时装 Look，不要生成拼贴或文字。",
    input.prompt ? `设计师补充方向：${input.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTerms(values: readonly string[]): string {
  return values.length > 0 ? values.join("、") : "未定义";
}
