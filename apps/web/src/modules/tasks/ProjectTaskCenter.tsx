"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProjectTaskAction, ProjectTaskDomain, ProjectTaskPage } from "@fashion/shared";
import { useAuth } from "../auth/AuthProvider";
import { fetchTaskPage, taskRequest as request, ProjectTaskProvider, useProjectTaskSource } from "./project-task-source";
import { flushWorkspaceDrafts } from "../../components/drafts/draft-repository";
import { Button, Dialog, Notice } from "../../components/ui";
import { TaskFeedback } from "../../components/TaskFeedback";
import { useLocalActivities } from "./local-activities";
import styles from "./project-tasks.module.css";

const activityDomainLabels: Record<ProjectTaskDomain, string> = {
  assistant: "设计助手",
  workflow: "设计步骤",
  generation: "图片生成",
  agent: "设计运行",
  export: "导出交付",
  runway: "服装秀",
  review: "评审",
};
const activityOutcomeLabels = {
  completed: "已完成",
  failed: "失败",
  canceled: "已停止",
} as const;

export function ProjectTaskCenter({ projectId }: { projectId: string }) {
  const source = useProjectTaskSource();
  return source?.projectId === projectId ? <ProjectTaskCenterContent projectId={projectId} /> : <ProjectTaskProvider projectId={projectId}><ProjectTaskCenterContent projectId={projectId} /></ProjectTaskProvider>;
}

function ProjectTaskCenterContent({ projectId }: { projectId: string }) {
  const source = useProjectTaskSource();
  const { session } = useAuth();
  const cache = useQueryClient();
  const local = useLocalActivities().filter(item => item.accountId === session?.user.id && item.projectId === projectId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) setOpen(true); };
    window.addEventListener("fashion-project:tasks", show);
    return () => window.removeEventListener("fashion-project:tasks", show);
  }, [projectId]);
  const [group, setGroup] = useState("active");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<ProjectTaskPage["items"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const keys = useRef(new Map<string, string>());
  const previousAttention = useRef<number | null>(null);
  const rootKey = ["project-tasks", session?.user.id, projectId];
  if (!source) throw new Error("项目任务数据源未就绪");
  const summary = source.summary;
  const activity = summary.data?.activity;
  const activeTotal = activity ? activity.preparing + activity.executing + activity.awaitingUser : 0;
  const list = useQuery({ queryKey: [...rootKey, group, cursor], enabled: Boolean(session) && open && (group !== "active" || Boolean(cursor)), queryFn: ({ signal }) => fetchTaskPage(`/api/projects/${encodeURIComponent(projectId)}/tasks?group=${group}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal), refetchInterval: open ? 3000 : false, refetchOnWindowFocus: true, refetchIntervalInBackground: false });
  const page = group === "active" && !cursor ? summary : list;
  const items = [...previous, ...(page.data?.items ?? [])].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  useEffect(() => {
    const attention = summary.data?.counts.attention;
    if (typeof attention !== "number" || !Number.isInteger(attention)) return;
    const previousValue = previousAttention.current;
    previousAttention.current = attention;
    if (previousValue !== null && attention > previousValue && !open) {
      toast.info("有新的待处理工作", {
        description: "可能包含新的评审意见或需要确认的设计方案。",
        action: {
          label: "查看任务",
          onClick: () => setOpen(true),
        },
      });
    }
  }, [open, summary.data?.counts.attention]);
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
    if (action.kind === "acknowledge_review") url = `/api/projects/${encodeURIComponent(projectId)}/studio/reviews/${id}/acknowledge`;
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
    <span data-project-tasks className={styles.trigger}><Button size="small" data-guide="project-tasks" onClick={() => setOpen(true)} aria-label={`项目任务${summary.data ? `，${summary.data.counts.running} 项进行中，${summary.data.counts.attention} 项待处理` : ""}`}>
      <span className={styles.desktopLabel}>项目任务</span><span className={styles.mobileLabel}>任务</span>{summary.data && (summary.data.counts.running || summary.data.counts.attention) ? <span className={styles.counts}>{summary.data.counts.running} / {summary.data.counts.attention}</span> : null}
    </Button></span>
    <Dialog open={open} label="项目任务" onClose={() => setOpen(false)} className={styles.dialog}>
      <header><h2>项目任务</h2><Button onClick={() => setOpen(false)}>关闭</Button></header>
      <nav aria-label="任务状态筛选">{[["active", "进行中与待处理"], ["running", "进行中"], ["attention", "待处理"], ["ended", "已结束"]].map(([value, label]) => <Button key={value} aria-pressed={group === value} onClick={() => { setGroup(value ?? "active"); setCursor(null); setPrevious([]); }}>{label}</Button>)}</nav>
      {activity ? <section className={styles.activity} aria-label="项目运行概览">
        <div className={styles.activityHeader}>
          <div>
            <h3>项目运行概览</h3>
            <p>{activeTotal ? `${activeTotal} 项工作正在推进或等待你的决定` : "当前没有正在处理的任务，最近活动会保留在这里。"}</p>
          </div>
          <strong className={styles.activityTotal}>{activeTotal} 项活跃</strong>
        </div>
        <div className={styles.activityMetrics}>
          <div className={styles.activityMetric}>
            <strong>{activity.preparing}</strong>
            <span>准备中 <small>排队 {activity.queued}</small></span>
          </div>
          <div className={styles.activityMetric}>
            <strong>{activity.executing}</strong>
            <span>执行中</span>
          </div>
          <div className={styles.activityMetric}>
            <strong>{activity.awaitingUser}</strong>
            <span>待你处理</span>
          </div>
        </div>
        <div className={styles.activityWaiting} aria-label="等待处理分布">
          <span>等待处理</span>
          <span>补充输入 {activity.waiting.input}</span>
          <span>确认方案 {activity.waiting.confirmation}</span>
          <span>恢复执行 {activity.waiting.resume}</span>
        </div>
        {activity.recent.length ? <details className={styles.activityRecent}>
          <summary>最近活动（{activity.recent.length}）</summary>
          <ol>
            {activity.recent.slice(0, 6).map(item => <li key={item.id}>
              <span><strong>{activityDomainLabels[item.domain]}</strong> · {activityOutcomeLabels[item.outcome]}</span>
              <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </li>)}
          </ol>
        </details> : null}
      </section> : null}
      {page.error || error ? <Notice tone="warning">{error ?? "任务状态读取失败，已读取的记录仍保留。"}<Button onClick={() => { setError(null); void page.refetch(); }}>重新读取</Button></Notice> : null}
      {!page.data && page.isPending ? <p role="status">正在读取任务…</p> : null}
      {page.data && !items.length ? <p>没有对应任务</p> : null}
      {local.length ? <section aria-label="本机上传"><h3>本机上传</h3>{local.map(item => <div key={item.id}><strong>{item.name}</strong><TaskFeedback taskId={item.id} status={["done", "failed", "canceled"].includes(item.stage) ? item.stage === "done" ? "completed" : item.stage : "running"} compact />{!["done", "failed", "canceled"].includes(item.stage) ? <Button onClick={item.cancel}>取消上传</Button> : null}</div>)}</section> : null}
      <ol className={styles.list}>{items.map(item => <li key={item.id}>
        <div><strong>{item.title}</strong><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("zh-CN")}</time></div>
        <TaskFeedback taskId={item.id} status={item.status} compact />
        <div className={styles.actions}><Button onClick={() => { void flushWorkspaceDrafts().then(() => window.location.assign(item.href)); }}>查看所属对象</Button>
          {item.actions.map(action => <Button key={`${action.kind}:${action.targetId}`} disabled={Boolean(busy)} onClick={() => void perform(action, item.id)}>{busy === item.id ? "请求中…" : action.kind === "acknowledge_review" ? "标记已处理" : action.kind === "pause_agent" ? "暂停" : action.kind === "resume_agent" ? "继续执行" : action.kind === "retry_workflow" ? "重试执行" : "停止后续处理"}</Button>)}
        </div>
      </li>)}</ol>
      {page.data?.nextCursor ? <Button onClick={() => { setPrevious(items); setCursor(page.data?.nextCursor ?? null); }}>读取更多</Button> : null}
    </Dialog>
  </>;
}
