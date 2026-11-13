"use client";

import type {
  AssistantDelegationCadence,
  AssistantDelegationInput,
  AssistantDelegationView,
} from "@fashion/shared";
import { useEffect, useMemo, useState } from "react";

import { Button, Input, Select, Textarea } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import {
  createAssistantDelegationRemote,
  deleteAssistantDelegationRemote,
  fetchAssistantDelegations,
  runAssistantDelegationRemote,
  updateAssistantDelegationRemote,
} from "./assistant-delegations-api";
import ui from "./assistant-context.module.css";

const cadenceLabels: Record<AssistantDelegationCadence, string> = {
  DAILY: "每天",
  MONTHLY: "每月",
  ONCE: "只运行一次",
  WEEKLY: "每周",
};

const statusLabels: Record<AssistantDelegationView["status"], string> = {
  ACTIVE: "等待执行",
  COMPLETED: "已完成",
  FAILED: "上次失败",
  PAUSED: "已暂停",
  RUNNING: "执行中",
};

function defaultDateTime(): string {
  const value = new Date(Date.now() + 60 * 60 * 1_000);
  value.setSeconds(0, 0);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  });
}

function replaceItem(
  items: readonly AssistantDelegationView[],
  next: AssistantDelegationView,
): readonly AssistantDelegationView[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

interface Props {
  readonly canEdit: boolean;
  readonly conversationId: string;
  readonly onClose: () => void;
  readonly projectId: string;
}

export function AssistantDelegationsPanel({
  canEdit,
  conversationId,
  onClose,
  projectId,
}: Props) {
  const [items, setItems] = useState<readonly AssistantDelegationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<AssistantDelegationCadence>("ONCE");
  const [nextRunAt, setNextRunAt] = useState(defaultDateTime);
  const [saving, setSaving] = useState(false);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const next = await fetchAssistantDelegations(projectId, controller.signal);
        if (active) {
          setItems(next);
          setError(null);
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setError(userFacingError(cause, "设计委托暂时无法读取"));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 12_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [projectId]);

  const create = async () => {
    if (!canEdit) return;
    if (!conversationId) {
      setError("请先新建或选择一段持续设计对话，再创建委托。");
      return;
    }
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    const date = new Date(nextRunAt);
    if (!trimmedName || !trimmedPrompt) {
      setError("请填写委托名称和要交给助手的任务。");
      return;
    }
    if (!Number.isFinite(date.getTime()) || date <= new Date()) {
      setError("下一次执行时间必须晚于现在。");
      return;
    }
    setSaving(true);
    setError(null);
    const input: AssistantDelegationInput = {
      cadence,
      conversationId,
      name: trimmedName,
      nextRunAt: date.toISOString(),
      prompt: trimmedPrompt,
      timeZone,
    };
    try {
      const created = await createAssistantDelegationRemote(
        projectId,
        input,
        crypto.randomUUID(),
      );
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setName("");
      setPrompt("");
      setCadence("ONCE");
      setNextRunAt(defaultDateTime());
    } catch (cause) {
      setError(userFacingError(cause, "设计委托保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  const mutate = async (item: AssistantDelegationView, action: "delete" | "run" | "toggle") => {
    if (!canEdit) return;
    setBusy(item.id);
    setError(null);
    try {
      if (action === "delete") {
        await deleteAssistantDelegationRemote(item.id);
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      } else {
        const next = action === "run"
          ? await runAssistantDelegationRemote(item.id)
          : await updateAssistantDelegationRemote(item.id, { status: item.status === "ACTIVE" ? "PAUSED" : "ACTIVE" });
        setItems((current) => replaceItem(current, next));
      }
    } catch (cause) {
      setError(userFacingError(cause, "设计委托操作失败，请重试"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={ui.delegationsPanel} aria-label="设计委托">
      <header className={ui.delegationsHeader}>
        <div>
          <strong>设计委托</strong>
          <span>让助手在你离开时继续研究、复盘或整理下一步。</span>
        </div>
        <button
          aria-label="关闭设计委托"
          className={ui.skillsClose}
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      {!conversationId ? (
        <p className={ui.delegationsEmpty}>先新建或选择持续设计对话，委托才知道要把结果写回哪条创作主线。</p>
      ) : null}
      {loading ? <p className={ui.delegationsEmpty} role="status">正在读取委托…</p> : null}
      {!loading && !items.length ? <p className={ui.delegationsEmpty}>还没有委托。可以先设置一次“检查当前方案”，再决定是否变成每周复盘。</p> : null}
      {items.length ? (
        <ul className={ui.delegationList}>
          {items.map((item) => (
            <li key={item.id}>
              <div className={ui.delegationMeta}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{cadenceLabels[item.cadence]} · {statusLabels[item.status]}</span>
                </div>
                <time dateTime={item.nextRunAt}>{item.status === "COMPLETED" ? "已完成" : `下次 ${formatDate(item.nextRunAt)}`}</time>
              </div>
              <p>{item.prompt}</p>
              {item.lastError ? <small className={ui.delegationError} role="alert">{item.lastError}</small> : null}
              {canEdit ? (
                <div className={ui.delegationActions}>
                  <Button disabled={busy === item.id || item.status === "RUNNING"} onClick={() => void mutate(item, "run")} size="small">
                    {busy === item.id ? "处理中…" : "立即运行"}
                  </Button>
                  <Button disabled={busy === item.id || item.status === "RUNNING"} onClick={() => void mutate(item, "toggle")} size="small" variant="ghost">
                    {item.status === "ACTIVE" ? "暂停" : "恢复"}
                  </Button>
                  <Button disabled={busy === item.id || item.status === "RUNNING"} onClick={() => void mutate(item, "delete")} size="small" variant="ghost">
                    删除
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form
          className={ui.delegationSave}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div>
            <strong>新建委托</strong>
            <span>结果会作为一条助手消息回到当前持续设计对话。</span>
          </div>
          <Input aria-label="委托名称" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：每周复盘当前系列" value={name} />
          <Textarea aria-label="委托内容" maxLength={4_000} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：检查当前设计是否仍符合目标，列出下周最值得验证的三个方向。" rows={3} value={prompt} />
          <div className={ui.delegationFields}>
            <label>
              频率
              <Select aria-label="委托频率" onChange={(event) => setCadence(event.target.value as AssistantDelegationCadence)} value={cadence}>
                {Object.entries(cadenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label>
              首次执行
              <Input aria-label="首次执行时间" onChange={(event) => setNextRunAt(event.target.value)} type="datetime-local" value={nextRunAt} />
            </label>
          </div>
          <Button disabled={!conversationId || saving} loading={saving} size="small" type="submit">保存委托</Button>
        </form>
      ) : null}
      {error ? <p className={ui.delegationStatus} role="alert">{error}</p> : null}
    </section>
  );
}
