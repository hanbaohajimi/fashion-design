"use client";
/* Public share responses must bypass optimized-image caches so revocation takes effect. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, ImagePreview, Skeleton } from "../../../components/ui";
import styles from "./image-workspace.module.css";

interface SharedImageView {
  readonly height: number | null;
  readonly imageUrl: string;
  readonly width: number | null;
}

export function SharedImage({ token }: { token: string }) {
  const [image, setImage] = useState<SharedImageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/image-shares/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("分享不存在、已过期或已撤销");
        const result = (await response.json()) as SharedImageView;
        if (!result.imageUrl) throw new Error("分享图片地址不可用");
        setImage(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "图片读取失败");
      });
    return () => controller.abort();
  }, [token, attempt]);
  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <strong>森织 · 只读分享</strong>
        <Link href="/">进入工作室</Link>
      </header>
      {error ? (
        <div className={styles.shareMessage}>
          <h1>暂时无法查看这份设计</h1>
          <p role="alert">{error}</p>
          <p>可重新加载；如果链接已失效，请联系分享者获取新链接。</p>
          <Button
            onClick={() => {
              setError(null);
              setImage(null);
              setCopied(false);
              setAttempt((current) => current + 1);
            }}
          >
            重新加载
          </Button>
          <Link href="/">返回工作室</Link>
        </div>
      ) : image ? (
        <div className={styles.sharedArtwork}>
          <div className={styles.sharedImageFrame}>
            <ImagePreview src={image.imageUrl} alt="分享的设计图片" />
          </div>
          <div className={styles.shareToolbar}>
            <div className={styles.shareMeta}>
              <strong>分享的设计</strong>
              <span>
                只读预览
                {image.width && image.height
                  ? ` · ${image.width} × ${image.height}`
                  : ""}
              </span>
            </div>
            <div className={styles.shareActions}>
              <a href={image.imageUrl} download>
                下载图片
              </a>
              <Button
                onClick={() =>
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1800);
                    } catch {
                      setError("复制失败，请手动复制浏览器地址栏中的分享链接");
                    }
                  })()
                }
              >
                {copied ? "已复制链接" : "复制链接"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.sharedArtwork}>
          <Skeleton
            label="正在加载分享的设计"
            className={styles.sharedSkeleton}
          />
        </div>
      )}
    </main>
  );
}
