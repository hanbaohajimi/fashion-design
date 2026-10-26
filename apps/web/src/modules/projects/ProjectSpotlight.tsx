"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ImagePreview } from "../../components/ui";
import type { Project } from "./project-types";
import { readCreativeVisit } from "./creative-memory";
import styles from "./project-spotlight.module.css";
import effects from "../../components/interactions/pointer-effects.module.css";
import { useMagnetic, usePointerSpotlight } from "../../components/interactions/pointer-effects";
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};
export function ProjectSpotlight({
  projects,
  userId,
}: {
  projects: readonly Project[];
  userId: string;
}) {
  const visitPath = useSyncExternalStore(
    subscribe,
    () => readCreativeVisit(userId)?.path ?? "",
    () => "",
  );
  const { hostRef, ...spotlight } = usePointerSpotlight();
  const { visualRef, ...magnetic } = useMagnetic();
  const recent =
    projects.find((project) => project.id === visitPath.split("/")[1]) ??
    projects[0];
  if (!recent) return null;
  const resume = visitPath.split("/")[1] === recent.id;
  return (
    <section ref={hostRef} {...spotlight} className={styles.spotlight} aria-label="继续创作">
      <span aria-hidden="true" className={styles.spotlightGlow} />
      <Link
        className={styles.visual}
        href={`/${recent.id}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        {recent.coverUrl ? <ImagePreview src={recent.coverUrl} alt="" retryable={false} /> : (
          <span className={styles.paper}>A</span>
        )}
      </Link>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>
          {resume ? "继续你在本机的创作" : "最近更新的项目"}
        </span>
        <h2>{recent.name}</h2>
      </div>
      <Link
        className={styles.primary}
        {...magnetic}
        data-interaction="magnetic"
        href={resume ? visitPath : `/${recent.id}`}
      >
        <span ref={visualRef} className={`${styles.primaryVisual} ${effects.magneticVisual}`}>
          继续创作 <span aria-hidden="true">→</span>
        </span>
      </Link>
    </section>
  );
}
