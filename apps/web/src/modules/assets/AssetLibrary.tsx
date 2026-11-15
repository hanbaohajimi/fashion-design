"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  GeneratedFileKind,
  LibraryAsset,
  LibraryAssetPage,
} from "@fashion/shared";
import { AppHeader } from "../../components/AppHeader";
import {
  Button,
  ChoiceSelect,
  Dialog,
  Notice,
  Skeleton,
} from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { useSearchQuery } from "../projects/use-search-query";
import { useGuardedRouter } from "../use-guarded-router";
import {
  assetFilterParams,
  downloadLibraryAsset,
  fetchLibraryAssets,
  rateLibraryAsset,
  readAssetFilters,
  type AssetFilters,
} from "./asset-library-api";
import styles from "./assets.module.css";

const kinds = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "document", label: "文档" },
] as const;
const sources = [
  { value: "all", label: "全部来源" },
  { value: "generated", label: "生成结果" },
  { value: "uploaded", label: "上传参考" },
  { value: "exported", label: "交付文件" },
] as const;
const sorts = [
  { value: "newest", label: "最新优先" },
  { value: "oldest", label: "最早优先" },
  { value: "rating-desc", label: "评级从高到低" },
  { value: "rating-asc", label: "评级从低到高" },
] as const;
function Star() {
  return (
    <svg
      className={styles.star}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m12 2 3 6.5 7 .9-5.1 5 1.3 7.1-6.2-3.4-6.2 3.4 1.3-7.1L2 9.4l7-.9Z" />
    </svg>
  );
}
const stars = [1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: `${value} 星`,
  decoration: <Star />,
}));
const ratingFilters = [
  { value: "all", label: "所有评级" },
  { value: "unrated", label: "未评级" },
  ...stars,
];
const ratingOptions = [{ value: "unrated", label: "未评级" }, ...stars];

function FileIcon({ kind }: { kind: GeneratedFileKind }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === "video" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="m10 8 6 4-6 4Z" />
        </>
      ) : kind === "audio" ? (
        <>
          <path d="M9 17V5l11-2v12M9 8l11-2" />
          <ellipse cx="6" cy="18" rx="3" ry="2" />
          <ellipse cx="17" cy="16" rx="3" ry="2" />
        </>
      ) : kind === "document" ? (
        <>
          <path d="M5 2h9l5 5v15H5ZM14 2v6h5M9 12h6M9 16h6" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 18 6-6 4 4 3-3 5 5" />
        </>
      )}
    </svg>
  );
}
function AssetThumbnail({ asset }: { asset: LibraryAsset }) {
  const [failed, setFailed] = useState(false);
  return asset.previewUrl && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset.previewUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className={styles.filePlaceholder}>
      <FileIcon kind={asset.kind} />
      <span>
        {asset.status === "expired"
          ? "文件已过期"
          : failed
            ? "预览暂不可用"
            : kinds.find((kind) => kind.value === asset.kind)?.label}
      </span>
    </span>
  );
}
function AssetRating({
  asset,
  busy,
  onRate,
}: {
  asset: LibraryAsset;
  busy: boolean;
  onRate: (asset: LibraryAsset, rating: number | null) => void;
}) {
  return (
    <span data-asset-rating={asset.id}>
      <ChoiceSelect
        aria-label={`评级 ${asset.title}`}
        compact
        motionVariant="glide"
        value={asset.rating === null ? "unrated" : String(asset.rating)}
        options={ratingOptions}
        pending={busy}
        onValueChange={(value) =>
          onRate(asset, value === "unrated" ? null : Number(value))
        }
      />
    </span>
  );
}
export function AssetLibrary() {
  const { session, loading } = useAuth();
  if (loading || !session)
    return (
      <main className={styles.page}>
        <AppHeader current="assets" />
        <Skeleton label="正在加载资产库" />
      </main>
    );
  return (
    <AssetLibraryContent key={session.user.id} accountId={session.user.id} />
  );
}
function AssetLibraryContent({ accountId }: { accountId: string }) {
  const params = useSearchParams();
  const filters = readAssetFilters(params);
  const search = useSearchQuery(filters.q);
  const requestFilters = { ...filters, q: search.query };
  const client = useQueryClient();
  const router = useGuardedRouter();
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const flights = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  const ratingFocus = useRef<{
    trigger: HTMLButtonElement;
    id: string;
    index: number;
  } | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["asset-library", accountId, requestFilters],
    queryFn: ({ pageParam, signal }) =>
      fetchLibraryAssets(requestFilters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    alive.current = true;
    const activeFlights = flights.current;
    return () => {
      alive.current = false;
      activeFlights.forEach((flight) => flight.abort());
      activeFlights.clear();
    };
  }, []);
  const files = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((file) => [
        file.id,
        file,
      ]),
    ).values(),
  ];
  const counts = query.data?.pages[0]?.counts;
  useEffect(() => {
    const pending = ratingFocus.current;
    if (!pending || busy.has(pending.id)) return;
    const frame = requestAnimationFrame(() => {
      ratingFocus.current = null;
      if (document.activeElement !== document.body) return;
      if (pending.trigger.isConnected && !pending.trigger.disabled)
        pending.trigger.focus({ preventScroll: true });
      else {
        const previews = document.querySelectorAll<HTMLButtonElement>(
          "[data-asset-preview]",
        );
        const next =
          previews[Math.min(Math.max(0, pending.index), previews.length - 1)];
        (
          next ??
          document.querySelector<HTMLInputElement>('[aria-label="搜索资产"]')
        )?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, query.data]);
  const nextExpiry = Math.min(
    ...[...files, ...(selected ? [selected] : [])].flatMap((file) =>
      file.expiresAt && Date.parse(file.expiresAt) > now
        ? [Date.parse(file.expiresAt)]
        : [],
    ),
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now()) + 20),
    );
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  const expired = (asset: LibraryAsset) =>
    asset.status === "expired" ||
    Boolean(asset.expiresAt && Date.parse(asset.expiresAt) <= now);
  const changeFilter = (patch: Partial<AssetFilters>) => {
    const next = assetFilterParams({ ...filters, ...patch }).toString();
    // Let Next update useSearchParams; passing its internal history flags skips that update.
    window.history.replaceState(null, "", `/assets${next ? `?${next}` : ""}`);
  };
  const patchRating = (id: string, rating: number | null) => {
    client.setQueriesData<InfiniteData<LibraryAssetPage>>(
      { queryKey: ["asset-library", accountId] },
      (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === id ? { ...item, rating } : item,
                ),
              })),
            }
          : data,
    );
    setSelected((current) =>
      current?.id === id ? { ...current, rating } : current,
    );
  };
  const rate = async (asset: LibraryAsset, rating: number | null) => {
    if (flights.current.has(asset.id)) return;
    for (const root of document.querySelectorAll<HTMLElement>(
      `[data-asset-rating="${CSS.escape(asset.id)}"]`,
    )) {
      const trigger = root.querySelector<HTMLButtonElement>("button");
      const listId = trigger?.getAttribute("aria-controls");
      if (
        trigger &&
        (root.contains(document.activeElement) ||
          (listId &&
            document.getElementById(listId)?.contains(document.activeElement)))
      ) {
        ratingFocus.current = {
          trigger,
          id: asset.id,
          index: files.findIndex((file) => file.id === asset.id),
        };
      }
    }
    const controller = new AbortController();
    flights.current.set(asset.id, controller);
    setBusy(new Set(flights.current.keys()));
    setError(null);
    setNotice("");
    await client.cancelQueries({ queryKey: ["asset-library", accountId] });
    if (!alive.current) return;
    patchRating(asset.id, rating);
    try {
      await rateLibraryAsset(asset, rating, controller.signal);
      if (!alive.current) return;
      setNotice(rating === null ? "已清除个人评级" : `已保存 ${rating} 星评级`);
      // Refetch the existing infinite pages in order without unmounting the grid.
      await client.invalidateQueries({
        queryKey: ["asset-library", accountId],
      });
    } catch (cause) {
      if (!alive.current) return;
      patchRating(asset.id, asset.rating);
      setError(
        cause instanceof Error ? cause.message : "评级保存失败，请重试。",
      );
    } finally {
      flights.current.delete(asset.id);
      if (alive.current) setBusy(new Set(flights.current.keys()));
    }
  };
  const download = async (asset: LibraryAsset) => {
    if (flights.current.has("download")) return;
    const controller = new AbortController();
    flights.current.set("download", controller);
    setDownloadBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await downloadLibraryAsset(asset, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.fileName;
      link.rel = "noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
      setNotice("已交给浏览器下载，可在浏览器中查看进度。");
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "下载失败，请重试。");
    } finally {
      flights.current.delete("download");
      if (alive.current) setDownloadBusy(false);
    }
  };
  const filtered =
    filters.kind !== "all" ||
    filters.source !== "all" ||
    filters.rating !== "all" ||
    Boolean(filters.q);
  return (
    <main
      className={styles.page}
      data-guide-page="assets"
      data-guide-ready={query.isSuccess ? "true" : "false"}
    >
      <AppHeader current="assets" />
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 data-workspace-heading>资产库</h1>
          <label className={styles.search}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6.5" />
              <path d="m15 15 6 6" />
            </svg>
            <input
              type="search"
              aria-label="搜索资产"
              placeholder="搜索资产或项目名称"
              value={filters.q}
              maxLength={120}
              onChange={(event) => changeFilter({ q: event.target.value })}
              onCompositionStart={search.onCompositionStart}
              onCompositionEnd={search.onCompositionEnd}
            />
          </label>
        </header>
        <div className={styles.toolbar} data-guide="assets-filters">
          <div className={styles.typeTabs} role="group" aria-label="资产类型">
            {kinds.map((kind) => (
              <button
                type="button"
                key={kind.value}
                aria-pressed={filters.kind === kind.value}
                onClick={() => changeFilter({ kind: kind.value })}
              >
                <span>{kind.label}</span>
                <span className={styles.count}>
                  {counts?.[kind.value] ?? "—"}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.filters}>
            <ChoiceSelect
              aria-label="资产来源"
              compact
              motionVariant="glide"
              options={sources}
              value={filters.source}
              onValueChange={(source) =>
                changeFilter({ source: source as AssetFilters["source"] })
              }
            />
            <span data-guide="assets-rating">
              <ChoiceSelect
                aria-label="评级筛选"
                compact
                motionVariant="glide"
                options={ratingFilters}
                value={filters.rating}
                onValueChange={(rating) => changeFilter({ rating })}
              />
            </span>
            <ChoiceSelect
              aria-label="资产排序"
              compact
              motionVariant="glide"
              options={sorts}
              value={filters.sort}
              onValueChange={(sort) =>
                changeFilter({ sort: sort as AssetFilters["sort"] })
              }
            />
          </div>
        </div>
        {error && !selected ? (
          <Notice tone="error">
            {error}
            <Button onClick={() => setError(null)}>关闭</Button>
          </Notice>
        ) : null}
        {query.isError ? (
          <Notice tone="error">
            {query.isFetchNextPageError
              ? "下一页读取失败，已加载的资产仍保留。"
              : "资产读取失败，请重试。"}
            <Button
              onClick={() =>
                void (query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch())
              }
            >
              重新加载
            </Button>
          </Notice>
        ) : null}
        <div
          className={styles.grid}
          aria-label="资产列表"
          aria-busy={query.isFetching || search.pending}
        >
          {query.isPending
            ? Array.from({ length: 8 }, (_, index) => (
                <Skeleton
                  key={index}
                  className={styles.skeleton}
                  label="正在加载资产"
                />
              ))
            : files.map((asset) => (
                <article
                  key={asset.id}
                  className={styles.card}
                  data-asset-id={asset.id}
                >
                  <button
                    className={styles.preview}
                    type="button"
                    data-asset-preview={asset.id}
                    aria-label={`预览 ${asset.title}`}
                    onClick={() => {
                      setError(null);
                      setSelected(asset);
                    }}
                  >
                    <AssetThumbnail
                      key={`${asset.id}:${asset.previewUrl}`}
                      asset={asset}
                    />
                    <span className={styles.typeBadge}>
                      {kinds.find((kind) => kind.value === asset.kind)?.label}
                    </span>
                    {expired(asset) ? (
                      <span className={styles.expiredBadge}>已过期</span>
                    ) : null}
                  </button>
                  <div className={styles.cardInfo}>
                    <button
                      className={styles.cardTitle}
                      title={asset.title}
                      onClick={() => {
                        setError(null);
                        setSelected(asset);
                      }}
                    >
                      {asset.title}
                    </button>
                    <p
                      title={asset.projects
                        .map((project) => project.name)
                        .join("、")}
                    >
                      {asset.projects[0]?.name}
                      {asset.projects.length > 1
                        ? ` 等 ${asset.projects.length} 个项目`
                        : ""}
                      {asset.archived ? "（已归档）" : ""}
                    </p>
                    <div className={styles.cardFooter}>
                      <time dateTime={asset.createdAt}>
                        {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                      </time>
                      <AssetRating
                        asset={asset}
                        busy={busy.has(asset.id)}
                        onRate={(item, rating) => void rate(item, rating)}
                      />
                    </div>
                  </div>
                </article>
              ))}
        </div>
        {!query.isPending && !query.isError && !files.length ? (
          <section className={styles.empty}>
            <FileIcon kind="image" />
            <h2>{filtered ? "没有符合条件的资产" : "还没有设计资产"}</h2>
            <p>
              {filtered
                ? "试试其他关键词，或调整类型与评级。"
                : "项目中的生成结果、上传参考和交付文件都会出现在这里。"}
            </p>
            {filtered ? (
              <Button
                onClick={() =>
                  changeFilter({
                    kind: "all",
                    source: "all",
                    rating: "all",
                    q: "",
                  })
                }
              >
                清除筛选
              </Button>
            ) : (
              <Button onClick={() => void router.push("/")}>
                回到首页开始创作
              </Button>
            )}
          </section>
        ) : null}
        {query.hasNextPage ? (
          <div className={styles.more}>
            <Button
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更多资产
            </Button>
          </div>
        ) : null}
        <p role="status" className={styles.status}>
          {!selected ? notice : ""}
        </p>
      </div>
      {selected ? (
        <Dialog
          label={`资产预览 · ${selected.title}`}
          className={styles.dialog}
          returnFocusSelector={`[data-asset-preview="${CSS.escape(selected.id)}"]`}
          onClose={() => {
            flights.current.get("download")?.abort();
            setSelected(null);
            setError(null);
          }}
        >
          <header className={styles.previewHeader}>
            <h2>{selected.title}</h2>
            <Button
              onClick={() => {
                flights.current.get("download")?.abort();
                setSelected(null);
                setError(null);
              }}
            >
              关闭预览
            </Button>
          </header>
          <div className={styles.previewLayout}>
            <div className={styles.previewStage}>
              {expired(selected) || selected.status !== "ready" ? (
                <div className={styles.empty}>
                  <FileIcon kind={selected.kind} />
                  <p>
                    {expired(selected)
                      ? "文件已过期，资产记录和个人评级仍已保留。"
                      : "文件暂不可用，资产记录仍已保留。"}
                  </p>
                </div>
              ) : (
                <AssetContent key={selected.id} asset={selected} />
              )}
            </div>
            <aside className={styles.details}>
              <div>
                <h3>个人评级</h3>
                <AssetRating
                  asset={selected}
                  busy={busy.has(selected.id)}
                  onRate={(item, rating) => void rate(item, rating)}
                />
              </div>
              <dl>
                <div>
                  <dt>来源</dt>
                  <dd>
                    {
                      sources.find((source) => source.value === selected.source)
                        ?.label
                    }
                  </dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>
                    {new Date(selected.createdAt).toLocaleString("zh-CN")}
                  </dd>
                </div>
                {selected.width && selected.height ? (
                  <div>
                    <dt>尺寸</dt>
                    <dd>
                      {selected.width} × {selected.height}
                    </dd>
                  </div>
                ) : null}
                {selected.sizeBytes !== null ? (
                  <div>
                    <dt>文件大小</dt>
                    <dd>{(selected.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd>
                  </div>
                ) : null}
                {selected.durationMs !== null ? (
                  <div>
                    <dt>时长</dt>
                    <dd>{Math.round(selected.durationMs / 1000)} 秒</dd>
                  </div>
                ) : null}
              </dl>
              <div>
                <h3>关联项目</h3>
                {selected.projects.map((project) => (
                  <button
                    className={styles.projectLink}
                    key={project.id}
                    onClick={() => void router.push(`/${project.id}`)}
                  >
                    {project.name}
                    {project.archived ? "（已归档）" : ""}
                  </button>
                ))}
              </div>
              <div className={styles.detailActions}>
                <Button
                  variant="primary"
                  disabled={
                    downloadBusy ||
                    expired(selected) ||
                    selected.status !== "ready"
                  }
                  loading={downloadBusy}
                  onClick={() => void download(selected)}
                >
                  下载原文件
                </Button>
                {selected.sourceHref ? (
                  <Button
                    onClick={() => {
                      if (selected.sourceHref)
                        void router.push(selected.sourceHref);
                    }}
                  >
                    {expired(selected) ? "回到来源重新导出" : "查看来源"}
                  </Button>
                ) : (
                  <p>原来源已不可用，资产记录仍保留。</p>
                )}
              </div>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <p role="status" className={styles.status}>
                {notice}
              </p>
            </aside>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
function AssetContent({ asset }: { asset: LibraryAsset }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed)
    return (
      <div className={styles.empty} role="alert">
        <p>预览暂时无法读取。</p>
        <Button
          onClick={() => {
            setAttempt((value) => value + 1);
            setFailed(false);
          }}
        >
          重试预览
        </Button>
      </div>
    );
  const src = asset.contentUrl
    ? `${asset.contentUrl}${attempt ? `?retry=${attempt}` : ""}`
    : undefined;
  if (asset.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={attempt}
        src={src}
        alt={asset.title}
        onError={() => setFailed(true)}
      />
    );
  }
  if (asset.kind === "video")
    return (
      <video
        key={attempt}
        controls
        preload="metadata"
        src={src}
        aria-label={asset.title}
        onError={() => setFailed(true)}
      />
    );
  if (asset.kind === "audio")
    return (
      <div className={styles.audioPreview}>
        <FileIcon kind="audio" />
        <audio
          key={attempt}
          controls
          preload="metadata"
          src={src}
          aria-label={asset.title}
          onError={() => setFailed(true)}
        />
      </div>
    );
  return (
    <div className={styles.empty}>
      <FileIcon kind="document" />
      <p>{asset.title}</p>
      <p>下载文档后查看完整内容。</p>
    </div>
  );
}
