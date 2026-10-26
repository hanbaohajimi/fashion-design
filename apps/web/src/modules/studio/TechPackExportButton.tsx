"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { privateFetch } from "../auth/private-fetch";
import styles from "./studio.module.css";
import { useCoutureMotion } from "../../components/motion/use-couture-motion";
interface ExportTask {
  id: string;
  status: string;
  downloadUrl?: string | null;
  error?: { message?: string } | null;
}
async function fetchExport<T>(
  url: string,
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await privateFetch(url, {
    credentials: "include",
    cache: "no-store",
    ...(signal ? { signal } : {}),
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key ?? crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(result?.message ?? "导出请求失败");
  }
  return response.json() as Promise<T>;
}
export function TechPackExportButton(props: {
  projectId: string;
  revisionId: string;
  sourceType?: "tech_pack" | "presentation_set";
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <RevisionExport
      key={
        props.projectId +
        ":" +
        props.revisionId +
        ":" +
        (props.sourceType ?? "tech_pack")
      }
      {...props}
    />
  );
}
function RevisionExport({
  projectId,
  revisionId,
  sourceType = "tech_pack",
  primary = false,
  disabled = false,
}: {
  projectId: string;
  revisionId: string;
  sourceType?: "tech_pack" | "presentation_set";
  primary?: boolean;
  disabled?: boolean;
}) {
  const [task, setTask] = useState<ExportTask | null>(null);
  const motionAnchor = useRef<HTMLAnchorElement>(null);
  const requestedTask = useRef<string | null>(null);
  const play = useCoutureMotion();
  useEffect(() => {
    if (task?.id === requestedTask.current && task?.status === "succeeded" && task.downloadUrl) {
      play("seal", { anchor: motionAnchor.current, eventKey: `export:${task.id}` });
    }
  }, [task, play]);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const flight = useRef(false);
  const mounted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const controllers = requests.current;
    return () => {
      mounted.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchExport<{ items: ExportTask[] }>(
      "/api/exports?projectId=" +
        encodeURIComponent(projectId) +
        "&sourceType=" +
        sourceType +
        "&sourceId=" +
        encodeURIComponent(revisionId),
      undefined,
      undefined,
      controller.signal,
    )
      .then(async (result) => {
        if (controller.signal.aborted || !result.items[0]) return;
        const current = await fetchExport<ExportTask>(
          "/api/exports/" + encodeURIComponent(result.items[0].id),
          undefined,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) setTask(current);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "历史导出读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, [projectId, revisionId, sourceType]);
  const taskId = task?.id;
  const taskStatus = task?.status;
  useEffect(() => {
    if (!taskId || !["queued", "running"].includes(taskStatus ?? "")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await fetchExport<ExportTask>(
          "/api/exports/" + encodeURIComponent(taskId),
          undefined,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setTask(result);
        setError(null);
        if (!["queued", "running"].includes(result.status)) return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "状态更新失败");
      }
      timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [taskId, taskStatus]);
  const submit = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const result = await fetchExport<ExportTask>(
        "/api/exports",
        {
          sourceType,
          studioRevisionId: revisionId,
          format: "pdf",
          quality: "standard",
        },
        key.current,
        controller.signal,
      );
      if (mounted.current) {
        requestedTask.current = result.id;
        setTask(result);
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "导出失败");
    } finally {
      requests.current.delete(controller);
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const waiting = !!task && ["queued", "running"].includes(task.status);
  const canDownload =
    task?.status === "succeeded" && !!task.downloadUrl && !disabled;
  return (
    <div>
      <Button
        variant={primary && !canDownload ? "primary" : "secondary"}
        loading={busy || restoring}
        disabled={waiting || disabled}
        onClick={() => {
          if (task && ["failed", "expired"].includes(task.status))
            key.current = null;
          void submit();
        }}
      >
        导出此修订 PDF
      </Button>
      {waiting ? (
        <p key={task.status} role="status" className={styles.receiptChange}>
          {task.status === "queued" ? "导出排队中" : "正在生成 PDF"}
          ，离开页面后仍会继续。
        </p>
      ) : null}
      {canDownload ? (
        <p>
          <a
            ref={motionAnchor}
            className={primary ? styles.downloadAction : styles.link}
            href={task.downloadUrl ?? undefined}
            download
          >
            下载已生成的
            {sourceType === "presentation_set" ? "展示包" : "技术包"} PDF
          </a>
        </p>
      ) : null}
      {task?.status === "expired" ? (
        <p role="status">此前导出已过期，可重新生成。</p>
      ) : null}
      {task?.error ? <p role="alert">{task.error.message}</p> : null}
      {error ? (
        <p role="alert">
          {error}
          {!waiting ? (
            <Button
              type="button"
              disabled={busy || restoring || disabled}
              onClick={() => void submit()}
            >
              重试导出
            </Button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
