"use client";

import { Select } from "../../../components/ui";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dialog, DialogView } from "../../../components/ui";
import controls from "../../../components/ui.module.css";
import { fetchStudio } from "../../studio/studio-api";
import type { StudioDocumentView } from "@fashion/shared";

import {
  createExport,
  fetchExportCapabilities,
  fetchExportJob,
  listExportJobs,
  type ExportCapabilities,
  type ExportAspect,
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
const ASPECT_OPTIONS: readonly { value: ExportAspect; label: string }[] = [
  { value: "original", label: "原图比例" },
  { value: "square", label: "1:1" },
  { value: "landscape", label: "16:9" },
  { value: "portrait", label: "9:16" },
];

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
  const [aspect, setAspect] = useState<ExportAspect>("original");
  const [job, setJob] = useState<ExportJob | null>(null);
  const [batchJobs, setBatchJobs] = useState<readonly ExportJob[] | null>(null);
  const [batchPollAttempt, setBatchPollAttempt] = useState(0);
  const [brandProfiles, setBrandProfiles] = useState<readonly StudioDocumentView[]>([]);
  const [brandRevisionId, setBrandRevisionId] = useState("");
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
  const requestStorageKey = `export-request:${sourceType}:${sourceId}:${format}:${quality}:${aspect}:${brandRevisionId || "none"}`;
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const freshRequest = useRef(false);
  const failures = useRef(0);
  const capturedJobs = useRef(new Set<string>());
  const isProcessing = job?.status === "queued" || job?.status === "running";

  const historySync = useSerialPolling(`${projectId}:${sourceType}:${sourceId}`, Boolean(projectId && !job && !batchJobs && !newExport), 2500, async (signal) => {
    try {
      const page = await listExportJobs(projectId, sourceType, sourceId, signal);
      signal.throwIfAborted();
      setRecent(page.items);
      const latest = page.items[0];
      if (latest) { const detail = await fetchExportJob(latest.id, signal); signal.throwIfAborted(); setJob(detail); setFormat(latest.format); setQuality(latest.quality); setAspect(detail.aspect ?? "original"); setBrandRevisionId(detail.brandRevisionId ?? ""); }
    } finally { if (!signal.aborted) setHistoryLoading(false); }
  });

  const batchProcessing = Boolean(batchJobs?.some(item => item.status === "queued" || item.status === "running"));
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetchStudio(projectId, controller.signal).then((data) => {
      const profiles = Array.isArray(data.brandProfiles) ? data.brandProfiles : [];
      setBrandProfiles(profiles);
      setBrandRevisionId((current) => current || (profiles.length === 1 ? profiles[0]?.currentRevision.id ?? "" : ""));
    }).catch(() => {
      if (!controller.signal.aborted) setBrandProfiles([]);
    });
    return () => controller.abort();
  }, [projectId]);
  useEffect(() => {
    if (!batchJobs || !batchProcessing) return;
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all(batchJobs.map(item => fetchExportJob(item.id, controller.signal))).then(
        (result) => { if (!disposed) setBatchJobs(result); },
        (reason: unknown) => {
          if (!disposed) {
            setError(reason instanceof Error ? reason.message : "批量导出状态读取失败");
            setBatchPollAttempt(value => value + 1);
          }
        },
      );
    }, Math.min(30_000, POLL_INTERVAL_MS * 2 ** Math.min(batchPollAttempt, 5)));
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, [batchJobs, batchPollAttempt, batchProcessing]);

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
      aspect,
      quality,
      source_type: source.type,
    });
  }, [aspect, format, job, quality, source.type]);

  const submitBatch = async (): Promise<void> => {
    if (source.type !== "asset") return;
    setSubmitting(true);
    setError(null);
    const batchPrefix = `export-batch:${sourceType}:${sourceId}:${format}:${quality}:${brandRevisionId || "none"}`;
    try {
      const results = await Promise.allSettled(ASPECT_OPTIONS.map(async ({ value }) => {
        const storageKey = `${batchPrefix}:${value}`;
        let key: string | null = null;
        try { key = sessionStorage.getItem(storageKey); } catch { /* storage may be disabled */ }
        if (!key) {
          key = crypto.randomUUID();
          try { sessionStorage.setItem(storageKey, key); } catch { /* same-window retry still uses this key */ }
        }
        return createExport(source, format, quality, value, key, brandRevisionId || undefined);
      }));
      const jobs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (jobs.length) setBatchJobs(jobs);
      const failed = results.length - jobs.length;
      if (failed) setError(`${jobs.length} / ${results.length} 个比例任务已提交，${failed} 个任务需要重试。`);
    } finally {
      setSubmitting(false);
    }
  };

  const retryBatchJob = async (value: ExportAspect): Promise<void> => {
    if (source.type !== "asset") return;
    setSubmitting(true);
    setError(null);
    try {
      const key = `export-batch:${sourceType}:${sourceId}:${format}:${quality}:${brandRevisionId || "none"}:${value}:retry`;
      const next = await createExport(source, format, quality, value, key, brandRevisionId || undefined);
      setBatchJobs(current => {
        const existing = current ?? [];
        return existing.some(item => item.aspect === value)
          ? existing.map(item => item.aspect === value ? next : item)
          : [...existing, next];
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "该比例重试失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([sourceType, sourceId, format, quality, aspect, brandRevisionId]);
      if (request.current?.fingerprint !== fingerprint) {
        let storedKey: string | null = null;
        try { if (!freshRequest.current) storedKey = sessionStorage.getItem(requestStorageKey); } catch { /* storage may be disabled */ }
        request.current = { fingerprint, key: storedKey ?? crypto.randomUUID() };
        freshRequest.current = false;
        try { sessionStorage.setItem(requestStorageKey, request.current.key); } catch { /* same-window retry still retains the ref */ }
      }
      const next = await createExport(source, format, quality, aspect, request.current.key, brandRevisionId || undefined);
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
    setBatchJobs(null);
    setBatchPollAttempt(0);
  };

  const content = (
    <>
        <header>
          <div>
            <strong>
              {source.type === "collection" ? "系列 Lookbook" : "单图导出"}
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
                      : (["png", "jpg", "webp", "pdf"] as const)
                    ).map((option) => (
                      <button
                        aria-pressed={format === option}
                        disabled={Boolean(job || batchJobs)}
                        key={option}
                        onClick={() => setFormat(option)}
                        type="button"
                      >
                        {option.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </section>

                {brandProfiles.length ? (
                  <section>
                    <span>品牌资料快照</span>
                    <Select
                      aria-label="导出品牌资料"
                      disabled={Boolean(job || batchJobs)}
                      onChange={(event) => setBrandRevisionId(event.target.value)}
                      value={brandRevisionId}
                    >
                      <option value="">不指定品牌资料</option>
                      {brandProfiles.map((brand) => (
                        <option key={brand.currentRevision.id} value={brand.currentRevision.id}>
                          {String((brand.currentRevision.payload as { name?: unknown }).name ?? "品牌资料")} 修订 {brand.currentRevision.revision}
                        </option>
                      ))}
                    </Select>
                    <p className={styles.exportNote}>项目只有一个当前品牌时会默认锁定该修订；选择后会将品牌快照写入导出任务与打印 PDF，不会修改品牌资料。</p>
                  </section>
                ) : null}

                {source.type === "asset" ? (
                  <section>
                    <span>画面比例</span>
                    <div className={styles.exportOptions}>
                      {ASPECT_OPTIONS.map((option) => (
                        <button
                          aria-pressed={aspect === option.value}
                          disabled={Boolean(job || batchJobs)}
                          key={option.value}
                          onClick={() => setAspect(option.value)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className={styles.exportNote}>
                      选择固定比例会优先保留画面主体，原图比例保留完整边界。
                    </p>
                  </section>
                ) : null}

                {source.type === "asset" ? (
                  <section>
                    <span>图像尺寸</span>
                    <div className={styles.exportOptions}>
                      <button
                        aria-pressed={quality === "standard"}
                        disabled={Boolean(job || batchJobs)}
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
                      {format === "pdf"
                        ? "PDF 适合打印和资料交付，使用当前比例与清晰度生成单页。"
                        : "标准导出适合常规分享；原图高清保留源图尺寸，均不加水印。"}
                    </p>
                  </section>
                ) : (
                  <p className={styles.exportNote}>
                    PDF 将包含系列名、DNA 色板与全部 Look 网格，不加水印。
                  </p>
                )}

                {source.type === "asset" && !job && !batchJobs ? (
                  <button
                    className={styles.exportBatchAction}
                    disabled={submitting}
                    onClick={() => void submitBatch()}
                    type="button"
                  >
                    批量导出四种比例
                  </button>
                ) : null}

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

            {batchJobs ? <BatchExportProgress jobs={batchJobs} expected={ASPECT_OPTIONS} disabled={submitting} onRetry={retryBatchJob} /> : job ? <ExportProgress job={job} /> : null}
            <p>关闭窗口不会取消导出，可从此处重新查看。</p>
            {historySync.error ? <p role="status">{historySync.error}<button onClick={historySync.retry} type="button">重试读取导出历史</button></p> : null}
            {recent.length > 0 ? <label>最近导出<Select aria-label="最近导出" value={job?.id ?? ""} onChange={(event) => {
              const id = event.target.value;
              void fetchExportJob(id).then((next) => { setJob(next); setFormat(next.format); setQuality(next.quality); setAspect(next.aspect ?? "original"); setBrandRevisionId(next.brandRevisionId ?? ""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "导出读取失败"));
            }}>{recent.map((item) => <option key={item.id} value={item.id}>{item.format.toUpperCase()} {new Date(item.createdAt).toLocaleString("zh-CN")}</option>)}</Select></label> : null}
            {error && job ? <button onClick={() => { failures.current = 0; setPollAttempt((value) => value + 1); }} type="button">重试状态查询</button> : null}

            {!batchJobs ? <div className={styles.exportActions}>
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
            </div> : null}
            {batchJobs && !batchProcessing ? <button disabled={submitting} onClick={resetRequest} type="button">新建导出</button> : null}
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

function BatchExportProgress({
  jobs,
  expected,
  disabled,
  onRetry,
}: {
  readonly jobs: readonly ExportJob[];
  readonly expected: readonly { readonly value: ExportAspect; readonly label: string }[];
  readonly disabled: boolean;
  readonly onRetry: (value: ExportAspect) => void;
}) {
  const terminal = jobs.filter((job) => ["succeeded", "failed", "expired"].includes(job.status)).length;
  const labels: Record<ExportJob["status"], string> = {
    expired: "链接已过期",
    failed: "生成失败",
    queued: "等待处理",
    running: "正在生成",
    succeeded: "文件已就绪",
  };
  return (
    <section className={styles.batchProgress} aria-label="批量导出进度" role="status">
      <header>
        <strong>批量导出</strong>
        <span>{terminal} / {expected.length} 项已结束</span>
      </header>
      <ul>
        {expected.map((option) => {
          const job = jobs.find((item) => item.aspect === option.value);
          return (
            <li key={option.value}>
              <span>{option.label}</span>
              <strong>{job ? labels[job.status] : "尚未确认"}</strong>
              {job?.downloadUrl ? <a href={job.downloadUrl}>下载</a> : job?.status === "failed" || job?.status === "expired" || !job ? (
                <button disabled={disabled} onClick={() => onRetry(option.value)} type="button">重试</button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <small>每个比例都是独立任务；关闭窗口不会取消后台导出。</small>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
