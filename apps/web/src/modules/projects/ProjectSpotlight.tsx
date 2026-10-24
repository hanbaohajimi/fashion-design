"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { StudioCreativeSummary } from "@fashion/shared";
import { fetchCreativeSummary } from "../studio/studio-api";
import type { Project } from "./project-types";
import { readCreativeVisit } from "./creative-memory";
import styles from "./project-spotlight.module.css";
const subscribe = (listener: () => void) => { window.addEventListener("storage", listener); return () => window.removeEventListener("storage", listener); };
export function ProjectSpotlight({ projects, userId }: { projects: readonly Project[]; userId: string }) {
  const visitPath = useSyncExternalStore(subscribe, () => readCreativeVisit(userId)?.path ?? "", () => "");
  const [snapshot, setSnapshot] = useState<{ id: string; userId: string; data: StudioCreativeSummary } | null>(null);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const recent = projects.find(project => project.id === visitPath.split("/")[1]) ?? projects[0];
  const recentId = recent?.id;
  useEffect(() => {
    if (!recentId) return;
    const controller = new AbortController();
    void fetchCreativeSummary(recentId, controller.signal).then(data => { if (!controller.signal.aborted && [data.styles, data.assets, data.packs].every(value => Number.isInteger(value) && value >= 0)) setSnapshot({ id: recentId, userId, data }); }).catch(() => undefined);
    return () => controller.abort();
  }, [recentId, userId]);
  if (!recent) return null;
  const progress = snapshot?.id === recent.id && snapshot.userId === userId ? snapshot.data : null;
  const next = progress?.styles ? { tab: "experiments", action: "进入色料实验" } : progress?.assets ? { tab: "styles", action: "比较并保存款式" } : { tab: "tasks", action: "开始设计任务" };
  const resume = visitPath.split("/")[1] === recent.id;
  return <section className={styles.spotlight} aria-label="继续创作">
    <Link className={styles.visual} href={`/${recent.id}`} tabIndex={-1} aria-hidden="true">
      {recent.coverUrl && failedCover !== recent.coverUrl ? (
        // Authenticated project covers use the same-origin file endpoint.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recent.coverUrl} alt="" onError={() => setFailedCover(recent.coverUrl)} />
      ) : <div className={styles.paper}><span>从灵感，到成衣</span><i /><span>你的下一件作品，由此开始</span></div>}
    </Link>
    <div className={styles.copy}><span className={styles.eyebrow}>{resume ? "继续你在本机的创作" : "最近更新的项目"}</span><h2>{recent.name}</h2>
      <p>{progress ? `${progress.styles} 款档案 · ${progress.assets} 张候选 · ${progress.packs} 份技术包` : `${recent.assetCount} 项资产 · 每一次尝试，都在形成你的设计语言。`}</p>
      <Link className={styles.primary} href={resume ? visitPath : `/${recent.id}`}>继续创作 <span aria-hidden="true">↗</span></Link>
      <div className={styles.links}><Link href={`/${recent.id}/studio?tab=${next.tab}`}>{next.action}</Link><Link href="/fabrics">寻找一块面料</Link></div>
    </div>
  </section>;
}
