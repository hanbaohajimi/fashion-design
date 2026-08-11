export type FabricScope = "preset" | "user";

export interface FabricCompositionItem {
  readonly name?: string;
  readonly percentage?: number;
}

export interface FabricAttributes {
  readonly composition?:
    | Readonly<Record<string, number>>
    | readonly FabricCompositionItem[];
  readonly drape?: string | number;
  readonly season?: string | readonly string[];
  readonly seasonSuggestion?: string | readonly string[];
  readonly stretch?: string | number;
  readonly weave?: string;
  readonly weight?: number;
  readonly [key: string]: unknown;
}

export interface Fabric {
  readonly attributes: FabricAttributes;
  readonly category: string;
  readonly createdAt: string;
  readonly id: string;
  readonly mainFileId: string;
  readonly mainImageUrl: string;
  readonly name: string;
  readonly scope: FabricScope;
  readonly subCategory: string | null;
  readonly updatedAt: string;
}

export interface FabricListPage {
  readonly items: readonly Fabric[];
  readonly limit: number;
  readonly page: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface FabricListQuery {
  readonly category?: string;
  readonly composition?: string;
  readonly limit?: number;
  readonly maxWeight?: number;
  readonly minWeight?: number;
  readonly page?: number;
  readonly scope?: "all" | FabricScope;
  readonly search?: string;
  readonly season?: string;
}

export function getCompositionEntries(
  attributes: FabricAttributes,
): readonly (readonly [string, number])[] {
  const composition = attributes.composition;
  if (Array.isArray(composition)) {
    return composition.flatMap((item) => {
      if (
        typeof item?.name !== "string" ||
        typeof item.percentage !== "number"
      ) {
        return [];
      }
      return [[item.name, item.percentage] as const];
    });
  }
  if (composition && typeof composition === "object") {
    return Object.entries(composition).flatMap(([name, percentage]) =>
      typeof percentage === "number"
        ? ([[name, percentage]] as const)
        : [],
    );
  }
  return [];
}

export function formatFabricComposition(
  attributes: FabricAttributes,
  limit = 2,
): string {
  return getCompositionEntries(attributes)
    .slice(0, limit)
    .map(([name, percentage]) => {
      const normalizedName = name.trim();
      return /\d+(?:\.\d+)?\s*%/u.test(normalizedName)
        ? normalizedName
        : `${normalizedName} ${percentage}%`;
    })
    .join(" · ");
}

export const FABRIC_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  blend: "混纺",
  cotton: "棉",
  silk: "真丝",
  synthetic: "化纤",
  wool: "羊毛",
};

export const FABRIC_WEAVE_LABELS: Readonly<Record<string, string>> = {
  jacquard: "提花",
  knit: "针织",
  plain: "平纹",
  satin: "缎纹",
  twill: "斜纹",
};

export const FABRIC_SEASON_LABELS: Readonly<Record<string, string>> = {
  autumn: "秋",
  spring: "春",
  summer: "夏",
  winter: "冬",
};

export const FABRIC_STRETCH_LABELS: Readonly<Record<string, string>> = {
  high: "高弹",
  none: "无弹",
  slight: "微弹",
};

export const FABRIC_OPACITY_LABELS: Readonly<Record<string, string>> = {
  opaque: "不透",
  semi: "半透",
  sheer: "透明",
};

/** Ordinal handfeel scales. `level` is the position on the scale, so the
 * lowest value still fills one step instead of reading as missing data. */
const DRAPE_SCALE: Readonly<Record<string, { label: string; level: number }>> = {
  fluid: { label: "流动", level: 3 },
  moderate: { label: "适中", level: 2 },
  stiff: { label: "挺阔", level: 1 },
};

const STRETCH_SCALE: Readonly<Record<string, { label: string; level: number }>> =
  {
    high: { label: FABRIC_STRETCH_LABELS.high ?? "高弹", level: 3 },
    none: { label: FABRIC_STRETCH_LABELS.none ?? "无弹", level: 1 },
    slight: { label: FABRIC_STRETCH_LABELS.slight ?? "微弹", level: 2 },
  };

export const FABRIC_METRIC_STEPS = 3;

export interface FabricMetric {
  /** Localised value, e.g. 流动 */
  readonly label: string;
  readonly level: number;
  /** Localised property name, e.g. 垂坠 */
  readonly name: string;
}

function readScale(
  scale: Readonly<Record<string, { label: string; level: number }>>,
  value: string | number | undefined,
  name: string,
): FabricMetric | null {
  if (typeof value !== "string") return null;
  const entry = scale[value];
  return entry ? { label: entry.label, level: entry.level, name } : null;
}

/** The two properties a designer judges a silhouette against. Absent
 * attributes are omitted so the card never renders an empty gauge. */
export function getFabricMetrics(
  attributes: FabricAttributes,
): readonly FabricMetric[] {
  return [
    readScale(DRAPE_SCALE, attributes.drape, "垂坠"),
    readScale(STRETCH_SCALE, attributes.stretch, "弹力"),
  ].filter((metric): metric is FabricMetric => metric !== null);
}

export function getFabricSeasons(attributes: FabricAttributes): readonly string[] {
  const value = attributes.seasonSuggestion ?? attributes.season;
  if (Array.isArray(value)) {
    return value.filter((season): season is string => typeof season === "string");
  }
  return typeof value === "string" ? [value] : [];
}
