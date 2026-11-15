import { FileStatus, type PrismaClient, type Prisma } from "@fashion/db";
import type { DesignSourceSnapshot } from "@fashion/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CompiledGenInput, ContextModelGateway, ImageReference } from "./compiler.types";
import { compilePaletteColor } from "./palette-channel";
import { RETIRED_BOARD_SHAPE_TYPE } from "../../boards/boards.schemas";
import { S3FileStorage } from "../../files/storage.service";
import { ProjectAccessPolicy } from "../../studio/project-access.policy";

export { compilePaletteColor } from "./palette-channel";
export const COMPILER_DB = Symbol("COMPILER_DB");
export const CONTEXT_MODEL = Symbol("CONTEXT_MODEL");
type CompilerDatabase = Pick<PrismaClient, "designAsset" | "fabric" | "project" | "trendItem" | "workspaceMember" | "fileAsset">;
type BoardElement = {
  id: string;
  shapeId?: string;
  shapeType: string;
  fileAssetId?: string | null;
  record: Prisma.JsonValue | null;
  fileAsset: { objectKey: string; status: FileStatus; thumbnail1024Key: string | null } | null;
};
export interface ContextCompilerOptions { readonly modelCalls?: "allow" | "skip"; readonly preserveLegacyPurpose?: boolean }
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const propsOf = (element: BoardElement) => object(object(element.record).props);

function richText(value: unknown): string {
  const node = object(value);
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map(richText).filter(Boolean).join(node.type === "doc" ? "\n" : "") : "";
}

function paletteFrom(element: BoardElement): string[] {
  if (!["swatch", "fashion-swatch"].includes(element.shapeType)) return [];
  const props = propsOf(element);
  const stored = Array.isArray(props.colors) ? props.colors : [{ color: props.color, label: props.label }];
  return [...new Set(stored.flatMap((item) => {
    const value = object(item);
    const color = compilePaletteColor(value.color, value.label);
    return color ? [color] : [];
  }))];
}

export function applyExactPaletteConstraint(prompt: string, colors: readonly string[]): string {
  const hex = [...new Set(colors.filter((color) => /^#[0-9a-f]{6}$/iu.test(color)).map((color) => color.toUpperCase()))];
  return hex.length && !hex.every((color) => prompt.toUpperCase().includes(color))
    ? `${prompt}\n参考色卡：${hex.join("、")}` : prompt;
}

/** Current requests use explicit content and instructions. No role inference or label channels. */
@Injectable()
export class ContextCompilerService {
  constructor(
    @Inject(COMPILER_DB) private readonly database: CompilerDatabase,
    @Inject(CONTEXT_MODEL) _model: ContextModelGateway,
    @Inject(S3FileStorage) private readonly storage: Pick<S3FileStorage, "createDownloadUrl">,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async compile(userId: string, projectId: string | undefined, userRequest: string, shapeIds?: readonly string[], _options?: ContextCompilerOptions): Promise<CompiledGenInput> {
    // Keep the historical call signature without enabling implicit enrichment.
    void _options;
    const elements = projectId ? await this.loadOwnedElements(userId, projectId, shapeIds) : [];
    const orderedReferences: ImageReference[] = [];
    const notes: string[] = [];
    const palette: string[] = [];
    const sources: DesignSourceSnapshot[] = [];
    for (const [index, element] of elements.entries()) {
      const props = propsOf(element);
      const title = text(props.title) || text(props.label) || `素材${index + 1}`;
      const colors = paletteFrom(element);
      palette.push(...colors);
      const content = text(props.text) || richText(props.richText);
      if (content) notes.push(`素材${index + 1}（${title}）：${content}`);
      if (colors.length) notes.push(`素材${index + 1}的色值：${colors.join("、")}`);
      const imageUrl = await this.resolveImage(element, userId, projectId);
      if (imageUrl) orderedReferences.push({ elementId: element.id, imageUrl, labels: [], order: index });
      sources.push({ elementId: element.id, role: "reference", title,
        ...(element.shapeId ? { shapeId: element.shapeId } : {}),
        ...(element.fileAssetId ? { fileAssetId: element.fileAssetId } : {}),
        ...(text(props.assetId) ? { assetId: text(props.assetId) } : {}),
        ...(text(props.fabricId) ? { fabricId: text(props.fabricId) } : {}),
        ...(text(props.trendItemId) ? { trendItemId: text(props.trendItemId) } : {}),
        ...(content ? { text: content } : {}), ...(colors.length ? { colors } : {}),
      });
    }
    const positivePrompt = [userRequest.trim(), ...notes].filter(Boolean).join("\n");
    if (positivePrompt.length > 4000) throw new BadRequestException("本次要求与引用文字超过4000字，请缩短后再生成");
    return {
      version: 1, referencePolicy: "instruction", orderedReferences, sources,
      mode: elements.length ? "board_guided" : "text_only", positivePrompt, negativePrompt: "",
      palette: [...new Set(palette)], notes, enhancement: "keywords",
      styleReferences: [], silhouetteReferences: [], fabricReferences: [], fabricInputs: [],
      patternReferences: [], detailReferences: [], paletteReferences: [], avoidLabels: [],
    };
  }

  private async loadOwnedElements(userId: string, projectId: string, shapeIds?: readonly string[]): Promise<BoardElement[]> {
    await this.access.require(userId, projectId, "read");
    if (!shapeIds?.length) return [];
    const project = await this.database.project.findUnique({ where: { id: projectId }, select: {
      deletedAt: true,
      boardElements: { where: { deletedAt: null, shapeType: { not: RETIRED_BOARD_SHAPE_TYPE }, shapeId: { in: [...shapeIds] } }, select: {
        id: true, shapeId: true, fileAssetId: true, record: true, shapeType: true,
        fileAsset: { select: { objectKey: true, status: true, thumbnail1024Key: true } },
      } },
    } });
    if (!project || project.deletedAt) throw new NotFoundException("项目不存在");
    const byShape = new Map(project.boardElements.map((element) => [element.shapeId, element]));
    return [...new Set(shapeIds)].flatMap((shapeId) => {
      const element = byShape.get(shapeId);
      if (!element) throw new BadRequestException("引用素材已变化或不可用，请重新选择");
      return [element];
    });
  }

  private async resolveImage(element: BoardElement, userId: string, projectId: string | undefined): Promise<string | null> {
    const meta = object(object(element.record).meta);
    if (meta.fashionSketch === true && (meta.sketchDirty === true || meta.sketchStatus !== "ready")) throw new BadRequestException("草图已修改，请先完成渲染再引用");
    if (element.fileAsset) {
      if (element.fileAsset.status !== FileStatus.READY) throw new BadRequestException("引用图片仍在处理中，请等待就绪");
      return this.storage.createDownloadUrl(element.fileAsset.objectKey, 24 * 60 * 60);
    }
    const props = propsOf(element);
    const assetId = text(props.assetId);
    if (assetId && projectId) {
      const asset = await this.database.designAsset.findFirst({ where: { id: assetId, projectId, archivedAt: null }, select: { url: true } });
      if (!asset) throw new BadRequestException("引用图片不存在或不可用");
      return asset.url.startsWith("s3://") ? this.storage.createDownloadUrl(asset.url.slice(5), 24 * 60 * 60) : asset.url;
    }
    const fabricId = text(props.fabricId);
    if (fabricId && projectId) {
      const permission = await this.access.require(userId, projectId, "read");
      const fabric = await this.database.fabric.findFirst({ where: { id: fabricId, status: "active", OR: [{ scope: "PRESET" }, { ownerId: { in: [userId, permission.ownerId] } }] }, include: { mainFile: true } });
      if (!fabric || fabric.mainFile.status !== FileStatus.READY) throw new BadRequestException("面料图片不存在或不可用");
      return this.storage.createDownloadUrl(fabric.mainFile.objectKey, 24 * 60 * 60);
    }
    const trendId = text(props.trendItemId);
    if (trendId) {
      const trend = await this.database.trendItem.findFirst({ where: { id: trendId, status: "published" }, include: { coverFile: true } });
      if (trend?.coverFile?.status === FileStatus.READY) return this.storage.createDownloadUrl(trend.coverFile.objectKey, 24 * 60 * 60);
    }
    return null;
  }
}
