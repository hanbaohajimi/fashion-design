"use client";

import * as Sentry from "@sentry/nextjs";
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
        <main className="global-error-page">
          <section className="core-error-boundary" role="alert">
            <span>APP / RECOVERY</span>
            <strong>出现了一点问题，已自动上报</strong>
            <p>你的项目数据仍会保留，可以重新载入继续工作。</p>
            <button onClick={reset} type="button">
              重试
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
