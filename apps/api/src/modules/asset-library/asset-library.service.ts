import { Prisma, type PrismaClient } from "@fashion/db";
import {
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  privateStorageObjectKey,
  type LibraryAsset,
  type LibraryAssetDomain,
  type LibraryAssetPage,
} from "@fashion/shared";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import {
  assetBoundary,
  assetFilter,
  assetLibraryCte,
  assetOrder,
} from "./asset-library-query";
import {
  assetFilterKey,
  decodeAssetCursor,
  type AssetQuery,
} from "./asset-library.schemas";

export const ASSET_LIBRARY_DB = Symbol("ASSET_LIBRARY_DB");
interface AssetRow {
  domain: LibraryAssetDomain;
  resource_id: string;
  kind: LibraryAsset["kind"];
  source: LibraryAsset["source"];
  title: string;
  created_at: Date;
  project_ids: string[];
  archived: boolean;
  status: LibraryAsset["status"];
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: bigint | null;
  expires_at: Date | null;
  object_key: string | null;
  source_href: string | null;
  rating: number | null;
}
@Injectable()
export class AssetLibraryService {
  constructor(
    @Inject(ASSET_LIBRARY_DB) private readonly db: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
  ) {}

  async list(userId: string, query: AssetQuery): Promise<LibraryAssetPage> {
    const cursor = decodeAssetCursor(userId, query);
    const cte = Prisma.sql`${assetLibraryCte(userId)}, filtered AS (SELECT * FROM rated WHERE ${assetFilter(query)})`;
    const [rows, counts] = await this.db.$transaction(
      [
        this.db.$queryRaw<AssetRow[]>(
          Prisma.sql`${cte} SELECT * FROM filtered WHERE ${query.kind === "all" ? Prisma.sql`TRUE` : Prisma.sql`kind = ${query.kind}`} AND ${assetBoundary(query, cursor)} ORDER BY ${assetOrder(query)} LIMIT ${query.limit + 1}`,
        ),
        this.db.$queryRaw<{ kind: LibraryAsset["kind"]; count: bigint }[]>(
          Prisma.sql`${cte} SELECT kind, count(*) FROM filtered GROUP BY kind`,
        ),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const page = rows.slice(0, query.limit);
    const projects = await this.db.project.findMany({
      where: {
        AND: [
          this.access.readableWhere(userId),
          { id: { in: [...new Set(page.flatMap((row) => row.project_ids))] } },
        ],
      },
      select: { id: true, name: true, archived: true },
    });
    const items = page.flatMap((row) => {
      const related = projects.filter((project) =>
        row.project_ids.includes(project.id),
      );
      // A revoked project between projection and hydration must not leak metadata.
      const primary = related[0];
      if (!primary) return [];
      const base = `/api/assets/${row.domain}/${encodeURIComponent(row.resource_id)}`;
      const previewUrl =
        row.kind !== "image"
          ? null
          : row.domain === "asset"
            ? `/api/design-assets/${encodeURIComponent(row.resource_id)}/thumbnail`
            : row.domain === "file"
              ? `/api/files/${encodeURIComponent(row.resource_id)}/thumbnail/256`
              : `${base}/content`;
      return [
        {
          id: `${row.domain}:${row.resource_id}`,
          domain: row.domain,
          resourceId: row.resource_id,
          kind: row.kind,
          source: row.source,
          title: row.title,
          createdAt: row.created_at.toISOString(),
          projects: related,
          archived:
            row.archived || related.every((project) => project.archived),
          status: row.status,
          rating: row.rating,
          mimeType: row.mime_type,
          width: row.width,
          height: row.height,
          durationMs: row.duration_ms,
          sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
          expiresAt: row.expires_at?.toISOString() ?? null,
          previewUrl: row.status === "ready" ? previewUrl : null,
          contentUrl: row.status === "ready" ? `${base}/content` : null,
          sourceHref:
            row.domain === "file" ? `/${primary.id}` : row.source_href,
        },
      ];
    });
    const totals = { all: 0, image: 0, video: 0, audio: 0, document: 0 };
    for (const count of counts) {
      totals[count.kind] = Number(count.count);
      totals.all += Number(count.count);
    }
    const last = page.at(-1);
    return {
      items,
      counts: totals,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({
                account: userId,
                filter: assetFilterKey(query),
                date: last.created_at.toISOString(),
                domain: last.domain,
                id: last.resource_id,
                rating: last.rating,
              }),
            ).toString("base64url")
          : null,
    };
  }

  private async readable(
    userId: string,
    domain: LibraryAssetDomain,
    id: string,
  ) {
    const rows = await this.db.$queryRaw<AssetRow[]>(
      Prisma.sql`${assetLibraryCte(userId)} SELECT * FROM rated WHERE domain = ${domain} AND resource_id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("资产不存在或已无权访问。");
    return row;
  }

  async rate(
    userId: string,
    domain: LibraryAssetDomain,
    id: string,
    rating: number | null,
  ) {
    await this.readable(userId, domain, id);
    const where = { userId, domain, resourceId: id };
    if (rating === null) await this.db.assetRating.deleteMany({ where });
    else
      await this.db.assetRating.upsert({
        where: { userId_domain_resourceId: where },
        create: { ...where, rating },
        update: { rating },
      });
    return { rating };
  }

  async file(
    userId: string,
    domain: LibraryAssetDomain,
    id: string,
    attachment: boolean,
  ) {
    const row = await this.readable(userId, domain, id);
    if (
      row.status === "expired" ||
      (row.expires_at && row.expires_at.getTime() <= Date.now())
    )
      throw new GoneException("文件已过期，请回到来源重新导出。");
    if (row.status !== "ready" || !row.object_key)
      throw new NotFoundException("文件暂不可用，资产记录仍已保留。");
    const key =
      domain === "asset"
        ? privateStorageObjectKey(row.object_key, {
            endpoint: process.env.S3_ENDPOINT,
            bucket: process.env.S3_BUCKET,
            cdnOrigin: process.env.S3_CDN_ORIGIN,
          })
        : row.object_key;
    if (!key)
      throw new NotFoundException(
        "历史外部图片未保存到私有存储，暂不能读取原文件。",
      );
    let mimeType = row.mime_type;
    try {
      const head = await this.storage.head(key);
      if (head.contentLength < 1) throw new Error("Empty file");
      mimeType ??= head.contentType ?? null;
    } catch {
      throw new ServiceUnavailableException(
        "文件暂时无法读取，请重试；资产记录仍已保留。",
      );
    }
    const extension = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/avif": "avif",
      } as Record<string, string>
    )[mimeType ?? ""];
    const fileName =
      domain === "asset"
        ? `${row.title.replace(/[\\/\r\n]/gu, "-")}-${id}.${extension ?? "bin"}`
        : row.title;
    const expiry = row.expires_at
      ? Math.min(60, Math.floor((row.expires_at.getTime() - Date.now()) / 1000))
      : 60;
    if (expiry < 1) throw new GoneException("文件已过期，请回到来源重新导出。");
    return {
      url: await this.storage.createDownloadUrl(
        key,
        expiry,
        attachment ? fileName : undefined,
      ),
      fileName,
    };
  }
}
