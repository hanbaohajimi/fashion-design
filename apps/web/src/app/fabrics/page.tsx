"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { useFabrics } from "../../modules/fabrics/fabric-api";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import { FabricUploadPanel } from "../../modules/fabrics/FabricCard";
import styles from "../../modules/fabrics/fabrics.module.css";

export default function FabricsPage() {
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const fabrics = useFabrics({
    scope: "all",
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
    <main className={styles.libraryPage}>
      <header className={styles.libraryHeader}>
        <div>
          <Link href="/">← 项目库</Link>
          <span>FABRIC ARCHIVE / 8.2</span>
        </div>
        <div className={styles.searchWrap}>
          <label htmlFor="fabric-search">搜索面料</label>
          <input
            aria-keyshortcuts="Control+K Meta+K"
            id="fabric-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索标签…"
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
          ) : (
            <kbd aria-hidden="true">⌘/Ctrl K</kbd>
          )}
        </div>
      </header>

      <section className={styles.libraryIntro}>
        <div>
          <span>DIGITAL TEXTILE INDEX</span>
          <h1>
            面料不是素材，
            <br />
            是设计的第一层结构。
          </h1>
        </div>
        <p>用图片保留面料的视觉质感，用标签建立轻量、直接的选材索引。</p>
      </section>

      <FabricUploadPanel onUploaded={() => fabrics.refresh()} />

      <div className={styles.libraryBody}>
        <section className={styles.archivePanel} aria-label="面料列表">
          <div aria-live="polite" className={styles.resultMeta} role="status">
            <p>
              <strong>
                {fabrics.items.length.toString().padStart(2, "0")}
              </strong>{" "}
              项可用面料
            </p>
            <span>{fabrics.total} 条记录 · 拖拽卡片至白板</span>
          </div>
          {fabrics.isLoading ? (
            <div className={styles.libraryState}>
              <span>LOADING TEXTURES</span>
              <p>正在读取面料档案…</p>
            </div>
          ) : fabrics.error ? (
            <div className={styles.libraryState} data-error>
              <span>ARCHIVE OFFLINE</span>
              <p>{fabrics.error.message}</p>
              <button onClick={fabrics.refresh} type="button">
                重新加载
              </button>
            </div>
          ) : fabrics.items.length === 0 ? (
            <div className={styles.libraryState}>
              <span>NO MATCH</span>
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
            <p className={styles.loadingMore}>正在展开下一柜档案…</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
