import { FileStatus, type PrismaClient } from "@fashion/db";

import { S3FileStorage } from "../../files/storage.service";
import type {
  CompileResult,
  CompilerBoardElement,
  CompilerChannel,
  TrendReference,
} from "./compiler.types";

const DEFAULT_TREND_WEIGHT = 0.5;
const REFERENCE_URL_TTL_SECONDS = 24 * 60 * 60;
const MAX_TRENDS = 20;
const MAX_TERMS_PER_FIELD = 20;

type TrendChannelDatabase = Pick<PrismaClient, "trendItem">;

interface TrendElement {
  readonly element: CompilerBoardElement;
  readonly trendItemId: string;
}

interface TrendRecord {
  readonly coverFile: {
    readonly objectKey: string;
    readonly status: FileStatus;
    readonly thumbnail1024Key: string | null;
  } | null;
  readonly extracted: unknown;
  readonly id: string;
}

export class TrendChannel implements CompilerChannel {
  constructor(
    private readonly database: TrendChannelDatabase,
    private readonly storage: Pick<S3FileStorage, "createDownloadUrl">,
  ) {}

  async compile(
    elements: readonly CompilerBoardElement[],
  ): Promise<CompileResult> {
    const trendElements = elements.flatMap((element): TrendElement[] => {
      const trendItemId = trendItemIdOf(element.record);
      return trendItemId ? [{ element, trendItemId }] : [];
    });
    if (trendElements.length === 0) {
      return { prompt: "", refImages: [] };
    }

    const trendItemIds = unique(
      trendElements.map(({ trendItemId }) => trendItemId),
    ).slice(0, MAX_TRENDS);
    const trends: readonly TrendRecord[] =
      await this.database.trendItem.findMany({
        where: {
          id: { in: trendItemIds },
          status: "published",
        },
        select: {
          coverFile: {
            select: {
              objectKey: true,
              status: true,
              thumbnail1024Key: true,
            },
          },
          extracted: true,
          id: true,
        },
      });
    const trendById = new Map(trends.map((trend) => [trend.id, trend]));
    const visibleTrendIds = trendItemIds.filter((id) => trendById.has(id));

    const colors = unique(
      trendElements.flatMap(({ element, trendItemId }) => {
        if (!trendById.has(trendItemId) || !isSwatchElement(element)) {
          return [];
        }
        const color = normalizedHexColor(propsOf(element.record).color);
        return color ? [color] : [];
      }),
    );
    const keywords = unique(
      visibleTrendIds.flatMap((id) =>
        extractedTerms(trendById.get(id)?.extracted, "keywords"),
      ),
    );
    const silhouettes = unique(
      visibleTrendIds.flatMap((id) =>
        extractedTerms(trendById.get(id)?.extracted, "silhouettes"),
      ),
    );
    const prompt = [
      colors.length ? `color palette: ${colors.join(", ")}` : null,
      keywords.length ? `trend keywords: ${keywords.join(", ")}` : null,
      silhouettes.length
        ? `silhouette: ${silhouettes.join(" or ")}`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");

    const refImages = (
      await Promise.all(
        trendElements
          .filter(({ element }) => isStyleImageElement(element))
          .slice(0, MAX_TRENDS)
          .map(async ({ element, trendItemId }): Promise<TrendReference | null> => {
            const trend = trendById.get(trendItemId);
            if (!trend) return null;
            const imageUrl = await this.referenceUrl(trend, element.record);
            if (!imageUrl) return null;
            const extracted = objectValue(trend.extracted);
            return {
              elementId: element.id,
              imageUrl,
              labels: unique([
                ...stringTerms(extracted.keywords),
                ...stringTerms(extracted.silhouettes),
              ]),
              role: "style_ref",
              trendItemId,
              weight: DEFAULT_TREND_WEIGHT,
            };
          }),
      )
    ).filter((value): value is TrendReference => Boolean(value));

    return { prompt, refImages };
  }

  private async referenceUrl(
    trend: TrendRecord,
    record: unknown,
  ): Promise<string | null> {
    if (trend.coverFile?.status === FileStatus.READY) {
      return this.storage.createDownloadUrl(
        trend.coverFile.thumbnail1024Key ?? trend.coverFile.objectKey,
        REFERENCE_URL_TTL_SECONDS,
      );
    }
    return safeRemoteUrl(propsOf(record).url);
  }
}

function trendItemIdOf(record: unknown): string | null {
  const root = objectValue(record);
  const meta = objectValue(root.meta);
  const props = objectValue(root.props ?? root.content);
  return cleanIdentifier(
    meta.trendItemId ?? props.trendItemId ?? root.trendItemId,
  );
}

function propsOf(record: unknown): Record<string, unknown> {
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

function normalizedHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : null;
}

function isSwatchElement(element: CompilerBoardElement): boolean {
  return element.shapeType === "swatch" || element.shapeType === "fashion-swatch";
}

function isStyleImageElement(element: CompilerBoardElement): boolean {
  return (
    (element.shapeType === "image" || element.shapeType === "fashion-image") &&
    element.role.includes("style_ref")
  );
}

function extractedTerms(
  extracted: unknown,
  key: "keywords" | "silhouettes",
): string[] {
  return stringTerms(objectValue(extracted)[key]);
}

function stringTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_TERMS_PER_FIELD)
    .flatMap((term) => {
      const cleaned = cleanTerm(term);
      return cleaned ? [cleaned] : [];
    });
}

function cleanTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^\p{L}\p{M}\p{N} ._+'’&/-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return cleaned || null;
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
