"use client";
/* Public share responses must bypass optimized-image caches so revocation takes effect. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import styles from "./image-workspace.module.css";
export function SharedImage({ token }: { token: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/image-shares/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("分享不存在、已过期或已撤销");
        const result = (await response.json()) as { imageUrl: string };
        setImage(result.imageUrl);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "图片读取失败");
      });
    return () => controller.abort();
  }, [token]);
  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>分享的图片</header>
      {error ? (
        <p role="alert">{error}</p>
      ) : image ? (
        <img
          src={image}
          alt="分享的设计图片"
          style={{
            width: "100%",
            height: "calc(100dvh - 64px)",
            objectFit: "contain",
          }}
          onError={() => setError("图片已失效或读取失败")}
        />
      ) : (
        <p role="status">正在加载图片…</p>
      )}
    </main>
  );
}
