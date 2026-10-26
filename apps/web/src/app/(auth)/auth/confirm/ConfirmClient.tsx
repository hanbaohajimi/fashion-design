"use client";

import Link from "next/link";
import styles from "../../../../components/feedback.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { readErrorMessage } from "../../../../modules/auth/auth-api";
import { announceSessionChange } from "../../../../modules/auth/AuthProvider";

export function ConfirmClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);
  const tokenHash = searchParams.get("token_hash");
  const [error, setError] = useState<string | null>(
    tokenHash ? null : "登录链接缺少验证信息，请重新发送。",
  );

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    if (!tokenHash) {
      return;
    }

    async function confirm(): Promise<void> {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ action: "verify", tokenHash }),
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          setError(
            await readErrorMessage(
              response,
              "登录链接无效或已过期，请重新发送。",
            ),
          );
          return;
        }

        const body = (await response.json()) as {
          readonly projectId?: string;
        };
        announceSessionChange();
        router.replace(
          body.projectId ? `/${encodeURIComponent(body.projectId)}` : "/",
        );
        router.refresh();
      } catch {
        setError("无法连接认证服务，请检查网络后重试。");
      }
    }

    void confirm();
  }, [router, tokenHash]);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.brand}>森织 设计工作室</span>
        <h1>{error ? "链接未能确认" : "正在打开设计台…"}</h1>
        <p
          data-error={Boolean(error)}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          {error ?? "正在验证一次性登录链接，请勿关闭页面。"}
        </p>
        {error ? <Link href="/login">重新发送登录链接</Link> : null}
      </section>
    </main>
  );
}
