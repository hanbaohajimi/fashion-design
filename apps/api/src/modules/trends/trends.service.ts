import { type PrismaClient } from "@fashion/db";
import { Inject, Injectable } from "@nestjs/common";

export const TRENDS_DB = Symbol("TRENDS_DB");

type TrendsDatabase = Pick<PrismaClient, "trendItem" | "trendDigest">;

export interface TrendListResponse {
  readonly hasMore: boolean;
  readonly items: readonly {
    readonly category: string;
    readonly coverImageUrl: string | null;
    readonly curatedAt: Date | null;
    readonly extracted: unknown;
    readonly id: string;
    readonly platform: string;
    readonly publishedAt: Date;
    readonly sourceUrl: string;
    readonly summary: string;
    readonly tags: readonly string[];
    readonly title: string;
  }[];
  readonly pageSize: number;
  readonly page: number;
  readonly total: number;
}

@Injectable()
export class TrendsService {
  constructor(@Inject(TRENDS_DB) private readonly database: TrendsDatabase) {}

  async listTrends(limit: number, page: number): Promise<TrendListResponse> {
    const safeLimit = Math.min(
      Math.max(Number.isFinite(limit) ? limit : 60, 1),
      200,
    );
    const safePage = Math.max(Number.isFinite(page) ? page : 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.database.trendItem.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: safeLimit,
        skip,
        select: {
          id: true,
          title: true,
          summary: true,
          platform: true,
          sourceUrl: true,
          publishedAt: true,
          category: true,
          tags: true,
          extracted: true,
          curatedAt: true,
          coverFileId: true,
        },
      }),
      this.database.trendItem.count({ where: { status: "published" } }),
    ]);

    return {
      items: items.map(({ coverFileId, ...item }) => ({
        ...item,
        coverImageUrl: coverFileId
          ? `/api/boards/trend-assets/${encodeURIComponent(item.id)}`
          : null,
        status: "published",
      })),
      total,
      page: safePage,
      pageSize: safeLimit,
      hasMore: skip + items.length < total,
    };
  }

  async getCurrentDigest() {
    const digest = await this.database.trendDigest.findFirst({
      where: { period: isoWeekPeriod(new Date()) },
      orderBy: { createdAt: "desc" },
    });

    if (!digest) {
      return null;
    }

    return {
      id: digest.id,
      period: digest.period,
      theme: digest.theme,
      overview: digest.overview,
      itemIds: digest.itemIds,
      createdAt: digest.createdAt,
      updatedAt: digest.updatedAt,
    };
  }
}

function isoWeekPeriod(date: Date): string {
  const current = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((current.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
