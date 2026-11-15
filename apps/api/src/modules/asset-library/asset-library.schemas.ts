import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const assetDomainSchema = z.enum(["asset", "file", "runway", "export"]);
export const assetQuerySchema = z
  .object({
    kind: z.enum(["all", "image", "video", "audio", "document"]).default("all"),
    source: z.enum(["all", "generated", "uploaded", "exported"]).default("all"),
    rating: z.enum(["all", "unrated", "1", "2", "3", "4", "5"]).default("all"),
    sort: z
      .enum(["newest", "oldest", "rating-desc", "rating-asc"])
      .default("newest"),
    q: z.string().trim().max(120).default(""),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type AssetQuery = z.infer<typeof assetQuerySchema>;
const cursorSchema = z
  .object({
    account: z.string(),
    filter: z.string(),
    date: z.iso.datetime(),
    domain: assetDomainSchema,
    id: z.string().min(1).max(256),
    rating: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
export type AssetCursor = z.infer<typeof cursorSchema>;
export const assetFilterKey = (query: AssetQuery) =>
  JSON.stringify([query.kind, query.source, query.rating, query.sort, query.q]);
export function decodeAssetCursor(
  userId: string,
  query: AssetQuery,
): AssetCursor | null {
  if (!query.cursor) return null;
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
    );
    if (cursor.account !== userId || cursor.filter !== assetFilterKey(query))
      throw new Error("Cursor scope changed");
    return cursor;
  } catch {
    throw new BadRequestException("资产分页信息已失效，请重新加载列表。");
  }
}
