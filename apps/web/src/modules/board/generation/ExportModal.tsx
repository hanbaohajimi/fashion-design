"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  createExport,
  fetchExportCapabilities,
  fetchExportJob,
  type ExportCapabilities,
  type ExportFormat,
  type ExportJob,
  type ExportQuality,
  type ExportSource,
} from "./export-api";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";

const POLL_INTERVAL_MS = 1_000;

export function ExportModal({
  onClose,
  source,
}: {
  readonly onClose: () => void;
  readonly source: ExportSource;
}) {
  const [capabilities, setCapabilities] =
    useState<ExportCapabilities | null>(null);
  const [format, setFormat] = useState<ExportFormat>(
    source.type === "collection" ? "pdf" : "png",
  );
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const capturedJobs = useRef(new Set<string>());
  const dialogRef = useRef<HTMLElement>(null);
  const isProcessing = job?.status === "queued" || job?.status === "running";

  const loadCapabilities = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setCapabilities(await fetchExportCapabilities());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出权限读取失败");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void fetchExportCapabilities().then(
      (result) => {
        if (!disposed) setCapabilities(result);
      },
      (reason: unknown) => {
        if (!disposed) {
          setError(
            reason instanceof Error ? reason.message : "导出权限读取失败",
          );
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void fetchExportJob(job.id).then(
        (result) => {
          if (!disposed) {
            setError(null);
            setJob(result);
          }
        },
        (reason: unknown) => {
          if (!disposed) {
            setError(
              reason instanceof Error ? reason.message : "导出状态读取失败",
            );
            setPollAttempt((current) => current + 1);
          }
        },
      );
    }, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [job, pollAttempt]);

  useEffect(() => {
    if (
      job?.status !== "succeeded" ||
      capturedJobs.current.has(job.id)
    ) {
      return;
    }
    capturedJobs.current.add(job.id);
    captureAnalytics("export_completed", {
      format,
      quality,
      source_type: source.type,
    });
  }, [format, job, quality, source.type]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused?.isConnected &&
          !previouslyFocused.closest("[inert]")
        ) {
          previouslyFocused.focus();
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isProcessing) onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isProcessing, onClose]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      setJob(await createExport(source, format, quality));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出任务创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const canDownload = job?.status === "succeeded" && job.downloadUrl;

  return createPortal(
    <div
      className={styles.exportBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !isProcessing) onClose();
      }}
    >
      <section
        aria-label="导出成果"
        aria-modal="true"
        className={styles.exportModal}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>EXPORT / DELIVERY</span>
            <strong>
              {source.type === "collection" ? "系列 Lookbook" : "单图高清导出"}
            </strong>
          </div>
          <button
            aria-label="关闭导出窗口"
            disabled={isProcessing}
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </header>

        <div className={styles.exportLayout}>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={source.type === "collection" ? "系列封面" : "导出 Look 预览"}
              src={source.previewUrl}
            />
            <figcaption>
              {source.type === "collection"
                ? source.name
                : "使用原图而非缩略图生成"}
            </figcaption>
          </figure>

          <div className={styles.exportControls}>
            {!capabilities && !error ? (
              <div className={styles.exportLoading} role="status">
                <i />
                <span>正在读取套餐与导出规格…</span>
              </div>
            ) : capabilities ? (
              <>
                <section>
                  <span>FORMAT</span>
                  <div className={styles.exportOptions}>
                    {(source.type === "collection"
                      ? (["pdf"] as const)
                      : (["png", "jpg"] as const)
                    ).map((option) => (
                      <button
                        aria-pressed={format === option}
                        disabled={Boolean(job)}
                        key={option}
                        onClick={() => setFormat(option)}
                        type="button"
                      >
                        {option.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </section>

                {source.type === "asset" ? (
                  <section>
                    <span>RESOLUTION</span>
                    <div className={styles.exportOptions}>
                      <button
                        aria-pressed={quality === "standard"}
                        disabled={Boolean(job)}
                        onClick={() => setQuality("standard")}
                        type="button"
                      >
                        标准
                      </button>
                      <button
                        aria-pressed={quality === "high"}
                        disabled={
                          Boolean(job) || !capabilities.highResolutionAllowed
                        }
                        onClick={() => setQuality("high")}
                        type="button"
                      >
                        原图高清
                      </button>
                    </div>
                    {!capabilities.highResolutionAllowed ? (
                      <p className={styles.exportUpgrade}>
                        Free 最高长边 {capabilities.freeMaxEdge}px
                        且带水印；升级 Pro 解锁原图高清无水印。
                      </p>
                    ) : (
                      <p className={styles.exportNote}>
                        Pro 原图高清导出不加水印。
                      </p>
                    )}
                  </section>
                ) : (
                  <p className={styles.exportNote}>
                    PDF 将包含系列名、DNA 色板与全部 Look 网格。
                    {capabilities.watermark ? " Free 版本带水印。" : ""}
                  </p>
                )}

                <div className={styles.exportRetention}>
                  <span>临时交付</span>
                  <strong>{capabilities.downloadLinkHours} 小时</strong>
                  <p>文件到期自动清理；链接过期后可重新请求导出。</p>
                </div>
              </>
            ) : null}

            {error ? (
              <div className={styles.exportError} role="alert">
                <strong>导出暂时未完成</strong>
                <p>{error}</p>
                {!capabilities ? (
                  <button
                    onClick={() => void loadCapabilities()}
                    type="button"
                  >
                    重新读取
                  </button>
                ) : null}
              </div>
            ) : null}

            {job ? <ExportProgress job={job} /> : null}

            <div className={styles.exportActions}>
              {canDownload ? (
                <a href={job.downloadUrl ?? undefined}>下载 {format.toUpperCase()}</a>
              ) : job?.retryAllowed ? (
                <button
                  onClick={() => {
                    setJob(null);
                    void submit();
                  }}
                  type="button"
                >
                  重新生成链接
                </button>
              ) : (
                <button
                  disabled={!capabilities || submitting || isProcessing}
                  onClick={() => void submit()}
                  type="button"
                >
                  {submitting
                    ? "正在排队…"
                    : isProcessing
                      ? "后台生成中…"
                      : "开始导出"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ExportProgress({ job }: { readonly job: ExportJob }) {
  const status = {
    expired: "链接已过期",
    failed: "生成失败",
    queued: "等待 worker",
    running: "正在后端渲染",
    succeeded: "文件已就绪",
  }[job.status];
  return (
    <div className={styles.exportProgress} data-status={job.status} role="status">
      <i />
      <div>
        <span>{status}</span>
        <strong>
          {job.status === "succeeded" && job.sizeBytes
            ? formatBytes(job.sizeBytes)
            : job.error?.message ?? "安全处理原图与版式"}
        </strong>
        {job.expiresAt ? (
          <small>
            有效至{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(job.expiresAt))}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  if (document.activeElement === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
