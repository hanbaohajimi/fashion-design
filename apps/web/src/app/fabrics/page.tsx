"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "../../components/AppHeader";
import controls from "../../components/ui.module.css";
import { Button, Notice, Skeleton, SkeletonGroup } from "../../components/ui";
import { useSearchQuery } from "../../modules/projects/use-search-query";
import { addFabricToProject } from "../../modules/fabrics/add-fabric-to-project";
import { userFacingError } from "../../components/user-facing-error";
import { Suspense, useEffect, useRef, useState } from "react";

import { useFabrics } from "../../modules/fabrics/fabric-api";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import { FabricUploadPanel } from "../../modules/fabrics/FabricCard";
import { FabricStructuredFilters } from "../../modules/fabrics/FabricStructuredFilters";
import type {
  Fabric,
  FabricListQuery,
  FabricScope,
} from "../../modules/fabrics/fabric-types";
import styles from "../../modules/fabrics/fabrics.module.css";

type FabricScopeFilter = "all" | FabricScope;

const FABRIC_SCOPE_OPTIONS: readonly {
  readonly label: string;
  readonly value: FabricScopeFilter;
}[] = [
  { label: "全部", value: "all" },
  { label: "系统内置", value: "preset" },
  { label: "用户上传", value: "user" },
];

export default function FabricsPage() {
  return (
    <Suspense fallback={<main>正在加载面料库…</main>}>
      <FabricLibrary />
    </Suspense>
  );
}

function FabricLibrary() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FabricListQuery>({});
  const hasFilters = Object.keys(filters).length > 0;
  const params = useSearchParams();
  const projectId =
    params.get("from") === "board"
      ? params.get("boardId") || undefined
      : undefined;
  const [scope, setScope] = useState<FabricScopeFilter>("all");
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const addFlight = useRef(false);
  const nodeIds = useRef(new Map<string, string>());
  const add = async (fabric: Fabric) => {
    if (!projectId || addFlight.current) return;
    addFlight.current = true;
    setAdding(fabric.id);
    setAddError(null);
    setAdded(false);
    const nodeId = nodeIds.current.get(fabric.id) ?? crypto.randomUUID();
    nodeIds.current.set(fabric.id, nodeId);
    try {
      await addFabricToProject(projectId, fabric, nodeId);
      setAdded(true);
    } catch (cause) {
      setAddError(userFacingError(cause, "面料未能加入项目，请重试"));
    } finally {
      addFlight.current = false;
      setAdding(null);
    }
  };
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchState = useSearchQuery(search);
  const deferredSearch = searchState.query;
  const fabrics = useFabrics({
    ...filters,
    scope,
    search: deferredSearch,
  });

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      const searchInput = searchInputRef.current;

      if (!searchInput) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }

      if (event.key === "Escape" && document.activeElement === searchInput) {
        if (search) {
          setSearch("");
        } else {
          searchInput.blur();
        }
      }
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [search]);

  return (
    <>
      <AppHeader current="fabrics" projectId={projectId} />
      <main
        className={`${styles.libraryPage} ${controls.controlSurface}`}
        data-guide-page="fabrics"
        data-guide-ready={!fabrics.isLoading && !fabrics.error ? "true" : "false"}
      >
        <header className={styles.libraryHeader}>
          <div className={styles.libraryIdentity}>
            <Link
              aria-label={projectId ? "返回设计画布" : "返回项目库"}
              href={projectId ? `/${encodeURIComponent(projectId)}` : "/"}
            >
              <span aria-hidden="true">←</span>
              {projectId ? "返回设计画布" : "项目库"}
            </Link>
            <span aria-hidden="true" className={styles.headerDivider} />
            <div>
              <h1>面料库</h1>
              <span>
                {fabrics.isLoading ? "加载中" : `${fabrics.total} 项面料`}
              </span>
            </div>
          </div>
          <div className={styles.searchWrap}>
            <label htmlFor="fabric-search">搜索面料</label>
            <input
              aria-keyshortcuts="Control+K Meta+K"
              id="fabric-search"
              onChange={(event) => setSearch(event.currentTarget.value)}
              onCompositionStart={searchState.onCompositionStart}
              onCompositionEnd={searchState.onCompositionEnd}
              placeholder="搜索标签、面料名称、编号或供应商…"
              ref={searchInputRef}
              type="search"
              value={search}
            />
            {search ? (
              <button
                aria-label="清空面料搜索"
                className={styles.searchClear}
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.libraryTools}>
          <details className={styles.uploadDisclosure}>
            <summary>上传面料</summary>
            <FabricUploadPanel onUploaded={() => fabrics.refresh()} />
          </details>
          <FabricStructuredFilters onApply={setFilters} />
        </div>
        {addError ? <Notice tone="error">{addError}</Notice> : null}
        {fabrics.error && fabrics.items.length > 0 ? (
          <Notice tone="error">
            面料刷新失败，已保留上次读取的资料。
            <button type="button" onClick={fabrics.refresh}>
              重新加载
            </button>
          </Notice>
        ) : null}
        {added && projectId ? (
          <Notice tone="success">
            面料已在当前项目中。
            <Link href={`/${encodeURIComponent(projectId)}`}>
              返回工作台查看
            </Link>
          </Notice>
        ) : null}
        <div className={styles.libraryBody}>
          <section className={styles.archivePanel} aria-label="面料列表">
            <div className={styles.resultMeta}>
              <nav aria-label="面料分类" className={styles.scopeTabs}>
                {FABRIC_SCOPE_OPTIONS.map((option) => (
                  <button
                    aria-pressed={scope === option.value}
                    key={option.value}
                    onClick={() => setScope(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </nav>
              <p aria-live="polite" role="status">
                {searchState.pending || fabrics.isSearching ? "正在搜索，暂显示上次结果…" : fabrics.isPreviousData ? `仍显示上次结果，共 ${fabrics.total} 项` : deferredSearch
                  ? `“${deferredSearch}”找到 ${fabrics.total} 项`
                  : projectId
                    ? "选择面料，加入当前设计项目"
                    : "选择面料查看图片与规格"}
              </p>
            </div>
            {fabrics.isLoading && !fabrics.items.length ? (
              <div
                aria-label="正在读取面料档案"
                role="status"
              ><SkeletonGroup className={styles.librarySkeletons ?? ""}>
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton
                    key={index}
                    label="正在加载面料"
                    className={styles.librarySkeleton}
                  />
                ))}
              </SkeletonGroup></div>
            ) : fabrics.error && !fabrics.items.length ? (
              <div className={styles.libraryState} data-error>
                <p role="alert">
                  {userFacingError(fabrics.error, "面料暂时无法加载，请重试")}
                </p>
                <Button loading={fabrics.isLoading} onClick={fabrics.refresh} type="button">
                  重新加载
                </Button>
              </div>
            ) : fabrics.items.length === 0 ? (
              <div className={styles.libraryState}>
                <p>
                  {deferredSearch
                    ? `没有匹配“${deferredSearch}”的面料。`
                    : hasFilters
                      ? "没有符合当前规格的面料，可调整或重置筛选。"
                      : "面料档案还是空的，可先上传第一块面料。"}
                </p>
                {deferredSearch ? (
                  <button
                    onClick={() => {
                      setSearch("");
                      searchInputRef.current?.focus();
                    }}
                    type="button"
                  >
                    清空搜索
                  </button>
                ) : null}
              </div>
            ) : (
              <FabricVirtualGrid
                fabrics={fabrics.items}
                scrollMode="window"
                onAdd={projectId ? (fabric) => void add(fabric) : undefined}
                addingId={adding}
                onChanged={fabrics.refresh}
                onNearEnd={fabrics.loadMore}
              />
            )}
            {fabrics.isLoadingMore ? (
              <p className={styles.loadingMore}>正在加载更多…</p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
