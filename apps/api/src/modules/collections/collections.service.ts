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
import { S3FileStorage } from "../files/storage.service";

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
const MAX_CLAUDE_IMAGE_BYTES = 10 * 1024 * 1024;
const CLAUDE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Injectable()
export class CollectionsService {
  constructor(
    @Inject(COLLECTIONS_DB)
    private readonly database: PrismaClient,
    @Inject(DNA_EXTRACTOR)
    private readonly extractor: DnaExtractor,
    @Inject(GenerationService)
    private readonly generation: GenerationService,
    @Inject(S3FileStorage)
    private readonly storage: S3FileStorage,
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
      if (
        existing.dna &&
        (existing.dna.extractionStatus === DnaExtractionStatus.FAILED ||
          !hasUsefulDnaRecord(existing.dna))
      ) {
        try {
          const recovered = await this.extractor.extract(
            await this.claudeImageUrl(hero.thumbnailUrl ?? hero.url),
          );
          if (!hasUsefulDna(recovered)) {
            throw new Error("Hero Look 未提取到可用的系列 DNA");
          }
          const dna = await this.database.collectionDna.update({
            where: { collectionId: existing.id },
            data: {
              extractionStatus: DnaExtractionStatus.READY,
              fabrics: recovered.fabrics,
              moodWords: recovered.moodWords,
              palette: [...recovered.palette],
              silhouettes: recovered.silhouettes,
            },
          });
          return this.toView({ ...existing, dna });
        } catch {
          return this.toView(existing);
        }
      }
      return this.toView(existing);
    }

    let extractionStatus: DnaExtractionStatus = DnaExtractionStatus.READY;
    let draft: DnaDraft;
    try {
      draft = await this.extractor.extract(
        await this.claudeImageUrl(hero.thumbnailUrl ?? hero.url),
      );
      if (!hasUsefulDna(draft)) {
        throw new Error("Hero Look 未提取到可用的系列 DNA");
      }
    } catch {
      extractionStatus = DnaExtractionStatus.FAILED;
      draft = emptyDraft;
    }

    const collectionId = await this.database.$transaction(async (transaction) => {
      const base = await transaction.collection.upsert({
        where: { heroAssetId },
        update: {},
        create: {
          heroAssetId,
          name: `系列 · ${hero.id.slice(0, 8).toUpperCase()}`,
          projectId: hero.projectId,
        },
      });
      await transaction.collectionDna.upsert({
        where: { collectionId: base.id },
        update: {},
        create: {
          collectionId: base.id,
          extractionStatus,
          fabrics: draft.fabrics,
          moodWords: draft.moodWords,
          palette: [...draft.palette],
          referenceFileIds: [],
          silhouettes: draft.silhouettes,
        },
      });
      await transaction.collectionLook.upsert({
        where: { designAssetId: hero.id },
        update: {},
        create: {
          analysisStatus: SimilarityAnalysisStatus.PENDING,
          collectionId: base.id,
          designAssetId: hero.id,
          isHero: true,
          ordinal: 1,
        },
      });
      return base.id;
    });
    const collection = await this.database.collection.findUniqueOrThrow({
      where: { id: collectionId },
      include: collectionInclude,
    });
    return this.toView(collection);
  }

  async get(userId: string, collectionId: string): Promise<CollectionView> {
    return this.toView(await this.ownedCollection(userId, collectionId));
  }

  async list(userId: string, projectId: string): Promise<CollectionView[]> {
    const collections = await this.database.collection.findMany({
      where: {
        projectId,
        project: { workspace: { ownerId: userId } },
      },
      include: collectionInclude,
      orderBy: { updatedAt: "desc" },
    });
    return collections.map((collection) => this.toView(collection));
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
    this.assertLockableDimensions(dna, input);
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
    idempotencyKey: string,
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
        referenceImageUrl: await this.providerUrl(collection.heroAsset.url),
        shapeIds: [],
        steps: parameters?.steps ?? 28,
        strength: variationStrength(input.variationAxis),
        taskType: "i2i",
        width: parameters?.width ?? 768,
        ...(parameters?.seed === undefined ? {} : { seed: parameters.seed }),
      },
      { collectionId, variationAxis },
      idempotencyKey,
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
        thumbnailUrl: look.designAsset.thumbnailUrl
          ? displayAssetUrl(
              look.designAssetId,
              "thumbnail",
              look.designAsset.thumbnailUrl,
            )
          : null,
        url: displayAssetUrl(
          look.designAssetId,
          "content",
          look.designAsset.url,
        ),
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

  private assertLockableDimensions(
    dna: DnaRecord,
    input: UpdateDnaInput,
  ): void {
    const currentPalette = dnaDraftSchema.shape.palette.safeParse(dna.palette);
    const emptyLock =
      (input.locks?.palette === true &&
        (input.palette ?? (currentPalette.success ? currentPalette.data : []))
          .length === 0) ||
      (input.locks?.silhouettes === true &&
        (input.silhouettes ?? dna.silhouettes).length === 0) ||
      (input.locks?.fabrics === true &&
        (input.fabrics ?? dna.fabrics).length === 0) ||
      (input.locks?.moodWords === true &&
        (input.moodWords ?? dna.moodWords).length === 0);
    if (emptyLock) {
      throw new BadRequestException({
        code: "DNA_DIMENSION_EMPTY",
        message: "请先定义该 DNA 维度，再将其锁定",
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
        thumbnailUrl: collection.heroAsset.thumbnailUrl
          ? displayAssetUrl(
              collection.heroAsset.id,
              "thumbnail",
              collection.heroAsset.thumbnailUrl,
            )
          : null,
        url: displayAssetUrl(
          collection.heroAsset.id,
          "content",
          collection.heroAsset.url,
        ),
      },
      id: collection.id,
      name: collection.name,
      projectId: collection.projectId,
      updatedAt: collection.updatedAt,
    };
  }

  private async providerUrl(stored: string): Promise<string> {
    const objectKey = objectKeyFrom(stored);
    return objectKey
      ? this.storage.createDownloadUrl(objectKey, 15 * 60)
      : stored;
  }

  private async claudeImageUrl(stored: string): Promise<string> {
    const objectKey = objectKeyFrom(stored);
    if (!objectKey) return stored;
    const head = await this.storage.head(objectKey);
    const contentType = head.contentType?.toLowerCase();
    if (!contentType || !CLAUDE_IMAGE_TYPES.has(contentType)) {
      throw new Error("Hero Look 图片格式不受 Claude 支持");
    }
    if (
      head.contentLength <= 0 ||
      head.contentLength > MAX_CLAUDE_IMAGE_BYTES
    ) {
      throw new Error("Hero Look 缩略图大小不适合视觉分析");
    }
    const bytes = await this.storage.readPrefix(
      objectKey,
      head.contentLength + 1,
    );
    if (bytes.byteLength !== head.contentLength) {
      throw new Error("Hero Look 图片读取不完整");
    }
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
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

function objectKeyFrom(value: string): string | null {
  return value.startsWith("s3://") ? value.slice("s3://".length) : null;
}

function displayAssetUrl(
  assetId: string,
  variant: "content" | "thumbnail",
  stored: string,
): string {
  return objectKeyFrom(stored)
    ? `/api/design-assets/${encodeURIComponent(assetId)}/${variant}`
    : stored;
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
    detail: 0.2,
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
    `除“${input.variationAxis}”外，其余廓形、比例、色彩、面料和造型均需与 Hero Look 保持一致；若与锁定 DNA 冲突，以锁定 DNA 为最高优先级。`,
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

function hasUsefulDna(draft: DnaDraft): boolean {
  return (
    draft.palette.length > 0 ||
    draft.silhouettes.length > 0 ||
    draft.fabrics.length > 0 ||
    draft.moodWords.length > 0
  );
}

function hasUsefulDnaRecord(dna: DnaRecord): boolean {
  const palette = dnaDraftSchema.shape.palette.safeParse(dna.palette);
  return (
    (palette.success && palette.data.length > 0) ||
    dna.silhouettes.length > 0 ||
    dna.fabrics.length > 0 ||
    dna.moodWords.length > 0
  );
}
