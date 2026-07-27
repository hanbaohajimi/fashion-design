"use client";

import { type CSSProperties, useState } from "react";

import type { Project } from "./project-types";
import styles from "./projects.module.css";

interface ProjectCardProps {
  readonly index: number;
  readonly onArchive: (project: Project) => Promise<void>;
  readonly onDelete: (project: Project) => Promise<void>;
  readonly onRename: (project: Project, name: string) => Promise<void>;
  readonly project: Project;
}

const PLACEHOLDER_COLORS = [
  "#d5c1a8",
  "#a9b7ad",
  "#bdabae",
  "#c8c0a2",
  "#9ea9b8",
] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProjectCard({
  index,
  onArchive,
  onDelete,
  onRename,
  project,
}: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const placeholder = PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length];
  const coverStyle = {
    "--cover-color": placeholder,
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

  const confirmDelete = async (): Promise<void> => {
    const message =
      project.assetCount > 0
        ? "该项目含设计资产，确认删除？"
        : `确认删除“${project.name}”？`;

    if (window.confirm(message)) {
      await onDelete(project);
    }
  };

  return (
    <article
      className={`${styles.projectCard} ${
        project.optimistic ? styles.optimisticCard : ""
      }`}
    >
      <div
        aria-label={project.coverUrl ? `${project.name} 封面` : "项目封面占位色"}
        className={styles.projectCover}
        role="img"
        style={coverStyle}
      >
        <span className={styles.coverNumber}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className={styles.coverMark}>FD</span>
      </div>

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
            <h2>{project.name}</h2>
          )}

          {!project.optimistic && !renaming ? (
            <details className={styles.cardMenu}>
              <summary aria-label={`${project.name} 项目操作`}>•••</summary>
              <div className={styles.menuPanel}>
                <button onClick={() => setRenaming(true)} type="button">
                  重命名
                </button>
                <button
                  onClick={() => void onArchive(project)}
                  type="button"
                >
                  归档
                </button>
                <button
                  className={styles.deleteAction}
                  onClick={() => void confirmDelete()}
                  type="button"
                >
                  删除
                </button>
              </div>
            </details>
          ) : null}
        </div>

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
      </div>
    </article>
  );
}
