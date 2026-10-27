"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectTaskAction, ProjectTaskPage } from "@fashion/shared";
import { useAuth } from "../auth/AuthProvider";
import { privateFetch } from "../auth/private-fetch";
import { flushWorkspaceDrafts } from "../../components/drafts/draft-repository";
import { Button, Dialog, Notice } from "../../components/ui";
import { TaskFeedback } from "../../components/TaskFeedback";
import { useLocalActivities } from "./local-activities";
import styles from "./project-tasks.module.css";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await privateFetch(url, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) throw new Error("任务状态暂不可用，请重试");
  return response.json() as Promise<T>;
}

async function fetchTaskPage(url: string, signal: AbortSignal): Promise<ProjectTaskPage> {
  const value = await request<ProjectTaskPage>(url, { signal });
  if (!value || !Array.isArray(value.items) || !value.counts || !Number.isInteger(value.counts.running) || !Number.isInteger(value.counts.attention)) throw new Error("任务状态响应无效，请重新读取");
  return value;
}

export function ProjectTaskCenter({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const local = useLocalActivities().filter(item => item.accountId === session?.user.id && item.projectId === projectId);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("active");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<ProjectTaskPage["items"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const keys = useRef(new Map<string, string>());
  const rootKey = ["project-tasks", session?.user.id, projectId];
  const summary = useQuery({ queryKey: [...rootKey, "active"], enabled: Boolean(session), queryFn: ({ signal }) => fetchTaskPage(`/api/projects/${encodeURIComponent(projectId)}/tasks`, signal), refetchInterval: query => query.state.data?.counts.running ? 3000 : 15000, refetchOnWindowFocus: true, refetchIntervalInBackground: false, staleTime: 3000 });
  const list = useQuery({ queryKey: [...rootKey, group, cursor], enabled: Boolean(session) && open && (group !== "active" || Boolean(cursor)), queryFn: ({ signal }) => fetchTaskPage(`/api/projects/${encodeURIComponent(projectId)}/tasks?group=${group}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal), refetchInterval: open ? 3000 : false, refetchOnWindowFocus: true, refetchIntervalInBackground: false });
  const page = group === "active" && !cursor ? summary : list;
  const items = [...previous, ...(page.data?.items ?? [])].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  const perform = async (action: ProjectTaskAction, taskId: string) => {
    if (flight.current) return;
    flight.current = true; setBusy(taskId); setError(null);
    let url = "";
    let method = "POST";
    let body: unknown;
    const id = encodeURIComponent(action.targetId);
    if (action.kind === "retry_workflow") { const signature = `${taskId}:retry`; const mutationId = keys.current.get(signature) ?? crypto.randomUUID(); keys.current.set(signature, mutationId); url = `/api/projects/${encodeURIComponent(projectId)}/workflow/nodes/${id}/execute`; body = { mutationId }; }
    if (action.kind === "cancel_reply") url = `/api/agent-conversations/${encodeURIComponent(action.conversationId ?? "")}/message-streams/${encodeURIComponent(action.requestId ?? "")}/cancel`;
    if (action.kind === "cancel_generation") { url = `/api/generations/${id}`; method = "DELETE"; }
    if (action.kind === "cancel_agent" || action.kind === "pause_agent" || action.kind === "resume_agent") { url = `/api/agent-runs/${id}/${action.kind === "pause_agent" ? "pause" : action.kind === "resume_agent" ? "execute" : "cancel"}`; body = { revision: action.version }; }
    if (action.kind === "cancel_runway") {
      const signature = `${taskId}:${action.version}`;
      const requestKey = keys.current.get(signature) ?? crypto.randomUUID(); keys.current.set(signature, requestKey);
      url = `/api/projects/${encodeURIComponent(projectId)}/runway/runs/${id}/cancel`; body = { expectedVersion: action.version, requestKey };
    }
    try { await request(url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); await cache.invalidateQueries({ queryKey: rootKey }); }
    catch { setError("操作结果尚未确认，请重新读取任务状态后再操作。"); void cache.invalidateQueries({ queryKey: rootKey }); }
    finally { setBusy(null); flight.current = false; }
  };
  return <>
    <span data-project-tasks className={styles.trigger}><Button size="small" onClick={() => setOpen(true)} aria-label={`项目任务${summary.data ? `，${summary.data.counts.running} 项进行中，${summary.data.counts.attention} 项待处理` : ""}`}>
      <span className={styles.desktopLabel}>项目任务</span><span className={styles.mobileLabel}>任务</span>{summary.data && (summary.data.counts.running || summary.data.counts.attention) ? <span className={styles.counts}>{summary.data.counts.running} / {summary.data.counts.attention}</span> : null}
    </Button></span>
    <Dialog open={open} label="项目任务" onClose={() => setOpen(false)} className={styles.dialog}>
      <header><h2>项目任务</h2><Button onClick={() => setOpen(false)}>关闭</Button></header>
      <nav aria-label="任务状态筛选">{[["active", "进行中与待处理"], ["running", "进行中"], ["attention", "待处理"], ["ended", "已结束"]].map(([value, label]) => <Button key={value} aria-pressed={group === value} onClick={() => { setGroup(value ?? "active"); setCursor(null); setPrevious([]); }}>{label}</Button>)}</nav>
      {page.error || error ? <Notice tone="warning">{error ?? "任务状态读取失败，已读取的记录仍保留。"}<Button onClick={() => { setError(null); void page.refetch(); }}>重新读取</Button></Notice> : null}
      {!page.data && page.isPending ? <p role="status">正在读取任务…</p> : null}
      {page.data && !items.length ? <p>没有对应任务</p> : null}
      {local.length ? <section aria-label="本机上传"><h3>本机上传</h3>{local.map(item => <div key={item.id}><strong>{item.name}</strong><TaskFeedback taskId={item.id} status={["done", "failed", "canceled"].includes(item.stage) ? item.stage === "done" ? "completed" : item.stage : "running"} compact />{!["done", "failed", "canceled"].includes(item.stage) ? <Button onClick={item.cancel}>取消上传</Button> : null}</div>)}</section> : null}
      <ol className={styles.list}>{items.map(item => <li key={item.id}>
        <div><strong>{item.title}</strong><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("zh-CN")}</time></div>
        <TaskFeedback taskId={item.id} status={item.status} compact />
        <div className={styles.actions}><Button onClick={() => { void flushWorkspaceDrafts().then(() => window.location.assign(item.href)); }}>查看所属对象</Button>
          {item.actions.map(action => <Button key={`${action.kind}:${action.targetId}`} disabled={Boolean(busy)} onClick={() => void perform(action, item.id)}>{busy === item.id ? "请求中…" : action.kind === "pause_agent" ? "暂停" : action.kind === "resume_agent" ? "继续执行" : action.kind === "retry_workflow" ? "重试执行" : "停止后续处理"}</Button>)}
        </div>
      </li>)}</ol>
      {page.data?.nextCursor ? <Button onClick={() => { setPrevious(items); setCursor(page.data?.nextCursor ?? null); }}>读取更多</Button> : null}
    </Dialog>
  </>;
}
