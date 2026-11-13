"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, ImagePreview, Input, Select, Skeleton, Textarea } from "../../components/ui";
import type { StudioPublicShareView } from "@fashion/shared";
import styles from "./review-share.module.css";

function statusLabel(status: string): string {
  if (status === "APPROVED") return "已批准";
  if (status === "CHANGES_REQUESTED") return "要求修改";
  if (status === "READY") return "交付准备完成";
  if (status === "REVIEW") return "评审中";
  return status === "DRAFT" ? "草稿" : "待评审";
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "APPROVED" || status === "READY") return "success";
  if (status === "CHANGES_REQUESTED" || status === "REVIEW") return "warning";
  return "neutral";
}

export function ReviewShare({ token }: { readonly token: string }) {
  const [view, setView] = useState<StudioPublicShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewKind, setReviewKind] = useState<"decision" | "comment">("decision");
  const [reviewDecision, setReviewDecision] = useState<"APPROVED" | "CHANGES_REQUESTED">("APPROVED");
  const [reviewText, setReviewText] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const reviewRequestKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/studio-shares/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("评审链接不存在、已过期或已撤销");
        const result = (await response.json()) as StudioPublicShareView;
        if (!result.title || !Array.isArray(result.views)) {
          throw new Error("评审资料不完整，请联系分享者重新生成链接");
        }
        setView(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "评审资料读取失败");
      });
    return () => controller.abort();
  }, [attempt, token]);

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewText.trim()) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const requestKey = reviewRequestKey.current ?? (reviewRequestKey.current = crypto.randomUUID());
      const response = await fetch(`/api/studio-shares/${encodeURIComponent(token)}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          kind: reviewKind,
          ...(reviewKind === "decision" ? { decision: reviewDecision } : {}),
          reviewerName,
          text: reviewText,
        }),
      });
      if (!response.ok) {
        let message = "评审提交失败，请稍后重试";
        try {
          const body = (await response.json()) as { message?: string };
          if (body.message) message = body.message;
        } catch {
          // Keep the stable fallback for non-JSON errors.
        }
        throw new Error(message);
      }
      setReviewText("");
      setReviewSubmitted(true);
      reviewRequestKey.current = null;
      setAttempt((value) => value + 1);
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : "评审提交失败，请稍后重试");
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="森织设计工作室">
          <strong>森织</strong>
          <span>设计工作室</span>
        </Link>
        <Link href="/login" className={styles.enterLink}>
          进入工作室 ↗
        </Link>
      </header>
      {error ? (
        <section className={styles.errorState} aria-labelledby="review-error-title">
          <h1 id="review-error-title">暂时无法打开这份评审</h1>
          <p role="alert">{error}</p>
          <p>链接可能已经过期或被撤销；如果资料仍需评审，请联系分享者生成新的只读链接。</p>
          <Button onClick={() => { setError(null); setView(null); setAttempt((value) => value + 1); }}>重新加载</Button>
        </section>
      ) : view ? (
        <div className={styles.content}>
          <header className={styles.titleBlock}>
            <div>
              <p className={styles.kicker}>只读评审 / {view.targetType === "STYLE" ? "款式修订" : "技术包修订"}</p>
              <h1>{view.title}</h1>
              <p className={styles.meta}>
                {view.projectName}
                {view.code ? ` · ${view.code}` : ""}
                {` · 修订 ${view.revision}`}
              </p>
            </div>
            <Badge tone={statusTone(view.status)}>{statusLabel(view.status)}</Badge>
          </header>

          <div className={styles.columns}>
            <section className={styles.visualSection} aria-labelledby="review-views-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="review-views-title">修订视图</h2>
                  <p>图片来自被分享的确切修订，不会随着项目后续修改而变化。</p>
                </div>
                <span>{view.views.length} 张视图</span>
              </div>
              <div className={styles.viewGrid}>
                {view.views.map((asset) => (
                  <figure className={styles.view} key={asset.assetId}>
                    <div className={styles.imageFrame}>
                      <ImagePreview src={asset.url} alt={asset.label || asset.kind} retryable={false} />
                    </div>
                    <figcaption>
                      <strong>{asset.label || asset.kind}</strong>
                      <span>{asset.reviewed ? "已记录人工核对" : "尚未记录人工核对"}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>

            <aside className={styles.reviewAside} aria-labelledby="review-history-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="review-history-title">评审记录</h2>
                  <p>决定绑定到修订，不代表后续版本自动通过。</p>
                </div>
              </div>
              {view.reviews.length ? (
                <div className={styles.reviewList}>
                  {view.reviews.map((review, index) => (
                    <article className={styles.reviewItem} key={`${review.createdAt}:${index}`}>
                      <div>
                        <Badge tone={review.decision === "APPROVED" ? "success" : "warning"}>
                          {review.decision === "APPROVED" ? "已批准" : "要求修改"}
                        </Badge>
                        <time dateTime={review.createdAt}>
                          {review.name} · {new Date(review.createdAt).toLocaleString("zh-CN")}
                        </time>
                      </div>
                      <p>{review.text}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>这份修订还没有公开的评审决定。</p>
              )}
              {view.comments.length ? (
                <div className={styles.commentList} aria-label="补充意见">
                  <h3>补充意见</h3>
                  {view.comments.map((comment, index) => (
                    <article className={styles.commentItem} key={`${comment.createdAt}:${index}`}>
                      <time dateTime={comment.createdAt}>{comment.name} · {new Date(comment.createdAt).toLocaleString("zh-CN")}</time>
                      <p>{comment.text}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              <form className={styles.reviewComposer} onSubmit={(event) => void submitReview(event)}>
                <h3>提交评审决定</h3>
                <p>意见会绑定到当前修订，分享者回到工作室后可以继续处理。</p>
                <label>
                  你的称呼（可选）
                  <Input
                    maxLength={80}
                    onChange={(event) => setReviewerName(event.target.value)}
                    placeholder="例如：品牌团队"
                    value={reviewerName}
                  />
                </label>
                <label>
                  反馈类型
                  <Select value={reviewKind} onChange={(event) => setReviewKind(event.target.value as "decision" | "comment")}>
                    <option value="decision">提交评审决定</option>
                    <option value="comment">补充意见</option>
                  </Select>
                </label>
                {reviewKind === "decision" ? (
                  <label>
                    决定
                    <Select value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as "APPROVED" | "CHANGES_REQUESTED")}>
                      <option value="APPROVED">批准当前修订</option>
                      <option value="CHANGES_REQUESTED">要求修改</option>
                    </Select>
                  </label>
                ) : null}
                <label>
                  评审意见
                  <Textarea
                    required
                    maxLength={2000}
                    onChange={(event) => setReviewText(event.target.value)}
                    placeholder="写下需要保留、修改或确认的内容"
                    rows={4}
                    value={reviewText}
                  />
                </label>
                <Button disabled={!reviewText.trim()} loading={reviewSubmitting} type="submit">
                  {reviewKind === "decision" ? "提交评审" : "提交意见"}
                </Button>
                {reviewError ? <p className={styles.reviewError} role="alert">{reviewError}</p> : null}
                {reviewSubmitted ? <p className={styles.reviewSuccess} role="status">评审已提交，记录已绑定到修订。</p> : null}
              </form>
              <p className={styles.expiry}>
                链接有效至 {new Date(view.expiresAt).toLocaleString("zh-CN")}，仅用于只读查看。
              </p>
            </aside>
          </div>
        </div>
      ) : (
        <div className={styles.loadingState} role="status">
          <Skeleton label="正在打开只读评审" />
          <Skeleton label="正在读取修订视图" />
        </div>
      )}
    </main>
  );
}

