/**
 * Enhanced ProjectCard with Fashion Metadata
 * C级修复：增加季节、风格、面料标签
 */

"use client";

import Link from "next/link";
import { type CSSProperties, useState } from "react";

import type { Project } from "./project-types";
import styles from "./projects-redesign.module.css";

interface ProjectCardProps {
  readonly duplicating: boolean;
  readonly index: number;
  readonly onArchive: (project: Project) => Promise<void>;
  readonly onDelete: (project: Project) => Promise<void>;
  readonly onDuplicate: (project: Project) => Promise<void>;
  readonly onRename: (project: Project, name: string) => Promise<void>;
  readonly onRestore: (project: Project) => Promise<void>;
  readonly project: Project;
}

/* 面料色板 - 真实材质感的配色 */
const FABRIC_COLORS = [
  "#e8d5c8", // 未漂白棉布
  "#d4c4ae", // 亚麻原色
  "#c8b8a8", // 羊毛米色
  "#b8a898", // 卡其色
  "#a89888", // 驼色
] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getStyleLabel(style?: string): string {
  const labels: Record<string, string> = {
    minimalist: "极简",
    "avant-garde": "先锋",
    streetwear: "街头",
    couture: "高定",
    casual: "休闲",
    formal: "正装",
    sportswear: "运动",
  };
  return style ? labels[style] || style : "";
}

function getMaterialLabel(material?: string): string {
  const labels: Record<string, string> = {
    knit: "针织",
    woven: "梭织",
    leather: "皮革",
    technical: "科技",
    hybrid: "混合",
  };
  return material ? labels[material] || material : "";
}

export function ProjectCard({
  duplicating,
  index,
  onArchive,
  onDelete,
  onDuplicate,
  onRename,
  onRestore,
  project,
}: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [name, setName] = useState(project.name);

  const fabricColor = FABRIC_COLORS[index % FABRIC_COLORS.length];
  const coverStyle = {
    "--cover-color": fabricColor,
    ...(project.coverUrl
      ? { backgroundImage: `url("${project.coverUrl}")` }
      : {}),
  } as CSSProperties;

  const submitRename = async (): Promise<void> => {
    const trimmed = name.trim();
    const length = Array.from(trimmed).length;

    if (length < 3 || length > 80 || trimmed === project.name) {
      if (trimmed === project.name) {
        setRenaming(false);
      }
      return;
    }

    await onRename(project, trimmed);
    setRenaming(false);
  };

  const runDelete = async (): Promise<void> => {
    if (deletePending) {
      return;
    }

    setDeletePending(true);

    try {
      await onDelete(project);
    } finally {
      setDeletePending(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <article
      className={`${styles.projectCard} ${
        project.optimistic ? styles.optimisticCard : ""
      }`}
    >
      <Link
        aria-label={`打开项目 ${project.name}`}
        className={styles.projectOpen}
        href={`/${project.id}`}
      >
        <div
          aria-label={
            project.coverUrl ? `${project.name} 封面` : "项目封面占位"
          }
          className={styles.projectCover}
          data-has-cover={project.coverUrl ? "true" : undefined}
          role="img"
          style={coverStyle}
        >
          <span className={styles.coverNumber}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span aria-hidden="true" className={styles.coverMeasure}>
            {project.assetCount > 0 ? `${project.assetCount} PCS` : "UNCUT"}
          </span>
          <span className={styles.coverMark}>FD</span>
        </div>
      </Link>

      <div className={styles.cardBody}>
        <div className={styles.cardHeading}>
          {renaming ? (
            <form
              className={styles.renameForm}
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <label className={styles.srOnly} htmlFor={`rename-${project.id}`}>
                项目名称
              </label>
              <input
                autoFocus
                id={`rename-${project.id}`}
                maxLength={80}
                minLength={3}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button type="submit">保存</button>
            </form>
          ) : (
            <h2>
              <Link href={`/${project.id}`}>{project.name}</Link>
            </h2>
          )}

          {!project.optimistic && !renaming ? (
            <details className={styles.cardMenu}>
              <summary aria-label={`${project.name} 项目操作`}>•••</summary>
              <div className={styles.menuPanel}>
                <button onClick={() => setRenaming(true)} type="button">
                  重命名
                </button>
                <button
                  aria-busy={duplicating}
                  disabled={duplicating}
                  onClick={() => void onDuplicate(project)}
                  type="button"
                >
                  {duplicating ? "复制中…" : "创建副本"}
                </button>
                <button
                  onClick={() =>
                    void (project.archived
                      ? onRestore(project)
                      : onArchive(project))
                  }
                  type="button"
                >
                  {project.archived ? "恢复项目" : "归档"}
                </button>
                <button
                  className={styles.deleteAction}
                  onClick={() => setConfirmingDelete(true)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </details>
          ) : null}
        </div>

        {/* 时尚元数据标签 - C级修复 */}
        {project.metadata && (
          <div className={styles.cardTags}>
            {project.metadata.season && (
              <span className={styles.tagSeason}>{project.metadata.season}</span>
            )}
            {project.metadata.style && (
              <span className={styles.tagStyle}>
                {getStyleLabel(project.metadata.style)}
              </span>
            )}
            {project.metadata.materialType && (
              <span className={styles.tagMaterial}>
                {getMaterialLabel(project.metadata.materialType)}
              </span>
            )}
            {project.metadata.fabricCount && project.metadata.fabricCount > 0 && (
              <span className={styles.tagMaterial}>
                {project.metadata.fabricCount} 款面料
              </span>
            )}
          </div>
        )}

        <div className={styles.cardMeta}>
          <span>{formatDate(project.updatedAt)}</span>
          <span>
            {project.optimistic
              ? "正在保存"
              : project.assetCount > 0
                ? `${project.assetCount} 项资产`
                : "空项目"}
          </span>
        </div>

        {confirmingDelete ? (
          <div className={styles.confirmPanel} role="group">
            <span>DISCARD · 不可撤销</span>
            <p>
              {project.assetCount > 0
                ? `"${project.name}"含 ${project.assetCount} 项设计资产，删除后无法找回。`
                : `确认删除"${project.name}"？`}
            </p>
            <div className={styles.confirmActions}>
              <button
                autoFocus
                disabled={deletePending}
                onClick={() => setConfirmingDelete(false)}
                type="button"
              >
                保留
              </button>
              <button
                aria-busy={deletePending}
                data-confirm="true"
                disabled={deletePending}
                onClick={() => void runDelete()}
                type="button"
              >
                {deletePending ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
