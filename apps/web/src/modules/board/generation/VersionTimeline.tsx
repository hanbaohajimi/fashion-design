"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { fetchAssetVersions, restoreAssetVersion } from "./generation-api";
import type { DesignAssetVersion } from "./generation-types";
import styles from "./generation.module.css";

const OPERATION_LABEL: Record<DesignAssetVersion["operation"], string> = {
  generated: "初次生成",
  imported: "素材导入",
  variation: "设计变体",
  inpaint: "局部重绘",
  upscale: "高清放大",
  restore: "版本恢复",
};

export function VersionTimeline({
  assetId,
  onRestore,
  onRestoreStart,
  onRestoreEnd,
}: {
  readonly assetId: string;
  readonly onRestore: (asset: DesignAssetVersion) => Promise<void> | void;
  readonly onRestoreStart?: () => void;
  readonly onRestoreEnd?: () => void;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreRequests = useRef(new Map<string, string>());
  const timeline = useInfiniteQuery({
    queryKey: ["design-asset-versions", assetId],
    queryFn: ({ pageParam }) => fetchAssetVersions(assetId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const versions = timeline.data?.pages.flatMap((page) => page.items) ?? [];
  const queryError =
    timeline.error instanceof Error
      ? timeline.error.message
      : timeline.error
        ? "版本历史读取失败"
        : null;
  const error = restoreError ?? queryError;

  const restore = async (target: DesignAssetVersion): Promise<void> => {
    if (target.id === assetId) return;
    setRestoringId(target.id);
    setRestoreError(null);
    onRestoreStart?.();
    try {
      const requestKey = `${assetId}:${target.id}`;
      const storageKey = `fashion-restore-request:${requestKey}`;
      let persistedRequest: string | null = null;
      try { persistedRequest = sessionStorage.getItem(storageKey); } catch { /* In-memory retry remains available. */ }
      const requestId = restoreRequests.current.get(requestKey) ?? persistedRequest ?? crypto.randomUUID();
      restoreRequests.current.set(requestKey, requestId);
      try { sessionStorage.setItem(storageKey, requestId); } catch { /* In-memory retry remains available. */ }
      const restored = await restoreAssetVersion(target.id, assetId, requestId);
      await onRestore(restored);
      restoreRequests.current.delete(requestKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* Restore is already committed. */ }
    } catch (cause) {
      setRestoreError(cause instanceof Error ? cause.message : "版本恢复失败");
    } finally {
      setRestoringId(null);
      onRestoreEnd?.();
    }
  };

  return (
    <section className={styles.versionTimeline} aria-label="版本时间线">
      <header>
        <div>
          <h3>版本历史</h3>
        </div>
        <p>恢复会创建新版本，当前记录不会被覆盖。</p>
      </header>
      {timeline.isPending ? (
        <div className={styles.versionSkeleton} aria-label="正在读取版本历史">
          <i />
          <i />
          <i />
        </div>
      ) : error && versions.length === 0 ? (
        <div className={styles.versionEmpty} role="alert">
          <strong>版本历史暂不可用</strong>
          <p>{error}</p>
          <button onClick={() => void timeline.refetch()} type="button">
            重新读取
          </button>
        </div>
      ) : versions.length === 0 ? (
        <div className={styles.versionEmpty}>
          <strong>尚无可展示的版本</strong>
          <p>完成一次生成、局部重绘或变体后，历史会出现在这里。</p>
        </div>
      ) : (
        <>
          <ol>
            {versions.map((version, index) => {
              const current = version.id === assetId;
              return (
                <li key={version.id}>
                  <div className={styles.versionRail}>
                    <i />
                    <span>{(index + 1).toString().padStart(2, "0")}</span>
                  </div>
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`${OPERATION_LABEL[version.operation]}版本缩略图`}
                      src={version.thumbnailUrl ?? version.url}
                    />
                  </figure>
                  <div className={styles.versionMeta}>
                    <strong>{OPERATION_LABEL[version.operation]}</strong>
                    <time dateTime={version.createdAt}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(version.createdAt))}
                    </time>
                    {version.archivedAt ? <small>已归档</small> : null}
                  </div>
                  <button
                    disabled={current || restoringId !== null}
                    onClick={() => void restore(version)}
                    type="button"
                  >
                    {current
                      ? "当前版本"
                      : restoringId === version.id
                        ? "恢复中…"
                        : "恢复此版"}
                  </button>
                </li>
              );
            })}
          </ol>
          {error ? <p className={styles.versionInlineError}>{error}</p> : null}
          {timeline.hasNextPage ? (
            <button
              className={styles.versionMore}
              disabled={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
              type="button"
            >
              {timeline.isFetchingNextPage ? "正在加载…" : "加载更多版本"}
            </button>
          ) : (
            <p className={styles.versionEnd}>已显示完整资产链</p>
          )}
        </>
      )}
    </section>
  );
}
