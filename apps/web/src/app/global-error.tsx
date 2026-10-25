"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import "../styles/design-system.css";
import styles from "../components/feedback.module.css";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className={styles.page}>
          <section className={styles.card} role="alert">
            <span className={styles.brand}>森织 设计工作室</span>
            <h1>出现了一点问题，已自动上报</h1>
            <p>你的项目数据仍会保留，可以重新载入继续工作。</p>
            <button onClick={reset} type="button">
              重试
            </button>
            <Link href="/">返回项目库</Link>
          </section>
        </main>
      </body>
    </html>
  );
}
