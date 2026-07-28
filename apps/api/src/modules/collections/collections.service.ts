import { DnaExtractionStatus, type PrismaClient } from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  dnaDraftSchema,
  type DnaDraft,
  type UpdateDnaInput,
} from "./collections.schemas";
import type { DnaExtractor } from "./dna-extractor";

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
