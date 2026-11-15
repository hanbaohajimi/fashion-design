import { Prisma } from "@fashion/db";
import type { AssetCursor, AssetQuery } from "./asset-library.schemas";

/** One authorized projection shared by listing, rating and file signing. No per-project fan-out. */
export function assetLibraryCte(userId: string): Prisma.Sql {
  return Prisma.sql`WITH readable_projects AS (
    SELECT p.id, p.name, p.archived FROM projects p JOIN workspaces w ON w.id = p.ws_id
    WHERE p.deleted_at IS NULL AND (w.owner_id = ${userId} OR EXISTS (
      SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = ${userId}
    ))
  ), visible_assets AS (
    SELECT a.*, ds.intent FROM design_assets a JOIN readable_projects p ON p.id = a.project_id
    LEFT JOIN design_steps ds ON ds.output_asset_id = a.id LEFT JOIN generation_tasks gt ON gt.id = a.generation_task_id
    WHERE (ds.tool IS NULL OR ds.tool NOT IN ('wardrobe-material-mask', 'wardrobe-material-detail', 'wardrobe-correction-guide'))
      AND NOT COALESCE((gt.compiled_prompt->'notes') @> '["wardrobe-material-alpha-probe:v1"]'::jsonb, false)
  ), file_projects AS (
    SELECT source_file_id AS file_id, project_id FROM visible_assets WHERE source_file_id IS NOT NULL AND archived_at IS NULL
    UNION SELECT COALESCE(b.file_asset_id, b.record#>>'{props,fileId}'), b.project_id
      FROM board_elements b JOIN readable_projects p ON p.id = b.project_id WHERE b.deleted_at IS NULL
    UNION SELECT n.payload->>'fileAssetId', n.project_id FROM workflow_nodes n JOIN readable_projects p ON p.id = n.project_id
    UNION SELECT unnest(d.reference_file_ids), c.project_id FROM collection_dna d JOIN collections c ON c.id = d.collection_id JOIN readable_projects p ON p.id = c.project_id
    UNION SELECT f.main_file_id, n.project_id FROM workflow_nodes n JOIN readable_projects p ON p.id = n.project_id JOIN fabrics f ON f.id = n.payload->>'fabricId'
    UNION SELECT f.main_file_id, b.project_id FROM board_elements b JOIN readable_projects p ON p.id = b.project_id JOIN fabrics f ON f.id = b.record#>>'{props,fabricId}' WHERE b.deleted_at IS NULL
  ), library AS (
    SELECT 'asset'::text AS domain, a.id AS resource_id, 'image'::text AS kind,
      CASE WHEN a.operation = 'IMPORTED' THEN 'uploaded' ELSE 'generated' END AS source,
      COALESCE(NULLIF(left(a.intent,160),''), CASE a.operation::text WHEN 'IMPORTED' THEN '导入设计素材' WHEN 'VARIATION' THEN '设计变体' WHEN 'INPAINT' THEN '局部重绘' WHEN 'UPSCALE' THEN '高清放大' WHEN 'RESTORE' THEN '恢复版本' ELSE '生成设计' END) AS title,
      a.created_at, ARRAY[a.project_id]::text[] AS project_ids, a.archived_at IS NOT NULL AS archived,
      'ready'::text AS status, NULL::text AS mime_type, a.width, a.height, NULL::int AS duration_ms,
      NULL::bigint AS size_bytes, NULL::timestamp AS expires_at, a.url AS object_key,
      '/' || a.project_id || '/studio?tab=styles&assetId=' || a.id AS source_href
    FROM visible_assets a WHERE a.operation != 'IMPORTED' OR a.source_file_id IS NULL
    UNION ALL
    SELECT 'file', f.id, CASE WHEN f.mime_type LIKE 'image/%' THEN 'image' WHEN f.mime_type LIKE 'video/%' THEN 'video' WHEN f.mime_type LIKE 'audio/%' THEN 'audio' ELSE 'document' END,
      'uploaded', f.original_name, f.created_at, array_agg(DISTINCT fp.project_id ORDER BY fp.project_id), false,
      'ready', f.mime_type, f.width, f.height, NULL::int, f.size_bytes::bigint, NULL::timestamp, f.object_key, '/' || min(fp.project_id)
    FROM file_assets f JOIN file_projects fp ON fp.file_id = f.id WHERE f.status = 'READY' GROUP BY f.id
    UNION ALL
    SELECT 'runway', m.id, CASE WHEN m.mime_type LIKE 'video/%' THEN 'video' WHEN m.mime_type LIKE 'audio/%' THEN 'audio' ELSE 'image' END,
      CASE WHEN m.source->>'input' = 'true' THEN 'uploaded' ELSE 'generated' END,
      COALESCE(NULLIF(m.original_name,''), s.title), m.created_at, ARRAY[m.project_id]::text[], s.archived,
      'ready', m.mime_type, m.width, m.height, m.duration_ms, m.size_bytes::bigint, NULL::timestamp, m.object_key,
      '/' || m.project_id || '/studio?tab=runway&showId=' || s.id || '&runId=' || r.id
    FROM runway_media m JOIN readable_projects p ON p.id = m.project_id JOIN runway_runs r ON r.id = m.run_id JOIN runway_shows s ON s.id = r.show_id
    UNION ALL
    SELECT 'export', e.id, CASE WHEN e.format = 'PDF' THEN 'document' ELSE 'image' END, 'exported',
      COALESCE(e.file_name, e.format::text || ' 导出文件'), e.created_at, ARRAY[e.project_id]::text[], false,
      CASE WHEN e.status = 'EXPIRED' OR e.expires_at <= CURRENT_TIMESTAMP THEN 'expired' WHEN e.object_key IS NULL OR e.expires_at IS NULL OR e.file_name IS NULL THEN 'unavailable' ELSE 'ready' END,
      e.mime_type, NULL::int, NULL::int, NULL::int, e.size_bytes::bigint, e.expires_at, e.object_key,
      CASE WHEN d.id IS NOT NULL THEN '/' || e.project_id || '/studio?tab=' || CASE WHEN d.type = 'TECH_PACK' THEN 'tech' ELSE 'presentation' END || '&documentId=' || d.document_id || '&documentRevisionId=' || d.id || CASE WHEN d.style_revision_id IS NULL THEN '' ELSE '&styleRevisionId=' || d.style_revision_id END
        WHEN e.design_asset_id IS NOT NULL THEN '/' || e.project_id || '/studio?tab=styles&assetId=' || e.design_asset_id
        WHEN e.collection_id IS NOT NULL THEN '/' || e.project_id || '?collectionId=' || e.collection_id ELSE NULL END
    FROM export_jobs e JOIN readable_projects p ON p.id = e.project_id LEFT JOIN studio_documents d ON d.id = e.studio_revision_id
    WHERE e.status IN ('SUCCEEDED', 'EXPIRED')
  ), rated AS (
    SELECT l.*, r.rating FROM library l LEFT JOIN asset_ratings r ON r.user_id = ${userId} AND r.domain = l.domain AND r.resource_id = l.resource_id
  )`;
}

export function assetFilter(query: AssetQuery): Prisma.Sql {
  const search = `%${query.q.replace(/[\\%_]/gu, (value) => `\\${value}`)}%`;
  return Prisma.sql`${query.source === "all" ? Prisma.sql`TRUE` : Prisma.sql`source = ${query.source}`}
    AND ${query.rating === "all" ? Prisma.sql`TRUE` : query.rating === "unrated" ? Prisma.sql`rating IS NULL` : Prisma.sql`rating = ${Number(query.rating)}`}
    AND ${!query.q ? Prisma.sql`TRUE` : Prisma.sql`(title ILIKE ${search} OR resource_id ILIKE ${search} OR EXISTS (SELECT 1 FROM readable_projects p WHERE p.id = ANY(project_ids) AND p.name ILIKE ${search}))`}`;
}

export function assetOrder(query: AssetQuery): Prisma.Sql {
  if (query.sort === "rating-desc")
    return Prisma.sql`rating DESC NULLS LAST, created_at DESC, domain DESC, resource_id DESC`;
  if (query.sort === "rating-asc")
    return Prisma.sql`rating ASC NULLS LAST, created_at DESC, domain DESC, resource_id DESC`;
  return query.sort === "oldest"
    ? Prisma.sql`created_at ASC, domain DESC, resource_id DESC`
    : Prisma.sql`created_at DESC, domain DESC, resource_id DESC`;
}

export function assetBoundary(
  query: AssetQuery,
  cursor: AssetCursor | null,
): Prisma.Sql {
  if (!cursor) return Prisma.sql`TRUE`;
  const time = new Date(cursor.date);
  const tie = Prisma.sql`(created_at = ${time} AND (domain < ${cursor.domain} OR (domain = ${cursor.domain} AND resource_id < ${cursor.id})))`;
  const nextTime =
    query.sort === "oldest"
      ? Prisma.sql`created_at > ${time}`
      : Prisma.sql`created_at < ${time}`;
  const chronological = Prisma.sql`(${nextTime} OR ${tie})`;
  if (!query.sort.startsWith("rating-")) return chronological;
  if (cursor.rating === null)
    return Prisma.sql`rating IS NULL AND ${chronological}`;
  const nextRating =
    query.sort === "rating-asc"
      ? Prisma.sql`rating > ${cursor.rating}`
      : Prisma.sql`rating < ${cursor.rating}`;
  return Prisma.sql`(rating IS NULL OR ${nextRating} OR (rating = ${cursor.rating} AND ${chronological}))`;
}
