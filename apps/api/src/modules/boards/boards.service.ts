import {
  Prisma,
  RoleInferenceState,
  RoleSource,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import { S3FileStorage } from "../files/storage.service";
import { requireProjectFile } from "../files/project-file-access";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import {
  isRetiredBoardShapeRecord,
  isRetiredBoardShapeType,
  stripRetiredBoardShapes,
  type BoardPatchInput,
  type ImportTrendInput,
} from "./boards.schemas";

export const BOARDS_DB = Symbol("BOARDS_DB");

type BoardsDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "boardElement"
  | "boardSnapshot"
  | "project"
  | "trendItem"
  | "workspaceMember"
  | "fileAsset"
  | "designAsset"
  | "fabric"
>;

type TrendCoverStorage = Pick<S3FileStorage, "createDownloadUrl">;

interface ImportedBoardElement {
  readonly id: string;
  readonly record: Prisma.InputJsonObject;
  readonly role: string;
  readonly shapeId: string;
  readonly shapeType: string;
}

export interface ImportTrendResult {
  readonly elements: readonly ImportedBoardElement[];
  readonly success: true;
}

export interface BoardLoadResult {
  readonly elements: readonly {
    readonly deleted: boolean;
    readonly record: unknown;
    readonly role: string;
    readonly roleConfidence: number | null;
    readonly roleInferenceState: string;
    readonly roleLabel: string | null;
    readonly roleSource: string;
    readonly shapeId: string;
    readonly shapeType: string;
    readonly updatedAt: Date;
  }[];
  readonly revision: number;
  readonly snapshot: unknown;
}

export interface BoardPatchResult {
  readonly batchId: string;
  readonly revision: number;
  readonly savedAt: Date;
}

@Injectable()
export class BoardsService {
  constructor(
    @Inject(BOARDS_DB) private readonly database: BoardsDatabase,
    @Optional()
    @Inject(S3FileStorage)
    private readonly storage?: TrendCoverStorage,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async get(userId: string, projectId: string): Promise<BoardLoadResult> {
    await this.access.require(userId, projectId, "read");
    const [snapshot, elements] = await Promise.all([
      this.database.boardSnapshot.findUnique({
        where: { projectId },
      }),
      this.database.boardElement.findMany({
        where: { projectId },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

    return {
      elements: elements
        .filter(
          (element) =>
            !isRetiredBoardShapeType(element.shapeType) &&
            !isRetiredBoardShapeRecord(element.record),
        )
        .map((element) => ({
          deleted: Boolean(element.deletedAt),
          record: element.record,
          role: element.role,
          roleConfidence: element.roleConfidence ?? null,
          roleInferenceState:
            element.roleInferenceState?.toLowerCase() ?? "none",
          roleLabel: element.roleLabel ?? null,
          roleSource: element.roleSource?.toLowerCase() ?? "default",
          shapeId: element.shapeId,
          shapeType: element.shapeType,
          updatedAt: element.updatedAt,
        })),
      revision: snapshot?.revision ?? 0,
      snapshot: snapshot
        ? stripRetiredBoardShapes(snapshot.snapshot)
        : null,
    };
  }

  async patch(
    userId: string,
    projectId: string,
    input: BoardPatchInput,
  ): Promise<BoardPatchResult> {
    await this.assertWritable(userId, projectId);
    const sanitizedSnapshot = stripRetiredBoardShapes(
      input.snapshot,
    ) as Prisma.InputJsonValue;

    const result = await this.database.$transaction(async (transaction) => {
      await this.access.require(userId, projectId, "edit", transaction);
      await this.validateReferences(userId, projectId, [sanitizedSnapshot, ...input.patches.flatMap((patch) => patch.deleted ? [] : [patch.record])], transaction);
      const currentSnapshot = await transaction.boardSnapshot.findUnique({
        where: { projectId },
        select: { revision: true },
      });
      let snapshot: { readonly revision: number; readonly updatedAt: Date };

      if (!currentSnapshot) {
        if (input.baseRevision !== 0) {
          throw revisionConflict(input.baseRevision, 0);
        }

        try {
          snapshot = await transaction.boardSnapshot.create({
            data: {
              projectId,
              revision: 1,
              snapshot: sanitizedSnapshot,
            },
            select: {
              revision: true,
              updatedAt: true,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw revisionConflict(input.baseRevision);
          }
          throw error;
        }
      } else {
        if (currentSnapshot.revision !== input.baseRevision) {
          throw revisionConflict(input.baseRevision, currentSnapshot.revision);
        }

        const updated = await transaction.boardSnapshot.updateMany({
          where: {
            projectId,
            revision: input.baseRevision,
          },
          data: {
            revision: { increment: 1 },
            snapshot: sanitizedSnapshot,
          },
        });

        if (updated.count !== 1) {
          const latestSnapshot = await transaction.boardSnapshot.findUnique({
            where: { projectId },
            select: { revision: true },
          });
          throw revisionConflict(
            input.baseRevision,
            latestSnapshot?.revision ?? 0,
          );
        }

        const savedSnapshot = await transaction.boardSnapshot.findUnique({
          where: { projectId },
          select: {
            revision: true,
            updatedAt: true,
          },
        });
        if (!savedSnapshot) {
          throw revisionConflict(input.baseRevision, 0);
        }
        snapshot = savedSnapshot;
      }

      for (const patch of input.patches) {
        const retiredShape =
          !patch.deleted &&
          (isRetiredBoardShapeType(patch.shapeType) ||
            isRetiredBoardShapeRecord(patch.record));
        if (patch.deleted || retiredShape) {
          await transaction.boardElement.upsert({
            where: {
              projectId_shapeId: {
                projectId,
                shapeId: patch.shapeId,
              },
            },
            create: {
              deletedAt: new Date(),
              projectId,
              record: Prisma.JsonNull,
              role: "generic",
              shapeId: patch.shapeId,
              shapeType: "unknown",
            },
            update: {
              deletedAt: new Date(),
            },
          });
          continue;
        }

        await transaction.boardElement.upsert({
          where: {
            projectId_shapeId: {
              projectId,
              shapeId: patch.shapeId,
            },
          },
          create: {
            projectId,
            fileAssetId: boardFileId(patch.record),
            record: patch.record as Prisma.InputJsonValue,
            role: patch.role,
            roleInferenceState: toInferenceState(patch.roleInferenceState),
            roleSource: toRoleSource(patch.roleSource),
            shapeId: patch.shapeId,
            shapeType: patch.shapeType,
            ...(patch.roleConfidence !== undefined
              ? { roleConfidence: patch.roleConfidence }
              : {}),
            ...(patch.roleLabel !== undefined
              ? { roleLabel: patch.roleLabel }
              : {}),
          },
          update: {
            deletedAt: null,
            fileAssetId: boardFileId(patch.record),
            record: patch.record as Prisma.InputJsonValue,
            shapeType: patch.shapeType,
            ...(patch.roleSource === "manual"
              ? {
                  role: patch.role,
                  roleConfidence: null,
                  roleInferenceState: RoleInferenceState.READY,
                  roleLabel: null,
                  roleSource: RoleSource.MANUAL,
                }
              : {}),
          },
        });
      }

      return snapshot;
    });

    return {
      batchId: input.batchId,
      revision: result.revision,
      savedAt: result.updatedAt,
    };
  }

  async importTrendToBoard(
    userId: string,
    projectId: string,
    input: ImportTrendInput,
  ): Promise<ImportTrendResult> {
    await this.assertWritable(userId, projectId);

    return this.database.$transaction(async (transaction) => {
      await this.access.require(userId, projectId, "edit", transaction);
      const trend = await transaction.trendItem.findUnique({
        where: { id: input.trendItemId },
        select: {
          coverFileId: true,
          extracted: true,
          id: true,
          sourceUrl: true,
          status: true,
          summary: true,
          title: true,
        },
      });
      if (!trend || trend.status !== "published") {
        throw new NotFoundException({
          code: "TREND_NOT_FOUND",
          message: "趋势条目不存在",
        });
      }

      const colors = trendColors(trend.extracted);
      const expectedShapeIds = trendShapeIds(trend.id, colors.length, Boolean(trend.coverFileId));
      const existing = await transaction.boardElement.findMany({
        where: { deletedAt: null, projectId },
        select: { record: true, shapeId: true, shapeType: true },
      });
      const activeExisting = existing.filter(
        ({ record, shapeType }) =>
          !isRetiredBoardShapeType(shapeType) &&
          !isRetiredBoardShapeRecord(record),
      );
      if (activeExisting.some(({ shapeId }) => expectedShapeIds.includes(shapeId))) {
        throw trendAlreadyImported();
      }

      const position = availableTrendPosition(
        activeExisting.map(({ record }) => record),
        input.position,
        colors.length,
      );
      const elements = buildTrendElements(trend, colors, position);
      const inserted = await transaction.boardElement.createMany({
        data: elements.map((element) => ({
          projectId,
          fileAssetId: boardFileId(element.record),
          record: element.record,
          role: element.role,
          roleInferenceState: RoleInferenceState.READY,
          roleSource: RoleSource.DEFAULT,
          shapeId: element.shapeId,
          shapeType: element.shapeType,
        })),
        skipDuplicates: true,
      });
      if (inserted.count !== elements.length) {
        throw trendAlreadyImported();
      }
      return { elements, success: true };
    });
  }

  async trendCoverUrl(trendItemId: string): Promise<string> {
    const trend = await this.database.trendItem.findUnique({
      where: { id: trendItemId },
      select: {
        coverFile: {
          select: {
            objectKey: true,
            thumbnail1024Key: true,
          },
        },
        status: true,
      },
    });
    if (!trend || trend.status !== "published" || !trend.coverFile) {
      throw new NotFoundException({
        code: "TREND_COVER_NOT_FOUND",
        message: "趋势代表图不存在",
      });
    }
    if (!this.storage) {
      throw new ServiceUnavailableException({
        code: "TREND_STORAGE_UNAVAILABLE",
        message: "趋势代表图暂时不可用",
      });
    }
    return this.storage.createDownloadUrl(
      trend.coverFile.thumbnail1024Key ?? trend.coverFile.objectKey,
      60,
    );
  }

  private async assertWritable(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const { archived } = await this.access.require(userId, projectId, "edit");

    if (archived) {
      throw new NotFoundException({
        code: "PROJECT_ARCHIVED",
        message: "项目已归档，请先恢复项目后继续编辑",
      });
    }
  }

  private async validateReferences(userId: string, projectId: string, values: unknown[], transaction: Prisma.TransactionClient) {
    const references = new Map<string, { kind: string; id: string }>();
    const pending = [...values];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const props = record.props;
      if (props && typeof props === "object" && !Array.isArray(props)) {
        for (const kind of ["fileId", "assetId", "fabricId"]) {
          const id = (props as Record<string, unknown>)[kind];
          if (typeof id === "string" && id) references.set(`${kind}:${id}`, { kind, id });
        }
      }
      pending.push(...Object.values(record));
    }
    // Validate against persisted references before writing any new sharing relationship.
    for (const { kind, id } of references.values()) {
      if (kind === "assetId") {
        const asset = await transaction.designAsset.findFirst({ where: { id, projectId, archivedAt: null }, select: { id: true } });
        if (!asset) throw new BadRequestException({ code: "ASSET_PROJECT_MISMATCH", message: "设计资产不属于当前项目" });
      } else if (kind === "fabricId") {
        const fabric = await transaction.fabric.findUnique({ where: { id } });
        if (!fabric) throw new NotFoundException("面料不存在");
        if (fabric.scope !== "PRESET" && fabric.ownerId !== userId)
          await requireProjectFile(transaction, this.access, userId, fabric.mainFileId, projectId, transaction);
      } else {
        try {
          await requireProjectFile(transaction, this.access, userId, id, projectId, transaction);
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          const trend = await transaction.trendItem.findFirst({ where: { coverFileId: id, status: "published" }, select: { id: true } });
          if (!trend) throw error;
        }
      }
    }
  }
}

function boardFileId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const props = (value as Record<string, unknown>).props;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const fileId = (props as Record<string, unknown>).fileId;
  return typeof fileId === "string" && fileId ? fileId : null;
}

interface TrendRecord {
  readonly coverFileId: string | null;
  readonly id: string;
  readonly sourceUrl: string;
  readonly summary: string;
  readonly title: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds extends Point {
  readonly h: number;
  readonly w: number;
}

const NOTE_WIDTH = 300;
const NOTE_HEIGHT = 120;
const SWATCH_SIZE = 82;
const SWATCH_GAP = 14;
const IMAGE_WIDTH = 340;
const IMAGE_HEIGHT = 260;
const GROUP_GAP = 48;

function buildTrendElements(
  trend: TrendRecord,
  colors: readonly string[],
  position: Point,
): ImportedBoardElement[] {
  const sourceMeta = {
    source: trend.sourceUrl,
    trendItemId: trend.id,
  };
  const noteId = trendShapeId(trend.id, "note");
  const note = importedElement(
    noteId,
    "fashion-note",
    "note",
    position,
    {
      ...sourceMeta,
      roles: ["note"],
    },
    {
      h: NOTE_HEIGHT,
      role: "note",
      text: trend.summary,
      tone: "#FDB462",
      w: NOTE_WIDTH,
    },
    "a1",
  );
  const swatches = colors.map((color, index) =>
    importedElement(
      trendShapeId(trend.id, `swatch-${index}`),
      "fashion-swatch",
      "palette",
      {
        x: position.x + index * (SWATCH_SIZE + SWATCH_GAP),
        y: position.y + 150,
      },
      {
        ...sourceMeta,
        roles: ["color_ref"],
      },
      {
        color,
        h: SWATCH_SIZE,
        label: `趋势色 ${index + 1}`,
        role: "palette",
        w: SWATCH_SIZE,
      },
      `a${index + 2}`,
    ),
  );
  const image = trend.coverFileId
    ? [
        importedElement(
          trendShapeId(trend.id, "image"),
          "fashion-image",
          "style_ref",
          { x: position.x, y: position.y + 250 },
          {
            ...sourceMeta,
            roles: ["style_ref"],
          },
          {
            fileId: trend.coverFileId,
            h: IMAGE_HEIGHT,
            role: "style_ref",
            roleInferenceState: "ready",
            roleSource: "default",
            title: trend.title,
            uploadStatus: "ready",
            url: `/api/boards/trend-assets/${encodeURIComponent(trend.id)}`,
            w: IMAGE_WIDTH,
          },
          `a${swatches.length + 2}`,
        ),
      ]
    : [];
  return [note, ...swatches, ...image];
}

function importedElement(
  shapeId: string,
  shapeType: string,
  role: string,
  position: Point,
  meta: Prisma.InputJsonObject,
  props: Prisma.InputJsonObject,
  index: string,
): ImportedBoardElement {
  return {
    id: shapeId,
    record: {
      id: shapeId,
      index,
      isLocked: false,
      meta,
      opacity: 1,
      parentId: "page:page",
      props,
      rotation: 0,
      type: shapeType,
      typeName: "shape",
      x: position.x,
      y: position.y,
    },
    role,
    shapeId,
    shapeType,
  };
}

function trendShapeIds(
  trendItemId: string,
  colorCount: number,
  hasImage: boolean,
): string[] {
  return [
    trendShapeId(trendItemId, "note"),
    ...Array.from({ length: colorCount }, (_, index) =>
      trendShapeId(trendItemId, `swatch-${index}`),
    ),
    ...(hasImage ? [trendShapeId(trendItemId, "image")] : []),
  ];
}

function trendShapeId(trendItemId: string, suffix: string): string {
  return `shape:trend-${trendItemId}-${suffix}`;
}

function trendColors(extracted: Prisma.JsonValue | null): string[] {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    return [];
  }
  const colors = (extracted as Record<string, unknown>).keyColors;
  if (!Array.isArray(colors)) return [];
  return [...new Set(colors)]
    .filter(
      (color): color is string =>
        typeof color === "string" && /^#[0-9A-Fa-f]{6}$/u.test(color),
    )
    .slice(0, 12)
    .map((color) => color.toUpperCase());
}

function availableTrendPosition(
  records: readonly Prisma.JsonValue[],
  preferred: Point | undefined,
  colorCount: number,
): Point {
  const origin = preferred ?? { x: 120, y: 120 };
  const existing = records.flatMap((record) => {
    const bounds = recordBounds(record);
    return bounds ? [bounds] : [];
  });
  const swatchWidth =
    colorCount === 0
      ? 0
      : colorCount * SWATCH_SIZE + (colorCount - 1) * SWATCH_GAP;
  const group = {
    h: 250 + IMAGE_HEIGHT,
    w: Math.max(NOTE_WIDTH, IMAGE_WIDTH, swatchWidth),
  };
  for (let index = 0; index < 80; index += 1) {
    const candidate = {
      h: group.h,
      w: group.w,
      x: origin.x + (index % 4) * (group.w + GROUP_GAP),
      y: origin.y + Math.floor(index / 4) * (group.h + GROUP_GAP),
    };
    if (!existing.some((bounds) => intersects(candidate, bounds))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return {
    x: origin.x,
    y: origin.y + 20 * (group.h + GROUP_GAP),
  };
}

function recordBounds(value: Prisma.JsonValue): Bounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const props = record.props;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const dimensions = props as Record<string, unknown>;
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof dimensions.w !== "number" ||
    typeof dimensions.h !== "number"
  ) {
    return null;
  }
  return {
    h: dimensions.h,
    w: dimensions.w,
    x: record.x,
    y: record.y,
  };
}

function intersects(left: Bounds, right: Bounds): boolean {
  return !(
    left.x + left.w + GROUP_GAP <= right.x ||
    right.x + right.w + GROUP_GAP <= left.x ||
    left.y + left.h + GROUP_GAP <= right.y ||
    right.y + right.h + GROUP_GAP <= left.y
  );
}

function trendAlreadyImported(): ConflictException {
  return new ConflictException({
    code: "TREND_ALREADY_IMPORTED",
    message: "该趋势已存在于白板",
  });
}

function revisionConflict(
  baseRevision: number,
  currentRevision?: number,
): ConflictException {
  return new ConflictException({
    code: "BOARD_REVISION_CONFLICT",
    message: "画布已在其他窗口更新，本地修改未覆盖远端版本",
    expectedRevision: baseRevision,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  });
}

function toRoleSource(value: string | undefined): RoleSource {
  if (value === "manual") {
    return RoleSource.MANUAL;
  }
  if (value === "inferred") {
    return RoleSource.INFERRED;
  }
  return RoleSource.DEFAULT;
}

function toInferenceState(value: string | undefined): RoleInferenceState {
  if (value === "pending") {
    return RoleInferenceState.PENDING;
  }
  if (value === "failed") {
    return RoleInferenceState.FAILED;
  }
  if (value === "ready") {
    return RoleInferenceState.READY;
  }
  return RoleInferenceState.NONE;
}
