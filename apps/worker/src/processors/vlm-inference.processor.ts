import {
  FileStatus,
  RoleInferenceState,
  RoleSource,
  type PrismaClient,
} from "@fashion/db";
import type {
  BoardElementRole,
  VlmInferenceJobData,
  VlmRoleLabel,
} from "@fashion/shared";

import type { ThumbnailStorage } from "../storage";
import type { VlmClassifier } from "../vlm-classifier";

type VlmDatabase = Pick<PrismaClient, "boardElement" | "fileAsset">;

export interface VlmInferenceProcessorDependencies {
  readonly classifier: VlmClassifier;
  readonly database: VlmDatabase;
  readonly storage: ThumbnailStorage;
}

const ROLE_BY_LABEL: Readonly<Record<VlmRoleLabel, BoardElementRole>> = {
  color_palette: "palette",
  fabric_texture: "fabric_ref",
  fashion_sketch: "silhouette_ref",
  garment_detail: "detail_ref",
  garment_photo: "reference_garment",
  non_fashion: "style_ref",
  other_fashion: "style_ref",
  silhouette: "silhouette_ref",
};

export function roleForVlmLabel(label: VlmRoleLabel): BoardElementRole {
  return ROLE_BY_LABEL[label];
}

class SourceNotReadyError extends Error {}

export async function markRoleInferenceFailed(
  database: VlmDatabase,
  data: VlmInferenceJobData,
): Promise<void> {
  await database.boardElement.updateMany({
    where: {
      deletedAt: null,
      fileAssetId: data.fileId,
      projectId: data.projectId,
      roleInferenceState: RoleInferenceState.PENDING,
      roleSource: { not: RoleSource.MANUAL },
      shapeId: data.shapeId,
    },
    data: {
      role: "style_ref",
      roleConfidence: null,
      roleInferenceState: RoleInferenceState.FAILED,
      roleLabel: null,
      roleSource: RoleSource.DEFAULT,
    },
  });
}

export function createVlmInferenceProcessor({
  classifier,
  database,
  storage,
}: VlmInferenceProcessorDependencies) {
  return async (data: VlmInferenceJobData): Promise<void> => {
    const [element, file] = await Promise.all([
      database.boardElement.findUnique({
        where: {
          projectId_shapeId: {
            projectId: data.projectId,
            shapeId: data.shapeId,
          },
        },
      }),
      database.fileAsset.findUnique({ where: { id: data.fileId } }),
    ]);
    if (!element || element.deletedAt || element.fileAssetId !== data.fileId) {
      return;
    }
    if (element.roleSource === RoleSource.MANUAL) {
      return;
    }
    if (element.roleInferenceState !== RoleInferenceState.PENDING) {
      return;
    }
    if (!file || file.status !== FileStatus.READY || !file.thumbnail1024Key) {
      throw new SourceNotReadyError("图片缩略图尚未就绪");
    }

    try {
      const thumbnail = await storage.get(file.thumbnail1024Key);
      const classification = await classifier.classify(thumbnail, "image/webp");
      const role = roleForVlmLabel(classification.label);
      const confidence =
        classification.label === "non_fashion" || !classification.isFashion
          ? Math.min(classification.confidence, 0.49)
          : classification.confidence;
      await database.boardElement.updateMany({
        where: {
          deletedAt: null,
          fileAssetId: data.fileId,
          projectId: data.projectId,
          roleInferenceState: RoleInferenceState.PENDING,
          roleSource: { not: RoleSource.MANUAL },
          shapeId: data.shapeId,
        },
        data: {
          role,
          roleConfidence: confidence,
          roleInferenceState: RoleInferenceState.READY,
          roleLabel: classification.label,
          roleSource: RoleSource.INFERRED,
        },
      });
    } catch (error) {
      if (error instanceof SourceNotReadyError) {
        throw error;
      }
      await markRoleInferenceFailed(database, data);
    }
  };
}
