"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { ImageComparison } from "../workflow/ImageComparison";

import { fetchAssetVersions, restoreAssetVersion } from "./generation-api";
import type { DesignAssetVersion } from "./generation-types";
import styles from "./generation.module.css";

const OPERATION_LABEL: Record<DesignAssetVersion["operation"], string> = {
  transform: "图片调整",
  remove_background: "移除背景",
  erase: "智能擦除",
  outpaint: "AI 扩图",
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
  onRestoreRequest,
  disabled = false,
  readOnly = false,
  onComparisonChange,
}: {
  readonly assetId: string;
  readonly onRestore?: (asset: DesignAssetVersion) => Promise<void> | void;
  readonly onRestoreRequest?: (target: DesignAssetVersion) => Promise<void>;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly onComparisonChange?: ((comparing: boolean) => void) | undefined;
  readonly onRestoreStart?: () => void;
  readonly onRestoreEnd?: () => void;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<DesignAssetVersion | null>(null);
  useEffect(() => { onComparisonChange?.(comparison !== null); }, [comparison, onComparisonChange]);
  useEffect(() => () => onComparisonChange?.(false), [onComparisonChange]);
  const root = useRef<HTMLElement>(null);
  const restoreLock = useRef(false);
  const scope = useDraftScope();
  const restoreRequests = useRef(new Map<string, string>());
  const timeline = useInfiniteQuery({
    queryKey: ["design-asset-versions", scope?.accountId, assetId],
    queryFn: ({ pageParam, signal }) => fetchAssetVersions(assetId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
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
    if (readOnly || target.id === assetId || disabled || restoreLock.current) return;
    restoreLock.current = true;
    setRestoringId(target.id);
    setRestoreError(null);
    onRestoreStart?.();
    try {
      if (onRestoreRequest) {
        await onRestoreRequest(target);
        return;
      }
      const requestKey = `${assetId}:${target.id}`;
      const storageKey = `fashion-restore-request:${scope?.accountId ?? "legacy"}:${requestKey}`;
      let persistedRequest: string | null = null;
      try { persistedRequest = sessionStorage.getItem(storageKey); } catch { /* In-memory retry remains available. */ }
      const requestId = restoreRequests.current.get(requestKey) ?? persistedRequest ?? crypto.randomUUID();
      restoreRequests.current.set(requestKey, requestId);
      try { sessionStorage.setItem(storageKey, requestId); } catch { /* In-memory retry remains available. */ }
      const restored = await restoreAssetVersion(target.id, assetId, requestId);
      await onRestore?.(restored);
      restoreRequests.current.delete(requestKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* Restore is already committed. */ }
    } catch (cause) {
      setRestoreError(cause instanceof Error ? cause.message : "版本恢复失败");
    } finally {
      restoreLock.current = false;
      setRestoringId(null);
      onRestoreEnd?.();
    }
  };

  if (comparison) return <div className={styles.versionComparison}>
    {restoreError ? <p role="alert" className={styles.versionInlineError}>{restoreError}</p> : null}
    <ImageComparison
      history
      compactHeader={readOnly}
      current={{ id: assetId, title: "当前版本" }}
      choices={[{ id: comparison.id, title: `${OPERATION_LABEL[comparison.operation]} ${new Date(comparison.createdAt).toLocaleDateString("zh-CN")}` }]}
      busy={restoringId !== null || disabled}
      onClose={() => {
        const targetId = comparison.id;
        setComparison(null);
        requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-version-compare="${CSS.escape(targetId)}"]`)?.focus());
      }}
      {...(!readOnly ? { onRestore: () => void restore(comparison) } : {})}
    />
  </div>;

  return (
    <section ref={root} className={styles.versionTimeline} aria-label="版本时间线">
      <header>
        <div>
          <h3>版本历史</h3>
        </div>
        {!readOnly ? <p>恢复会创建新版本，当前记录不会被覆盖。</p> : null}
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
                  <div className={styles.versionActions}>
                  {!current ? <button data-version-compare={version.id} disabled={restoringId !== null || disabled} onClick={() => { setRestoreError(null); setComparison(version); }} type="button">对比当前版本</button> : null}
                  {readOnly ? current ? <span>当前版本</span> : null : <button
                    disabled={current || restoringId !== null || disabled}
                    onClick={() => void restore(version)}
                    type="button"
                  >
                    {current
                      ? "当前版本"
                      : restoringId === version.id
                        ? "恢复中…"
                        : "恢复此版"}
                  </button>}
                  </div>
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
