export type TrendCategory = "accessories" | "men" | "women";
export type TrendPlatform =
  | "businessoffashion.com"
  | "fashionunited.com"
  | "highsnobiety.com"
  | "hypebeast.com"
  | "pinterest.com"
  | "ssense.com"
  | "vogue.com"
  | "wwd.com";

export interface TrendExtracted {
  readonly fabricMentions: readonly string[];
  readonly keyColors: readonly string[];
  readonly keywords: readonly string[];
  readonly silhouettes: readonly string[];
}

export interface TrendItem {
  readonly category: TrendCategory | string;
  readonly coverImageUrl: string | null;
  readonly curatedAt: string;
  readonly extracted: TrendExtracted | null;
  readonly id: string;
  readonly platform: TrendPlatform | string;
  readonly publishedAt: string | null;
  readonly sourceUrl: string;
  readonly status: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface TrendDigest {
  readonly createdAt: string;
  readonly id: string;
  readonly itemIds: readonly string[];
  readonly overview: string;
  readonly period: string;
  readonly theme: string;
}

export interface TrendListPage {
  readonly hasMore: boolean;
  readonly items: readonly TrendItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface ImportTrendResponse {
  readonly elements: readonly {
    readonly id: string;
    readonly record: Record<string, unknown>;
    readonly role: string;
    readonly shapeId: string;
    readonly shapeType: string;
  }[];
  readonly success: boolean;
}
