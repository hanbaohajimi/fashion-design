"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { useFabrics } from "../../modules/fabrics/fabric-api";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import { FabricUploadPanel } from "../../modules/fabrics/FabricCard";
import styles from "../../modules/fabrics/fabrics.module.css";

export default function FabricsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const fabrics = useFabrics({
    scope: "all",
    search: deferredSearch,
  });

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
            id="fabric-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索标签…"
            type="search"
            value={search}
          />
          <kbd>⌘ K</kbd>
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
          <div className={styles.resultMeta}>
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
              <p>没有匹配该标签的面料。</p>
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
