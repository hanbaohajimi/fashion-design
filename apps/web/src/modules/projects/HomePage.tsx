"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "../../components/AppHeader";
import { Button, Notice, Skeleton } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { useGuardedRouter } from "../use-guarded-router";
import { PublicLanding } from "./PublicLanding";
import { useProjects } from "./use-projects";
import { useProjectEntry } from "./ProjectEntryProvider";
import { HOME_SHORTCUTS } from "./workspace-tools";
import { WorkspaceToolIcon } from "./WorkspaceToolIcon";
import styles from "./home.module.css";

export function WorkspaceHome() {
  const { session, loading } = useAuth();
  const query = useProjects("", "active", Boolean(session));
  const entry = useProjectEntry();
  const params = useSearchParams();
  const router = useGuardedRouter();
  useEffect(() => {
    if (session && params.get("new") === "1")
      void router.replace("/projects?new=1");
  }, [session, params, router]);
  if (loading)
    return (
      <main className={styles.page}>
        <Skeleton label="正在打开工作室" />
      </main>
    );
  if (!session) return <PublicLanding />;
  const projects =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((project) => !project.optimistic)
      .slice(0, 6) ?? [];
  return (
    <main
      className={styles.page}
      data-guide-page="home"
      data-guide-ready={query.isSuccess ? "true" : "false"}
    >
      <AppHeader current="home" />
      <div className={styles.content}>
        <header className={styles.heading} data-workspace-heading>
          <h1>首页</h1>
          <span>从一个想法，开始新的设计</span>
        </header>
        <button
          type="button"
          className={styles.createCanvas}
          data-guide="home-create"
          disabled={entry.creating}
          onClick={() => void entry.create()}
        >
          <span className={styles.createMark}>
            <WorkspaceToolIcon name="plus" size={30} />
          </span>
          <strong>{entry.creating ? "正在创建项目…" : "新建项目创作"}</strong>
          <span>一个空白画布，无限创作可能</span>
        </button>
        <section
          className={styles.shortcuts}
          aria-label="创作快捷入口"
          data-guide="home-shortcuts"
        >
          {HOME_SHORTCUTS.map((tool) => (
            <button
              key={tool.value}
              type="button"
              disabled={entry.creating}
              aria-busy={entry.creating || undefined}
              onClick={() => void entry.start(tool.value)}
            >
              <span className={styles.shortcutIcon}>
                <WorkspaceToolIcon name={tool.value} size={26} />
              </span>
              <span>{tool.label}</span>
            </button>
          ))}
        </section>
        <section
          className={styles.recent}
          aria-labelledby="recent-projects"
          data-guide="home-recent"
        >
          <header className={styles.sectionHeading}>
            <h2 id="recent-projects">最近项目</h2>
            <Link href="/projects">
              查看全部
              <WorkspaceToolIcon name="arrow" size={16} />
            </Link>
          </header>
          {query.isError ? (
            <Notice tone="error">
              最近项目读取失败。
              <Button onClick={() => void query.refetch()}>重新加载</Button>
            </Notice>
          ) : null}
          <div className={styles.projectGrid}>
            {query.isPending
              ? Array.from({ length: 3 }, (_, index) => (
                  <Skeleton
                    key={index}
                    label="正在加载最近项目"
                    className={styles.projectSkeleton}
                  />
                ))
              : projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/${project.id}`}
                    className={styles.project}
                  >
                    <span className={styles.projectCover}>
                      {project.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.coverUrl} alt="" />
                      ) : (
                        <WorkspaceToolIcon name="projects" size={24} />
                      )}
                    </span>
                    <span className={styles.projectInfo}>
                      <strong title={project.name}>{project.name}</strong>
                      <time dateTime={project.updatedAt}>
                        {new Date(project.updatedAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </time>
                    </span>
                    <span className={styles.projectArrow}>
                      <WorkspaceToolIcon name="arrow" size={18} />
                    </span>
                  </Link>
                ))}
          </div>
          {!query.isPending && !query.isError && !projects.length ? (
            <div className={styles.empty}>
              <p>你的第一个设计项目，从这里开始。</p>
              <Button
                onClick={() => void entry.create()}
                disabled={entry.creating}
              >
                新建项目创作
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
