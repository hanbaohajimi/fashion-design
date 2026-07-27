import type { PrismaClient, Prisma } from "@fashion/db";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  CompiledGenInput,
  ContextModelGateway,
  ImageReference,
  SemanticImageChannel,
} from "./compiler.types";
import { compilePaletteColor } from "./palette-channel";

export const COMPILER_DB = Symbol("COMPILER_DB");
export const CONTEXT_MODEL = Symbol("CONTEXT_MODEL");

type CompilerDatabase = Pick<PrismaClient, "project">;
type BoardElement = {
  id: string;
  role: string;
  roleLabel: string | null;
  record: Prisma.JsonValue | null;
};

const COMMON_NEGATIVE_TERMS = [
  "anatomical distortion",
  "extra limbs",
  "deformed hands",
  "garment construction errors",
  "unwanted text",
  "watermark",
  "low-resolution fabric texture",
] as const;

function propsOf(record: Prisma.JsonValue | null): Record<string, unknown> {
  if (!record || Array.isArray(record) || typeof record !== "object") return {};
  const props = (record as Record<string, unknown>).props;
  return props && !Array.isArray(props) && typeof props === "object"
    ? (props as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, limit = 240): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function unique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

@Injectable()
export class ContextCompilerService {
  constructor(
    @Inject(COMPILER_DB) private readonly database: CompilerDatabase,
    @Inject(CONTEXT_MODEL) private readonly model: ContextModelGateway,
  ) {}

  async compile(
    userId: string,
    projectId: string | undefined,
    userRequest: string,
  ): Promise<CompiledGenInput> {
    const elements = projectId
      ? await this.loadOwnedElements(userId, projectId)
      : [];
    const palette = unique(
      elements
        .filter((element) => element.role === "palette")
        .map((element) => {
          const props = propsOf(element.record);
          return compilePaletteColor(props.color, props.label);
        }),
    );
    const notes = unique(
      elements
        .filter((element) => element.role === "note")
        .map((element) => cleanText(propsOf(element.record).text, 500)),
    );
    const styleReferences = elements
      .filter((element) => element.role === "style_ref")
      .map((element) => this.referenceFrom(element))
      .filter((value): value is ImageReference => Boolean(value));
    const silhouetteReferences = elements
      .filter((element) => element.role === "silhouette_ref")
      .map((element) => {
        const imageUrl = safeRemoteUrl(propsOf(element.record).url);
        return imageUrl
          ? { edgeImageUrl: imageUrl, elementId: element.id }
          : null;
      })
      .filter(
        (
          value,
        ): value is { edgeImageUrl: string; elementId: string } =>
          Boolean(value),
      );
    const fabricReferences = await this.compileSemanticReferences(
      elements.filter((element) => element.role === "fabric_ref"),
      "fabric",
    );
    const detailReferences = await this.compileSemanticReferences(
      elements.filter((element) => element.role === "detail_ref"),
      "detail",
    );
    const patternReferences = fabricReferences.filter((reference) =>
      reference.labels.some((label) => /pattern|print|motif|纹样|图案/i.test(label)),
    );
    const avoidReferences = await this.compileSemanticReferences(
      elements.filter((element) => element.role === "avoid"),
      "avoid",
    );
    const avoidLabels = unique(
      avoidReferences.flatMap((reference) => [...reference.labels]),
    );
    const fabricTerms = unique(
      fabricReferences.flatMap((reference) => [...reference.labels]),
    );
    const patternTerms = unique(
      patternReferences.flatMap((reference) =>
        reference.labels.filter((label) =>
          /pattern|print|motif|纹样|图案/i.test(label),
        ),
      ),
    );
    const detailTerms = unique(
      detailReferences.flatMap((reference) => [...reference.labels]),
    );
    const keywordPositive = this.joinPrompt([
      cleanText(userRequest, 4000),
      palette.length ? `palette: ${palette.join(", ")}` : null,
      fabricTerms.length ? `fabric: ${fabricTerms.join(", ")}` : null,
      patternTerms.length ? `pattern: ${patternTerms.join(", ")}` : null,
      detailTerms.length ? `details: ${detailTerms.join(", ")}` : null,
      notes.length ? `design notes: ${notes.join("; ")}` : null,
    ]);
    const keywordNegative = unique([
      ...avoidLabels,
      ...COMMON_NEGATIVE_TERMS,
    ]).join(", ");

    let positivePrompt = keywordPositive;
    let negativePrompt = keywordNegative;
    let enhancement: "llm" | "keywords" = "keywords";
    try {
      const enhanced = await this.model.enhancePrompt({
        avoidTerms: avoidLabels,
        detailTerms,
        fabricTerms,
        keywordNegative,
        keywordPositive,
        notes,
        palette,
        patternTerms,
        userRequest: cleanText(userRequest, 4000) ?? "",
      });
      positivePrompt = enhanced.positivePrompt;
      negativePrompt = enhanced.negativePrompt;
      enhancement = "llm";
    } catch {
      // 编译增强是可选能力；模型故障时保留确定性的关键词产物。
    }

    return {
      avoidLabels,
      detailReferences,
      enhancement,
      fabricReferences,
      mode: elements.length ? "board_guided" : "text_only",
      negativePrompt,
      notes,
      palette,
      patternReferences,
      positivePrompt,
      silhouetteReferences,
      styleReferences,
      version: 1,
    };
  }

  private async loadOwnedElements(
    userId: string,
    projectId: string,
  ): Promise<BoardElement[]> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        workspace: { select: { ownerId: true } },
        boardElements: {
          where: { deletedAt: null },
          select: { id: true, record: true, role: true, roleLabel: true },
        },
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
        message: "无权使用该项目编译生成上下文",
      });
    }
    return project.boardElements;
  }

  private referenceFrom(element: BoardElement): ImageReference | null {
    const imageUrl = safeRemoteUrl(propsOf(element.record).url);
    if (!imageUrl) return null;
    const label = cleanText(element.roleLabel);
    return {
      elementId: element.id,
      imageUrl,
      labels: label ? [label] : [],
    };
  }

  private async compileSemanticReferences(
    elements: readonly BoardElement[],
    channel: SemanticImageChannel,
  ): Promise<ImageReference[]> {
    return Promise.all(
      elements.slice(0, 20).map(async (element) => {
        const reference = this.referenceFrom(element);
        if (!reference) return null;
        if (reference.labels.length) return reference;
        try {
          const labels = unique([
            ...(await this.model.analyzeImage({
              channel,
              imageUrl: reference.imageUrl,
            })),
          ]);
          return { ...reference, labels };
        } catch {
          return reference;
        }
      }),
    ).then((values) =>
      values.filter((value): value is ImageReference => Boolean(value)),
    );
  }

  private joinPrompt(parts: readonly (string | null)[]): string {
    return parts.filter((part): part is string => Boolean(part)).join(". ");
  }
}
