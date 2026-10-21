"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "../../components/AppHeader";
import controls from "../../components/ui.module.css";
import { Suspense, useDeferredValue, useEffect, useRef, useState } from "react";

import { useFabrics } from "../../modules/fabrics/fabric-api";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import { FabricUploadPanel } from "../../modules/fabrics/FabricCard";
import { FabricStructuredFilters } from "../../modules/fabrics/FabricStructuredFilters";
import type { FabricListQuery, FabricScope } from "../../modules/fabrics/fabric-types";
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

export default function FabricsPage() { return <Suspense fallback={<main>正在加载面料库…</main>}><FabricLibrary /></Suspense>; }

function FabricLibrary() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FabricListQuery>({});
  const params = useSearchParams();
  const projectId = params.get("from") === "board" ? params.get("boardId") || undefined : undefined;
  const [scope, setScope] = useState<FabricScopeFilter>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search.trim());
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
    <><AppHeader current="fabrics" projectId={projectId} /><main className={`${styles.libraryPage} ${controls.controlSurface}`}>
      <header className={styles.libraryHeader}>
        <div className={styles.libraryIdentity}>
          <Link aria-label="返回项目库" href={projectId ? `/${encodeURIComponent(projectId)}` : "/"}>
            <span aria-hidden="true">←</span>
            {projectId ? "返回设计工作室" : "项目库"}
          </Link>
          <span aria-hidden="true" className={styles.headerDivider} />
          <div>
            <h1>面料库</h1>
            <span>{fabrics.isLoading ? "加载中" : `${fabrics.total} 项面料`}</span>
          </div>
        </div>
        <div className={styles.searchWrap}>
          <label htmlFor="fabric-search">搜索面料</label>
          <input
            aria-keyshortcuts="Control+K Meta+K"
            id="fabric-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
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

      <details className={styles.uploadDisclosure}><summary>上传面料</summary><FabricUploadPanel onUploaded={() => fabrics.refresh()} /></details>

      <FabricStructuredFilters onApply={setFilters} />
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
              {deferredSearch
                ? `“${deferredSearch}”找到 ${fabrics.total} 项`
                : "拖拽面料图片可添加到白板"}
            </p>
          </div>
          {fabrics.isLoading ? (
            <div className={styles.libraryState}>
              <p>正在读取面料档案…</p>
            </div>
          ) : fabrics.error ? (
            <div className={styles.libraryState} data-error>
              <p>{fabrics.error.message}</p>
              <button onClick={fabrics.refresh} type="button">
                重新加载
              </button>
            </div>
          ) : fabrics.items.length === 0 ? (
            <div className={styles.libraryState}>
              <p>
                {deferredSearch
                  ? `没有匹配“${deferredSearch}”的面料。`
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
              height={680}
              onChanged={fabrics.refresh}
              onNearEnd={fabrics.loadMore}
            />
          )}
          {fabrics.isLoadingMore ? (
            <p className={styles.loadingMore}>正在加载更多…</p>
          ) : null}
        </section>
      </div>
    </main></>
  );
}
