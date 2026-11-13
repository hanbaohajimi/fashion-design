"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import styles from "./feedback.module.css";

export function RouteError({
  error,
  retry,
  title = "页面暂时无法打开",
  description = "项目数据仍会保留，可以重新载入继续工作。",
  returnHref = "/",
  returnLabel = "返回项目库",
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
  readonly title?: string;
  readonly description?: string;
  readonly returnHref?: string;
  readonly returnLabel?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.card} role="alert" aria-labelledby="route-error-title">
        <span className={styles.brand}>森织 设计工作室</span>
        <h1 id="route-error-title">{title}</h1>
        <p>{description}</p>
        {error.digest ? <small className={styles.errorMeta}>错误编号：{error.digest}</small> : null}
        <button onClick={retry} type="button">
          重新载入
        </button>
        <Link href={returnHref}>{returnLabel}</Link>
      </section>
    </main>
  );
}
