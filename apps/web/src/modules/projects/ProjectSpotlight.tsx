"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { Project } from "./project-types";
import { readCreativeVisit } from "./creative-memory";
import styles from "./project-spotlight.module.css";
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
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const recent =
    projects.find((project) => project.id === visitPath.split("/")[1]) ??
    projects[0];
  if (!recent) return null;
  const resume = visitPath.split("/")[1] === recent.id;
  return (
    <section className={styles.spotlight} aria-label="继续创作">
      <Link
        className={styles.visual}
        href={`/${recent.id}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        {recent.coverUrl && failedCover !== recent.coverUrl ? (
          // Authenticated project covers use the same-origin file endpoint.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recent.coverUrl}
            alt=""
            onError={() => setFailedCover(recent.coverUrl)}
          />
        ) : (
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
        href={resume ? visitPath : `/${recent.id}`}
      >
        继续创作 <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
