import { type PrismaClient } from "@fashion/db";
import { Inject, Injectable } from "@nestjs/common";

export const TRENDS_DB = Symbol("TRENDS_DB");

type TrendsDatabase = Pick<PrismaClient, "trendItem" | "trendDigest">;

@Injectable()
export class TrendsService {
  constructor(
    @Inject(TRENDS_DB) private readonly database: TrendsDatabase,
  ) {}

  async listTrends(limit: number, page: number) {
    const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 60, 1), 200);
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
      items,
      total,
      page: safePage,
      limit: safeLimit,
      hasMore: skip + items.length < total,
    };
  }

  async getCurrentDigest() {
    const digest = await this.database.trendDigest.findFirst({
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
