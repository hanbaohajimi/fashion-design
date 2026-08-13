import {
  Prisma,
  RoleInferenceState,
  RoleSource,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  BindSketchReferenceInput,
  SetElementRolesInput,
} from "./board-elements.schemas";
import type { VlmInferenceJobs } from "./vlm-inference-queue.service";

export const BOARD_ELEMENTS_DB = Symbol("BOARD_ELEMENTS_DB");
export const VLM_INFERENCE_JOBS = Symbol("VLM_INFERENCE_JOBS");

type BoardElementsDatabase = Pick<
  PrismaClient,
  "boardElement" | "fileAsset" | "project"
>;
type ElementRecord = NonNullable<
  Awaited<ReturnType<BoardElementsDatabase["boardElement"]["findUnique"]>>
>;

@Injectable()
export class BoardElementsService {
  constructor(
    @Inject(BOARD_ELEMENTS_DB)
    private readonly database: BoardElementsDatabase,
    @Inject(VLM_INFERENCE_JOBS)
    private readonly inferenceJobs: VlmInferenceJobs,
  ) {}

  async registerInference(
    userId: string,
    projectId: string,
    shapeId: string,
    fileId: string,
  ) {
    await this.assertProjectOwnership(userId, projectId);
    await this.assertFileOwnership(userId, fileId);
    const current = await this.database.boardElement.findUnique({
      where: { projectId_shapeId: { projectId, shapeId } },
    });
    if (current?.roleSource === RoleSource.MANUAL) {
      return this.toRoleResponse(current);
    }
    if (
      current?.fileAssetId === fileId &&
      (current.roleInferenceState === RoleInferenceState.READY ||
        current.roleInferenceState === RoleInferenceState.FAILED)
    ) {
      return this.toRoleResponse(current);
    }

    const ensured = await this.database.boardElement.upsert({
      where: { projectId_shapeId: { projectId, shapeId } },
      create: {
        fileAssetId: fileId,
        projectId,
        record: Prisma.JsonNull,
        role: "style_ref",
        roleInferenceState: RoleInferenceState.PENDING,
        roleSource: RoleSource.DEFAULT,
        shapeId,
        shapeType: "fashion-image",
      },
      update: {},
    });
    if (ensured.roleSource === RoleSource.MANUAL) {
      return this.toRoleResponse(ensured);
    }

    const registered = await this.database.boardElement.updateMany({
      where: {
        ...(current?.fileAssetId === fileId &&
        current.roleInferenceState === RoleInferenceState.PENDING
          ? {
              fileAssetId: fileId,
              roleInferenceState: RoleInferenceState.PENDING,
            }
          : {}),
        projectId,
        roleSource: { not: RoleSource.MANUAL },
        shapeId,
      },
      data: {
        deletedAt: null,
        fileAssetId: fileId,
        role: "style_ref",
        roleConfidence: null,
        roleInferenceState: RoleInferenceState.PENDING,
        roleLabel: null,
        roleSource: RoleSource.DEFAULT,
        shapeType: "fashion-image",
      },
    });
    const element = await this.database.boardElement.findUnique({
      where: { projectId_shapeId: { projectId, shapeId } },
    });
    if (!element) {
      throw new NotFoundException({
        code: "BOARD_ELEMENT_NOT_FOUND",
        message: "画布元素不存在",
      });
    }
    if (registered.count !== 1 || element.roleSource === RoleSource.MANUAL) {
      return this.toRoleResponse(element);
    }

    try {
      await this.inferenceJobs.enqueue({ fileId, projectId, shapeId });
      const current = await this.database.boardElement.findUnique({
        where: { projectId_shapeId: { projectId, shapeId } },
      });
      return this.toRoleResponse(current ?? element);
    } catch {
      await this.database.boardElement.updateMany({
        where: {
          deletedAt: null,
          fileAssetId: fileId,
          projectId,
          roleInferenceState: RoleInferenceState.PENDING,
          roleSource: { not: RoleSource.MANUAL },
          shapeId,
        },
        data: {
          role: "style_ref",
          roleConfidence: null,
          roleInferenceState: RoleInferenceState.FAILED,
          roleLabel: null,
          roleSource: RoleSource.DEFAULT,
        },
      });
      const fallback = await this.database.boardElement.findUnique({
        where: { projectId_shapeId: { projectId, shapeId } },
      });
      return this.toRoleResponse(fallback ?? element);
    }
  }

  async getRole(userId: string, projectId: string, shapeId: string) {
    await this.assertProjectOwnership(userId, projectId);
    const element = await this.database.boardElement.findUnique({
      where: { projectId_shapeId: { projectId, shapeId } },
    });
    if (!element || element.deletedAt) {
      throw new NotFoundException({
        code: "BOARD_ELEMENT_NOT_FOUND",
        message: "画布元素不存在",
      });
    }
    return this.toRoleResponse(element);
  }

  async bindSketchReference(
    userId: string,
    projectId: string,
    shapeId: string,
    input: BindSketchReferenceInput,
  ) {
    await this.assertProjectOwnership(userId, projectId);
    await this.assertFileOwnership(userId, input.fileId);
    const meta = input.record.meta;
    const sketchMeta =
      meta && !Array.isArray(meta) && typeof meta === "object"
        ? (meta as Record<string, unknown>)
        : null;
    const props = input.record.props;
    const sketchProps =
      props && !Array.isArray(props) && typeof props === "object"
        ? (props as Record<string, unknown>)
        : null;
    if (
      input.record.id !== shapeId ||
      input.record.typeName !== "shape" ||
      input.record.type !== "fashion-image" ||
      sketchMeta?.fashionSketch !== true ||
      sketchMeta.fashionSketchImage !== true ||
      sketchMeta.sketchStatus !== "ready" ||
      sketchMeta.sketchDirty !== false ||
      sketchMeta.sketchFingerprint !== input.fingerprint ||
      sketchProps?.fileId !== input.fileId ||
      sketchProps.role !== "silhouette_ref" ||
      sketchProps.roleSource !== "manual" ||
      sketchProps.roleInferenceState !== "ready" ||
      sketchProps.roleLabel !== "fashion_sketch" ||
      typeof sketchProps.url !== "string" ||
      sketchProps.url.length === 0
    ) {
      throw new BadRequestException({
        code: "SKETCH_RECORD_MISMATCH",
        message: "草图记录与画布元素或渲染内容不匹配",
      });
    }
    const record = input.record as Prisma.InputJsonObject;
    const element = await this.database.boardElement.upsert({
      where: { projectId_shapeId: { projectId, shapeId } },
      create: {
        fileAssetId: input.fileId,
        projectId,
        record,
        role: "silhouette_ref",
        roleInferenceState: RoleInferenceState.READY,
        roleLabel: "fashion_sketch",
        roleSource: RoleSource.MANUAL,
        shapeId,
        shapeType: "fashion-image",
      },
      update: {
        deletedAt: null,
        fileAssetId: input.fileId,
        record,
        role: "silhouette_ref",
        roleConfidence: null,
        roleInferenceState: RoleInferenceState.READY,
        roleLabel: "fashion_sketch",
        roleSource: RoleSource.MANUAL,
        shapeType: "fashion-image",
      },
    });
    return this.toRoleResponse(element);
  }

  async setRoles(
    userId: string,
    projectId: string,
    input: SetElementRolesInput,
  ) {
    await this.assertProjectOwnership(userId, projectId);
    const uniqueShapeIds = [...new Set(input.shapeIds)];
    const elements = await Promise.all(
      uniqueShapeIds.map((shapeId) =>
        this.database.boardElement.upsert({
          where: { projectId_shapeId: { projectId, shapeId } },
          create: {
            projectId,
            record: Prisma.JsonNull,
            role: input.role,
            roleInferenceState: RoleInferenceState.READY,
            roleSource: RoleSource.MANUAL,
            shapeId,
            shapeType: "unknown",
          },
          update: {
            deletedAt: null,
            role: input.role,
            roleConfidence: null,
            roleInferenceState: RoleInferenceState.READY,
            roleLabel: null,
            roleSource: RoleSource.MANUAL,
          },
        }),
      ),
    );
    return {
      count: elements.length,
      elements: elements.map((element) => this.toRoleResponse(element)),
    };
  }

  private async assertProjectOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权修改该项目的元素角色",
      });
    }
  }

  private async assertFileOwnership(
    userId: string,
    fileId: string,
  ): Promise<void> {
    const file = await this.database.fileAsset.findUnique({
      where: { id: fileId },
      select: { ownerId: true },
    });
    if (!file) {
      throw new NotFoundException({
        code: "FILE_NOT_FOUND",
        message: "文件不存在",
      });
    }
    if (file.ownerId !== userId) {
      throw new ForbiddenException({
        code: "FILE_FORBIDDEN",
        message: "无权为该文件推断角色",
      });
    }
  }

  private toRoleResponse(element: ElementRecord) {
    return {
      confidence: element.roleConfidence,
      label: element.roleLabel,
      role: element.role,
      shapeId: element.shapeId,
      source: element.roleSource.toLowerCase(),
      state: element.roleInferenceState.toLowerCase(),
    };
  }
}
