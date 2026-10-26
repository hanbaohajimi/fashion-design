"use client";

import Link from "next/link";
import { Button, Menu } from "../../components/ui";
import { userFacingError } from "../../components/user-facing-error";
import { useLayoutEffect, useRef, useState } from "react";

import type { Project } from "./project-types";
import styles from "./projects.module.css";

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
  onArchive,
  onDelete,
  onDuplicate,
  onRename,
  onRestore,
  project,
}: ProjectCardProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [name, setName] = useState(project.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const renameFlight = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!renaming && restoreFocus.current) {
      restoreFocus.current = false;
      menuTrigger.current?.focus();
    }
  }, [renaming]);
  const finishRename = () => { restoreFocus.current = true; setRenaming(false); };
  const cancelRename = () => {
    if (renameFlight.current) return;
    setName(project.name);
    setRenameError(null);
    finishRename();
  };

  const submitRename = async (): Promise<void> => {
    if (renameFlight.current) return;
    const trimmed = name.trim();
    const length = trimmed.length;

    if (trimmed === project.name) {
      setRenameError(null);
      finishRename();
      return;
    }
    if (length < 3 || length > 80) {
      setRenameError("项目名称需为 3–80 个字");
      renameInput.current?.focus();
      return;
    }
    setRenameError(null);
    renameFlight.current = true;
    setRenamePending(true);
    try {
      await onRename(project, trimmed);
      setName(trimmed);
      finishRename();
    } catch (error) {
      setRenameError(userFacingError(error, "重命名失败，请重试"));
    } finally {
      renameFlight.current = false;
      setRenamePending(false);
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
      data-project-card
      data-project-id={project.id}
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
            project.coverUrl && !coverFailed ? `${project.name} 封面` : `${project.name} 暂无封面`
          }
          className={styles.projectCover}
          data-has-cover={project.coverUrl && !coverFailed ? "true" : undefined}
          role="img"
        >
          {project.coverUrl && !coverFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`${project.name} 封面`} className={styles.coverImage} src={project.coverUrl} onError={() => setCoverFailed(true)} />
          ) : <span className={styles.coverFallback}><span aria-hidden="true">▱</span><small>{coverFailed ? "封面暂时无法加载" : "暂无封面"}</small></span>}
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
                  cancelRename();
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
                ref={renameInput}
                readOnly={renamePending}
                id={`rename-${project.id}`}
                maxLength={80}
                minLength={3}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <Button size="small" loading={renamePending} type="submit">保存</Button>
              <Button
                size="small"
                disabled={renamePending}
                onClick={cancelRename}
                type="button"
              >
                取消
              </Button>
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
            <Menu triggerRef={menuTrigger} className={styles.cardMenu} label={`${project.name} 项目操作`} trigger={<span aria-hidden="true">•••</span>}>
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
                  aria-describedby={`duplicate-runway-note-${project.id}`}
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
                <small id={`duplicate-runway-note-${project.id}`} className={styles.duplicateNote}>
                  服装秀作品、执行历史及活动任务保留在原项目。
                </small>
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
            </Menu>
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
                ? `${project.assetCount} 项设计资料`
                : "空项目"}
          </span>
        </div>

        {!project.optimistic && !project.archived ? <Link className={styles.continueProject} href={`/${project.id}`}>继续设计 <span aria-hidden="true">↗</span></Link> : null}
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
