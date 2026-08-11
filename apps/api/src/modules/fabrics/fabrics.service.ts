import {
  FabricScope,
  FileStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from "../files/files.schemas";
import { detectImageMime } from "../files/files.service";
import type { S3FileStorage } from "../files/storage.service";
import type { ThumbnailJobs } from "../files/thumbnail-queue.service";
import type {
  CreateFabricInput,
  ListFabricsInput,
  UpdateFabricInput,
} from "./dto/fabric.dto";

export const FABRICS_DB = Symbol("FABRICS_DB");
export const FABRICS_STORAGE = Symbol("FABRICS_STORAGE");
export const FABRICS_THUMBNAIL_JOBS = Symbol("FABRICS_THUMBNAIL_JOBS");

const MAIN_FILE_SELECT = {
  id: true,
  mimeType: true,
  objectKey: true,
} as const;

const FABRIC_INCLUDE = {
  mainFile: { select: MAIN_FILE_SELECT },
} as const;

type FabricsDatabase = Pick<PrismaClient, "fabric" | "fileAsset">;
type FabricRecord = Prisma.FabricGetPayload<{
  include: typeof FABRIC_INCLUDE;
}>;
type FabricStorage = Pick<S3FileStorage, "createDownloadUrl" | "uploadBuffer">;

export interface FabricImageUpload {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly originalname: string;
  readonly size: number;
}

export interface FabricView {
  readonly attributes: Prisma.JsonValue;
  readonly category: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly mainFileId: string;
  readonly mainImageUrl: string;
  readonly name: string;
  readonly scope: "preset" | "user";
  readonly subCategory: string | null;
  readonly updatedAt: Date;
}

export interface FabricListView {
  readonly items: FabricView[];
  readonly limit: number;
  readonly page: number;
  readonly total: number;
  readonly totalPages: number;
}

@Injectable()
export class FabricsService {
  constructor(
    @Inject(FABRICS_DB) private readonly database: FabricsDatabase,
    @Inject(FABRICS_STORAGE) private readonly storage: FabricStorage,
    @Inject(FABRICS_THUMBNAIL_JOBS)
    private readonly thumbnailJobs: ThumbnailJobs,
  ) {}

  async list(userId: string, input: ListFabricsInput): Promise<FabricListView> {
    const searchTerms = fabricSearchTerms(input.search);
    const attributeFilters: Prisma.FabricWhereInput[] = [];
    if (input.composition) {
      attributeFilters.push({
        OR: fabricCompositionKeys(input.composition).map((composition) => ({
          attributes: { gt: 0, path: ["composition", composition] },
        })),
      });
    }
    if (input.season) {
      attributeFilters.push({
        attributes: {
          array_contains: [input.season],
          path: ["seasonSuggestion"],
        },
      });
    }
    if (input.minWeight !== undefined || input.maxWeight !== undefined) {
      attributeFilters.push({
        attributes: {
          ...(input.minWeight === undefined ? {} : { gte: input.minWeight }),
          ...(input.maxWeight === undefined ? {} : { lte: input.maxWeight }),
          path: ["weight"],
        },
      });
    }
    const visibility: Prisma.FabricWhereInput =
      input.scope === "preset"
        ? { scope: FabricScope.PRESET }
        : input.scope === "user"
          ? { ownerId: userId, scope: FabricScope.USER }
          : {
              OR: [
                { scope: FabricScope.PRESET },
                { ownerId: userId, scope: FabricScope.USER },
              ],
            };
    const where: Prisma.FabricWhereInput = {
      ...visibility,
      ...(input.category ? { category: input.category } : {}),
      ...(searchTerms.length > 0
        ? {
            AND: [
              {
                OR: searchTerms.flatMap((search) => [
                  {
                    name: { contains: search, mode: "insensitive" as const },
                  },
                  {
                    subCategory: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    category: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    attributes: {
                      gt: 0,
                      path: ["composition", search],
                    },
                  },
                  {
                    attributes: {
                      path: ["weave"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      path: ["drape"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      path: ["stretch"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      path: ["opacity"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      path: ["sheen"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      path: ["texture"],
                      string_contains: search,
                    },
                  },
                  {
                    attributes: {
                      array_contains: [search],
                      path: ["seasonSuggestion"],
                    },
                  },
                  {
                    attributes: {
                      array_contains: [search],
                      path: ["useCases"],
                    },
                  },
                ]),
              },
              ...attributeFilters,
            ],
          }
        : attributeFilters.length > 0
          ? { AND: attributeFilters }
          : {}),
      status: "active",
    };
    const skip = (input.page - 1) * input.limit;
    const [total, records] = await Promise.all([
      this.database.fabric.count({ where }),
      this.database.fabric.findMany({
        include: FABRIC_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: input.limit,
        where,
      }),
    ]);

    return {
      items: records.map((record) => this.toView(record)),
      limit: input.limit,
      page: input.page,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async findOne(userId: string, fabricId: string): Promise<FabricView> {
    const record = await this.findRecord(fabricId);
    this.assertReadable(userId, record);
    return this.toView(record);
  }

  async create(
    userId: string,
    input: CreateFabricInput,
    image: FabricImageUpload,
  ): Promise<FabricView> {
    const mainFileId = await this.storeMainImage(userId, image);
    const created = await this.database.fabric.create({
      data: {
        attributes: input.attributes,
        category: input.category,
        mainFileId,
        name: input.name,
        ownerId: userId,
        scope: FabricScope.USER,
        source: "user_upload",
        subCategory: input.subCategory ?? null,
      },
      include: FABRIC_INCLUDE,
    });
    return this.toView(created);
  }

  async update(
    userId: string,
    fabricId: string,
    input: UpdateFabricInput,
  ): Promise<FabricView> {
    const existing = await this.findRecord(fabricId);
    this.assertMutable(userId, existing);
    const data: Prisma.FabricUpdateInput = {
      ...(input.attributes !== undefined
        ? { attributes: input.attributes }
        : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.subCategory !== undefined
        ? { subCategory: input.subCategory }
        : {}),
    };
    const updated = await this.database.fabric.update({
      data,
      include: FABRIC_INCLUDE,
      where: { id: fabricId },
    });
    return this.toView(updated);
  }

  async remove(userId: string, fabricId: string): Promise<void> {
    const existing = await this.findRecord(fabricId);
    this.assertMutable(userId, existing);
    await this.database.fabric.update({
      data: { status: "archived" },
      where: { id: fabricId },
    });
  }

  async imageUrl(userId: string, fabricId: string): Promise<string> {
    const record = await this.findRecord(fabricId, true);
    this.assertReadable(userId, record);
    return this.storage.createDownloadUrl(record.mainFile.objectKey, 60);
  }

  private async findRecord(
    fabricId: string,
    includeArchived = false,
  ): Promise<FabricRecord> {
    const record = await this.database.fabric.findUnique({
      include: FABRIC_INCLUDE,
      where: { id: fabricId },
    });
    if (!record || (!includeArchived && record.status !== "active")) {
      throw new NotFoundException({
        code: "FABRIC_NOT_FOUND",
        message: "面料不存在",
      });
    }
    return record;
  }

  private assertReadable(userId: string, record: FabricRecord): void {
    if (record.scope === FabricScope.USER && record.ownerId !== userId) {
      throw new ForbiddenException({
        code: "FABRIC_FORBIDDEN",
        message: "无权访问该面料",
      });
    }
  }

  private assertMutable(userId: string, record: FabricRecord): void {
    if (
      record.scope !== FabricScope.USER ||
      record.ownerId === null ||
      record.ownerId !== userId
    ) {
      throw new ForbiddenException({
        code: "FABRIC_MUTATION_FORBIDDEN",
        message: "只能修改或删除自己的面料",
      });
    }
  }

  private async storeMainImage(
    userId: string,
    image: FabricImageUpload,
  ): Promise<string> {
    this.validateImage(image);
    const sha256 = createHash("sha256").update(image.buffer).digest("hex");
    let file = await this.database.fileAsset.findUnique({
      where: { ownerId_sha256: { ownerId: userId, sha256 } },
    });

    if (file) {
      if (file.mimeType !== image.mimetype || file.sizeBytes !== image.size) {
        throw new BadRequestException({
          code: "FILE_HASH_CONFLICT",
          message: "相同文件摘要对应的类型或大小不一致",
        });
      }
      if (file.status === FileStatus.READY) {
        return file.id;
      }
      if (file.status === FileStatus.PROCESSING) {
        await this.enqueueThumbnail(file.id);
        return file.id;
      }
    } else {
      const id = randomUUID();
      try {
        file = await this.database.fileAsset.create({
          data: {
            id,
            mimeType: image.mimetype,
            objectKey: `originals/${userId}/${id}/source`,
            originalName: image.originalname,
            ownerId: userId,
            sha256,
            sizeBytes: image.size,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
        file = await this.database.fileAsset.findUnique({
          where: { ownerId_sha256: { ownerId: userId, sha256 } },
        });
      }
    }

    if (!file) {
      throw new Error("面料主图文件记录创建失败");
    }

    const checksumSha256 = Buffer.from(sha256, "hex").toString("base64");
    try {
      await this.storage.uploadBuffer(
        file.objectKey,
        image.buffer,
        image.mimetype,
        checksumSha256,
      );
    } catch (error) {
      await this.database.fileAsset
        .update({
          data: {
            errorMessage: "面料主图上传到对象存储失败",
            status: FileStatus.FAILED,
          },
          where: { id: file.id },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        {
          code: "FABRIC_IMAGE_UPLOAD_FAILED",
          message: "面料主图上传失败，请稍后重试",
        },
        { cause: error },
      );
    }

    await this.database.fileAsset.update({
      data: {
        completedAt: new Date(),
        errorMessage: null,
        status: FileStatus.PROCESSING,
      },
      where: { id: file.id },
    });
    await this.enqueueThumbnail(file.id);
    return file.id;
  }

  private validateImage(image: FabricImageUpload): void {
    if (
      image.size <= 0 ||
      image.size > MAX_IMAGE_BYTES ||
      image.buffer.byteLength !== image.size
    ) {
      throw new BadRequestException({
        code: "FABRIC_IMAGE_SIZE_INVALID",
        message: "面料主图大小无效或超过 50MB",
      });
    }
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(image.mimetype)) {
      throw new BadRequestException({
        code: "FABRIC_IMAGE_TYPE_INVALID",
        message: "面料主图仅支持 JPG、PNG、WebP 或 HEIC",
      });
    }
    if (detectImageMime(image.buffer) !== image.mimetype) {
      throw new BadRequestException({
        code: "FABRIC_IMAGE_CONTENT_INVALID",
        message: "面料主图内容与声明的文件类型不一致",
      });
    }
  }

  private async enqueueThumbnail(fileId: string): Promise<void> {
    try {
      await this.thumbnailJobs.enqueue(fileId);
    } catch (error) {
      await this.database.fileAsset
        .update({
          data: { errorMessage: "缩略图任务暂时无法入队" },
          where: { id: fileId },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        {
          code: "THUMBNAIL_QUEUE_UNAVAILABLE",
          message: "缩略图任务暂时无法入队，请稍后重试",
        },
        { cause: error },
      );
    }
  }

  private toView(record: FabricRecord): FabricView {
    return {
      attributes: record.attributes,
      category: record.category,
      createdAt: record.createdAt,
      id: record.id,
      mainFileId: record.mainFileId,
      mainImageUrl: `/api/fabrics/${encodeURIComponent(record.id)}/image`,
      name: record.name,
      scope:
        record.scope === FabricScope.PRESET
          ? ("preset" as const)
          : ("user" as const),
      subCategory: record.subCategory,
      updatedAt: record.updatedAt,
    };
  }
}

const FABRIC_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  化纤: ["synthetic", "polyester", "聚酯纤维", "nylon", "尼龙", "锦纶"],
  斜纹: ["twill"],
  棉: ["cotton"],
  棉纤维: ["cotton"],
  氨纶: ["spandex"],
  混纺: ["blend"],
  真丝: ["silk"],
  羊毛: ["wool"],
  聚酯纤维: ["polyester", "synthetic"],
};

const FABRIC_COMPOSITION_ALIASES: Readonly<
  Record<string, readonly string[]>
> = {
  cotton: ["cotton", "棉", "棉纤维"],
  polyester: ["polyester", "聚酯纤维", "涤纶"],
  silk: ["silk", "真丝"],
  spandex: ["spandex", "氨纶"],
  wool: ["wool", "羊毛"],
};

function fabricCompositionKeys(composition: string): readonly string[] {
  return FABRIC_COMPOSITION_ALIASES[composition] ?? [composition];
}

function fabricSearchTerms(search: string): readonly string[] {
  const normalized = search.trim();
  if (!normalized) return [];
  return [...new Set([normalized, ...(FABRIC_SEARCH_ALIASES[normalized] ?? [])])];
}
