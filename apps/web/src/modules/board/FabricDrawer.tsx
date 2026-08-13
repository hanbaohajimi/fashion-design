"use client";

import { useDeferredValue, useState } from "react";
import { useEditor } from "tldraw";

import { useFabrics } from "../fabrics/fabric-api";
import type { Fabric, FabricScope } from "../fabrics/fabric-types";
import { FabricUploadPanel } from "../fabrics/FabricCard";
import { FabricVirtualGrid } from "../fabrics/FabricVirtualGrid";
import { addFabricToBoard } from "./fabric-board";
import { fabricToDragPayload } from "./fabric-drag";
import styles from "./board.module.css";

interface FabricDrawerProps {
  readonly onClose: () => void;
}

export function FabricDrawer({ onClose }: FabricDrawerProps) {
  const editor = useEditor();
  const [scope, setScope] = useState<FabricScope>("preset");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const fabrics = useFabrics({ scope, search: deferredSearch });

  const addToBoard = (fabric: Fabric): void => {
    addFabricToBoard(editor, fabricToDragPayload(fabric));
    onClose();
  };

  return (
    <aside aria-label="面料抽屉" className={styles.fabricDrawer}>
      <header>
        <div>
          <h2>面料档案</h2>
        </div>
        <button aria-label="关闭面料抽屉" onClick={onClose} type="button">
          ×
        </button>
      </header>

      <div
        className={styles.fabricScopeTabs}
        role="group"
        aria-label="面料来源"
      >
        <button
          aria-pressed={scope === "preset"}
          onClick={() => setScope("preset")}
          type="button"
        >
          预置
        </button>
        <button
          aria-pressed={scope === "user"}
          onClick={() => setScope("user")}
          type="button"
        >
          我的
        </button>
      </div>

      <FabricUploadPanel
        compact
        onUploaded={() => {
          setScope("user");
          fabrics.refresh();
        }}
      />

      <label className={styles.fabricDrawerSearch}>
        <span>搜索面料</span>
        <input
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="名称 / 品类"
          type="search"
          value={search}
        />
      </label>

      <div className={styles.fabricDrawerMeta}>
        <span>{fabrics.total} ITEMS</span>
        <span>拖拽或点击添加</span>
      </div>

      {fabrics.isLoading ? (
        <div className={styles.fabricDrawerState}>正在读取面料…</div>
      ) : fabrics.error ? (
        <div className={styles.fabricDrawerState}>
          <p>{fabrics.error.message}</p>
          <button onClick={fabrics.refresh} type="button">
            重试
          </button>
        </div>
      ) : fabrics.items.length === 0 ? (
        <div className={styles.fabricDrawerState}>这里还没有面料</div>
      ) : (
        <FabricVirtualGrid
          compact
          fabrics={fabrics.items}
          height="100%"
          onAdd={addToBoard}
          onChanged={fabrics.refresh}
          onNearEnd={fabrics.loadMore}
        />
      )}
    </aside>
  );
}
