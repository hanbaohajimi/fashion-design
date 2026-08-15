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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [name, setName] = useState(project.name);
  const [renameError, setRenameError] = useState<string | null>(null);

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

    if (trimmed === project.name) {
      setRenameError(null);
      setRenaming(false);
      return;
    }
    if (length < 3 || length > 80) {
      setRenameError("项目名称需为 3–80 个字");
      return;
    }
    setRenameError(null);
    try {
      await onRename(project, trimmed);
      setName(trimmed);
      setRenaming(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名失败");
    }
  };

  const runDelete = async (): Promise<void> => {
    if (deletePending) {
      return;
    }

    setDeletePending(true);
    setDeleteError(null);

    try {
      await onDelete(project);
      setConfirmingDelete(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "删除项目失败，请重试",
      );
    } finally {
      setDeletePending(false);
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
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setName(project.name);
                  setRenameError(null);
                  setRenaming(false);
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <label className={styles.srOnly} htmlFor={`rename-${project.id}`}>
                项目名称
              </label>
              <input
                aria-describedby={
                  renameError ? `rename-error-${project.id}` : undefined
                }
                aria-invalid={Boolean(renameError)}
                autoFocus
                id={`rename-${project.id}`}
                maxLength={80}
                minLength={3}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button type="submit">保存</button>
              <button
                onClick={() => {
                  setName(project.name);
                  setRenameError(null);
                  setRenaming(false);
                }}
                type="button"
              >
                取消
              </button>
              {renameError ? (
                <small id={`rename-error-${project.id}`} role="alert">
                  {renameError}
                </small>
              ) : null}
            </form>
          ) : (
            <h2>
              <Link href={`/${project.id}`}>{project.name}</Link>
            </h2>
          )}

          {!project.optimistic && !renaming ? (
            <details className={styles.cardMenu}>
              <summary aria-label={`${project.name} 项目操作`}>
                <span aria-hidden="true">•••</span>
              </summary>
              <div className={styles.menuPanel}>
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setName(project.name);
                    setRenameError(null);
                    setRenaming(true);
                  }}
                  type="button"
                >
                  重命名
                </button>
                <button
                  aria-busy={duplicating}
                  disabled={duplicating}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void onDuplicate(project);
                  }}
                  type="button"
                >
                  {duplicating ? "复制中…" : "创建副本"}
                </button>
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void (project.archived
                      ? onRestore(project)
                      : onArchive(project));
                  }}
                  type="button"
                >
                  {project.archived ? "恢复项目" : "归档"}
                </button>
                <button
                  className={styles.deleteAction}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            </details>
          ) : null}
        </div>

        {/* 时尚元数据标签 - C级修复 */}
        {project.metadata &&
        (project.metadata.season ||
          project.metadata.style ||
          project.metadata.materialType ||
          (project.metadata.fabricCount ?? 0) > 0) ? (
          <div className={styles.cardTags}>
            {project.metadata.season && (
              <span className={`${styles.tag} ${styles.tagSeason}`}>
                {project.metadata.season}
              </span>
            )}
            {project.metadata.style && (
              <span className={`${styles.tag} ${styles.tagStyle}`}>
                {getStyleLabel(project.metadata.style)}
              </span>
            )}
            {project.metadata.materialType && (
              <span className={`${styles.tag} ${styles.tagMaterial}`}>
                {getMaterialLabel(project.metadata.materialType)}
              </span>
            )}
            {project.metadata.fabricCount &&
              project.metadata.fabricCount > 0 && (
                <span className={`${styles.tag} ${styles.tagMaterial}`}>
                  {project.metadata.fabricCount} 款面料
                </span>
              )}
          </div>
        ) : null}

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
            {deleteError ? <small role="alert">{deleteError}</small> : null}
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
