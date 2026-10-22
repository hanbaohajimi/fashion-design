import { FabricScope, FileStatus, type PrismaClient } from "@fashion/db";

import { S3FileStorage } from "../../files/storage.service";
import { requireProjectFile } from "../../files/project-file-access";
import type { ProjectAccessPolicy } from "../../studio/project-access.policy";
import type {
  CompileResult,
  CompilerBoardElement,
  CompilerChannel,
  FabricGenerationInput,
  FabricReference,
} from "./compiler.types";

const DEFAULT_FABRIC_WEIGHT = 0.7;
const REFERENCE_URL_TTL_SECONDS = 24 * 60 * 60;

type FabricChannelDatabase = Pick<PrismaClient, "fabric" | "fileAsset" | "project">;

interface FabricElement {
  readonly element: CompilerBoardElement;
  readonly fabricId: string;
  readonly weight: number;
}

export class FabricChannel implements CompilerChannel {
  constructor(
    private readonly database: FabricChannelDatabase,
    private readonly userId: string,
    private readonly storage: Pick<S3FileStorage, "createDownloadUrl">,
    private readonly access?: ProjectAccessPolicy,
    private readonly projectId?: string,
  ) {}

  async compile(
    elements: readonly CompilerBoardElement[],
  ): Promise<CompileResult> {
    const fabricElements = elements.flatMap((element): FabricElement[] => {
      if (!isFabricElement(element)) return [];
      const props = contentOf(element.record);
      const fabricId = cleanIdentifier(props.fabricId);
      if (!fabricId) return [];
      return [{ element, fabricId, weight: referenceWeight(props.weight) }];
    });
    if (fabricElements.length === 0) {
      return { prompt: "", refImages: [] };
    }

    const fabricIds = [...new Set(fabricElements.map((item) => item.fabricId))];
    const fabrics = await this.database.fabric.findMany({
      where: {
        ...(!(this.projectId && this.access) ? { OR: [
          { scope: FabricScope.PRESET },
          { ownerId: this.userId, scope: FabricScope.USER },
        ] } : {}),
        id: { in: fabricIds },
        status: { in: ["active", "archived"] },
      },
      select: {
        id: true,
        ownerId: true,
        scope: true,
        mainFileId: true,
        mainFile: {
          select: {
            objectKey: true,
            status: true,
            thumbnail1024Key: true,
          },
        },
        tags: true,
      },
    });
    const fabricById = new Map(fabrics.map((fabric) => [fabric.id, fabric]));
    const prompts: string[] = [];
    const refImages: FabricReference[] = [];
    const fabricInputs: FabricGenerationInput[] = [];

    for (const item of fabricElements) {
      const fabric = fabricById.get(item.fabricId);
      if (!fabric) continue;
      if (fabric.scope !== FabricScope.PRESET && fabric.ownerId !== this.userId && this.access && this.projectId)
        await requireProjectFile(this.database, this.access, this.userId, fabric.mainFileId, this.projectId);
      const tags = cleanTags(fabric.tags);
      if (tags.length > 0) prompts.push(`fabric tags: ${tags.join(", ")}`);
      fabricInputs.push({
        boardElementId: item.element.id,
        fabricId: fabric.id,
        role: "fabric_texture",
        tags,
        weight: item.weight,
      });

      if (fabric.mainFile.status === FileStatus.READY) {
        const objectKey =
          fabric.mainFile.thumbnail1024Key ?? fabric.mainFile.objectKey;
        refImages.push({
          elementId: item.element.id,
          fabricId: fabric.id,
          imageUrl: await this.storage.createDownloadUrl(
            objectKey,
            REFERENCE_URL_TTL_SECONDS,
          ),
          labels: tags,
          role: "fabric_texture",
          weight: item.weight,
        });
      }
    }

    if (fabricInputs.length === 0) {
      return { prompt: "", refImages: [] };
    }
    return {
      fabricInputs,
      prompt: [...new Set(prompts)].join("; "),
      refImages,
    };
  }
}

function isFabricElement(element: CompilerBoardElement): boolean {
  return (
    element.shapeType === "fabric" ||
    element.shapeType === "fashion-fabric" ||
    element.role.includes("fabric_ref")
  );
}

function contentOf(record: unknown): Record<string, unknown> {
  const root = objectValue(record);
  return objectValue(root.props ?? root.content ?? root);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}

function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(
    0,
    12,
  );
}

function referenceWeight(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : DEFAULT_FABRIC_WEIGHT;
}
