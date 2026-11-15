"use client";

import { useId, useRef } from "react";
import { creationCatalog } from "./creation-catalog";
import type { CanvasProjectFunction } from "./canvas-project-functions";
import { WorkspaceToolIcon } from "../../projects/WorkspaceToolIcon";
import type { CanvasCreationModule } from "@fashion/shared";
import { WorkspaceIcon, type AssistantIconName } from "./WorkspaceIcon";
import styles from "./creation-catalog-panel.module.css";

const objectEntry = {
  id: "canvas-objects",
  title: "画布对象",
  description: "查找、定位和管理画布中的素材",
  category: "画布管理",
};
const categories = ["图片", "实验", "工作台", "研究", "项目资料", "交付与评审", "项目管理", "画布管理"];
const icons: Record<string, AssistantIconName> = {
  image: "image",
  color: "palette",
  material: "fabric",
  detail: "annotate",
  presentation: "frame",
  collections: "compare",
  trends: "results",
  analysis: "requirements",
  evaluation: "review",
  "image-inpaint": "inpaint",
  "image-erase": "erase",
  "image-remove_background": "remove_background",
  "image-crop": "resize",
  "image-outpaint": "expand",
  "image-orient": "orient",
  "image-adjust": "adjust",
  "image-text_edit": "text_edit",
  "image-variation": "variation",
  "canvas-objects": "group_objects",
  "project-files": "results",
  "project-rename": "text_edit",
  "project-tasks": "tasks",
  "canvas-export": "download",
  "canvas-legacy": "history",
  "canvas-help": "requirements",
};

function CatalogIcon({ id }: { id: string }) {
  if (id === "patterns")
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 12C2 12 3 3 7 4c4 0 5 8 5 8Zm0 0c0-10 9-9 8-5 0 4-8 5-8 5Zm0 0c10 0 9 9 5 8-4 0-5-8-5-8Zm0 0c0 10-9 9-8 5 0-4 8-5 8-5Z" />
      </svg>
    );
  return <WorkspaceIcon name={icons[id] ?? "functions"} />;
}

/** Presentation only: existing catalog entries, permission checks and actions are supplied unchanged. */
export function CreationCatalogPanel({
  search,
  recent,
  editable,
  onSearch,
  onClose,
  onOpen,
  onOpenObjects,
  projectFunctions = [],
}: {
  search: string;
  recent: readonly string[];
  editable: boolean;
  onSearch: (value: string) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onOpenObjects: () => void;
  projectFunctions?: readonly CanvasProjectFunction[];
}) {
  const entries: (CanvasProjectFunction & { module?: CanvasCreationModule })[] = [...creationCatalog, ...projectFunctions, objectEntry];
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = entries.filter((entry) =>
    (entry.id === "canvas-objects"
      ? "画布对象 图层 查找素材 定位 隐藏 锁定"
      : `${entry.title}${entry.description}${entry.id === "collections" ? "系列规划" : ""}`
    ).includes(search),
  );
  const groups = [
    {
      title: "最近使用",
      items: matches.filter((entry) => recent.includes(entry.id) || entry.id === "collections" && recent.includes("project-planning")),
    },
    ...categories.map((title) => ({
      title,
      items: matches.filter((entry) => entry.category === title),
    })),
  ].filter((group) => group.items.length > 0);
  return (
    <div className={styles.panel} data-canvas-panel="functions">
      <header className={styles.header}>
        <h2>全部功能</h2>
        <div className={styles.search}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref={searchInput}
            autoFocus
            type="search"
            aria-label="搜索功能"
            placeholder="搜索功能"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                onSearch("");
                searchInput.current?.focus();
              }}
            >
              <WorkspaceIcon name="close" />
            </button>
          ) : null}
        </div>
        <button
          className={styles.close}
          type="button"
          aria-label="关闭全部功能"
          onClick={onClose}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className={styles.body}>
        {groups.map((group, index) => (
          <section
            className={styles.section}
            key={group.title}
            aria-labelledby={`${id}-${index}`}
          >
            <h3 id={`${id}-${index}`}>{group.title}</h3>
            <div className={styles.items}>
              {group.items.map((entry) => (
                <button
                  className={styles.entry}
                  key={entry.id}
                  type="button"
                  title={entry.description}
                  aria-label={entry.title}
                  disabled={
                    entry.disabled || Boolean(entry.module && !editable && entry.module !== "trends" && entry.module !== "collections")
                  }
                  onClick={() =>
                    entry.id === "canvas-objects"
                      ? onOpenObjects()
                      : onOpen(entry.id)
                  }
                >
                  <span className={styles.icon}>
                    {entry.panel ? <WorkspaceToolIcon name={entry.panel} size={20} /> : <CatalogIcon id={entry.id} />}
                  </span>
                  <span className={styles.name}>{entry.title}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 ? (
          <p className={styles.empty} role="status">
            没有找到相关功能
          </p>
        ) : null}
      </div>
    </div>
  );
}
