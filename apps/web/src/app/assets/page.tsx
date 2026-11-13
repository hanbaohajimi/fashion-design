"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "../../modules/auth/AuthProvider";
import { AppHeader } from "../../components/AppHeader";
import { Skeleton, SkeletonGroup, EmptyState } from "../../components/ui";
import { useProjects } from "../../modules/projects/use-projects";
import type { Project } from "../../modules/projects/project-types";
import styles from "./assets.module.css";

export default function AssetsPage() {
  const { session, loading: authLoading } = useAuth();
  const projectsQuery = useProjects("", "active", Boolean(session));
  const projects = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );
  const totalAssets = useMemo(
    () => projects.reduce((sum: number, p: Project) => sum + p.assetCount, 0),
    [projects],
  );

  if (authLoading) {
    return (
      <main className={styles.page}>
        <AppHeader current="assets" />
        <div className={styles.body}>
          <SkeletonGroup>
            <Skeleton label="正在加载资产" />
            <Skeleton label="正在加载资产列表" />
          </SkeletonGroup>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className={styles.page}>
        <AppHeader current="assets" />
        <div className={styles.body}>
          <EmptyState title="登录后查看你的设计资产">
            所有生成结果、参考图和交付文件都会集中在这里。
          </EmptyState>
        </div>
      </main>
    );
  }

  if (projects.length === 0) {
    return (
      <main className={styles.page}>
        <AppHeader current="assets" />
        <div className={styles.body}>
          <EmptyState title="还没有设计资产">
            创建第一个项目后，生成结果、参考图和交付文件都会集中在这里。
          </EmptyState>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <AppHeader current="assets" />
      <div className={styles.body}>
        <section className={styles.header} data-workspace-heading>
          <div>
            <h1 className={styles.title}>资产</h1>
            <p className={styles.lead}>
              按项目浏览你的生成结果、参考图和交付文件。
            </p>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>项目数</dt>
              <dd>{projects.length}</dd>
            </div>
            <div>
              <dt>资产总数</dt>
              <dd>{totalAssets}</dd>
            </div>
          </dl>
        </section>

        <div className={styles.grid}>
          {projects.map((project: Project) => (
            <Link
              key={project.id}
              href={`/${project.id}`}
              className={styles.card}
            >
              <div className={styles.cardCover}>
                {project.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={project.coverUrl}
                    alt={project.name}
                    className={styles.coverImage}
                  />
                ) : (
                  <div className={styles.coverFallback}>
                    <span>{project.name.slice(0, 1)}</span>
                  </div>
                )}
              </div>
              <div className={styles.cardBody}>
                <strong className={styles.cardName}>{project.name}</strong>
                <span className={styles.cardMeta}>
                  {project.assetCount} 个资产
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
