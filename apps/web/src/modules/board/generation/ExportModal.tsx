"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dialog, DialogView } from "../../../components/ui";
import controls from "../../../components/ui.module.css";

import {
  createExport,
  fetchExportCapabilities,
  fetchExportJob,
  listExportJobs,
  type ExportCapabilities,
  type ExportFormat,
  type ExportJob,
  type ExportQuality,
  type ExportSource,
} from "./export-api";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";
import { BoardProjectContext } from "../board-context";
import { useSerialPolling } from "../../use-serial-polling";
import { useCoutureMotion } from "../../../components/motion/use-couture-motion";

const POLL_INTERVAL_MS = 1_000;

export function ExportModal({
  onClose,
  source,
  embedded = false,
  onBack,
}: {
  readonly embedded?: boolean;
  readonly onBack?: () => void;
  readonly onClose: () => void;
  readonly source: ExportSource;
}) {
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(
    null,
  );
  const [format, setFormat] = useState<ExportFormat>(
    source.type === "collection" ? "pdf" : "png",
  );
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [job, setJob] = useState<ExportJob | null>(null);
  const downloadAnchor = useRef<HTMLAnchorElement>(null);
  const requestedJob = useRef<string | null>(null);
  const play = useCoutureMotion();
  useEffect(() => {
    if (job?.id === requestedJob.current && job?.status === "succeeded" && job.downloadUrl) {
      play("seal", { anchor: downloadAnchor.current, eventKey: `export:${job.id}` });
    }
  }, [job, play]);
  const [error, setError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<ExportJob[]>([]);
  const [newExport, setNewExport] = useState(false);
  const projectId = useContext(BoardProjectContext);
  const [historyLoading, setHistoryLoading] = useState(Boolean(projectId));
  const sourceType = source.type;
  const sourceId = source.type === "asset" ? source.assetId : source.collectionId;
  // Only the request identity is local; task discovery and ownership remain server-side.
  const requestStorageKey = `export-request:${sourceType}:${sourceId}:${format}:${quality}`;
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const freshRequest = useRef(false);
  const failures = useRef(0);
  const capturedJobs = useRef(new Set<string>());
  const isProcessing = job?.status === "queued" || job?.status === "running";

  const historySync = useSerialPolling(`${projectId}:${sourceType}:${sourceId}`, Boolean(projectId && !job && !newExport), 2500, async (signal) => {
    try {
      const page = await listExportJobs(projectId, sourceType, sourceId, signal);
      signal.throwIfAborted();
      setRecent(page.items);
      const latest = page.items[0];
      if (latest) { const detail = await fetchExportJob(latest.id, signal); signal.throwIfAborted(); setJob(detail); setFormat(latest.format); setQuality(latest.quality); }
    } finally { if (!signal.aborted) setHistoryLoading(false); }
  });

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
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchExportJob(job.id, controller.signal).then(
        (result) => {
          if (!disposed) {
            setError(null);
            failures.current = 0;
            setJob(result);
          }
        },
        (reason: unknown) => {
          if (!disposed) {
            setError(
              reason instanceof Error ? reason.message : "导出状态读取失败",
            );
            setPollAttempt((current) => current + 1);
            failures.current += 1;
          }
        },
      );
    }, Math.min(30_000, POLL_INTERVAL_MS * 2 ** Math.min(failures.current, 5)));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [job, pollAttempt]);

  useEffect(() => {
    if (job?.status !== "succeeded" || capturedJobs.current.has(job.id)) {
      return;
    }
    capturedJobs.current.add(job.id);
    captureAnalytics("export_completed", {
      format,
      quality,
      source_type: source.type,
    });
  }, [format, job, quality, source.type]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([sourceType, sourceId, format, quality]);
      if (request.current?.fingerprint !== fingerprint) {
        let storedKey: string | null = null;
        try { if (!freshRequest.current) storedKey = sessionStorage.getItem(requestStorageKey); } catch { /* storage may be disabled */ }
        request.current = { fingerprint, key: storedKey ?? crypto.randomUUID() };
        freshRequest.current = false;
        try { sessionStorage.setItem(requestStorageKey, request.current.key); } catch { /* same-window retry still retains the ref */ }
      }
      const next = await createExport(source, format, quality, request.current.key);
      requestedJob.current = next.id;
      setJob(next);
      setNewExport(false);
      setRecent((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出任务创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const canDownload = job?.status === "succeeded" && job.downloadUrl;
  const resetRequest = () => {
    request.current = null;
    freshRequest.current = true;
    try { sessionStorage.removeItem(requestStorageKey); } catch { /* storage may be disabled */ }
    setNewExport(true);
    setJob(null);
  };

  const content = (
    <>
        <header>
          <div>
            <strong>
              {source.type === "collection" ? "系列 Lookbook" : "单图高清导出"}
            </strong>
          </div>
          {onBack ? <button onClick={onBack} type="button">返回工作区</button> : null}
          <button
            aria-label="关闭导出窗口"
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
                <span>正在读取导出规格…</span>
              </div>
            ) : capabilities ? (
              <>
                <section>
                  <span>导出格式</span>
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
                    <span>图像尺寸</span>
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
                        disabled={Boolean(job)}
                        onClick={() => setQuality("high")}
                        type="button"
                      >
                        原图高清
                      </button>
                    </div>
                    <p className={styles.exportNote}>
                      标准导出适合常规分享；原图高清保留源图尺寸，均不加水印。
                    </p>
                  </section>
                ) : (
                  <p className={styles.exportNote}>
                    PDF 将包含系列名、DNA 色板与全部 Look 网格，不加水印。
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
                  <button onClick={() => void loadCapabilities()} type="button">
                    重新读取
                  </button>
                ) : null}
              </div>
            ) : null}

            {job ? <ExportProgress job={job} /> : null}
            <p>关闭窗口不会取消导出，可从此处重新查看。</p>
            {historySync.error ? <p role="status">{historySync.error}<button onClick={historySync.retry} type="button">重试读取导出历史</button></p> : null}
            {recent.length > 0 ? <label>最近导出<select aria-label="最近导出" value={job?.id ?? ""} onChange={(event) => {
              const id = event.target.value;
              void fetchExportJob(id).then((next) => { setJob(next); setFormat(next.format); setQuality(next.quality); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "导出读取失败"));
            }}>{recent.map((item) => <option key={item.id} value={item.id}>{item.format.toUpperCase()} · {new Date(item.createdAt).toLocaleString("zh-CN")}</option>)}</select></label> : null}
            {error && job ? <button onClick={() => { failures.current = 0; setPollAttempt((value) => value + 1); }} type="button">重试状态查询</button> : null}

            <div className={styles.exportActions}>
              {canDownload ? (
                <a ref={downloadAnchor} href={job.downloadUrl ?? undefined}>
                  下载 {format.toUpperCase()}
                </a>
              ) : job?.retryAllowed ? (
                <button
                  onClick={() => {
                    resetRequest();
                    void submit();
                  }}
                  type="button"
                >
                  重新生成链接
                </button>
              ) : (
                <button
                  disabled={!capabilities || submitting || isProcessing || historyLoading}
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
            {job && !isProcessing ? <button disabled={submitting} onClick={resetRequest} type="button">新建导出</button> : null}
          </div>
        </div>
    </>
  );
  return embedded ? <div className={styles.exportEmbedded}><DialogView className={`${styles.exportModal} ${controls.controlSurface}`}>{content}</DialogView></div> : <Dialog label="导出成果" className={`${styles.exportModal} ${controls.controlSurface}`} onClose={onClose}>{content}</Dialog>;
}

function ExportProgress({ job }: { readonly job: ExportJob }) {
  const status = {
    expired: "链接已过期",
    failed: "生成失败",
    queued: "等待处理",
    running: "正在生成文件",
    succeeded: "文件已就绪",
  }[job.status];
  return (
    <div
      className={styles.exportProgress}
      data-status={job.status}
      role="status"
    >
      <i />
      <div>
        <span>{status}</span>
        <strong>
          {job.status === "succeeded" && job.sizeBytes
            ? formatBytes(job.sizeBytes)
            : (job.error?.message ?? "安全处理原图与版式")}
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
