"use client";

import type {
  AgentConversationSummary,
  AgentMessageView,
} from "@fashion/shared";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, useValue } from "tldraw";

import { BoardProjectContext } from "../board-context";
import type { BoardPersistStatus } from "../hooks/useBoardPersist";
import { CandidateGrid } from "../generation/CandidateGrid";
import { useGenerationWorkspace } from "../generation/GenerationWorkspace";
import {
  createAgentConversation,
  listAgentConversations,
  listAgentMessages,
  sendAgentMessage,
  updateAgentConversation,
} from "./agent-api";
import styles from "./board-agent-panel.module.css";

interface BoardAgentPanelProps {
  readonly boardStatus: BoardPersistStatus;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

const TERMINAL_TASKS = new Set([
  "succeeded",
  "failed",
  "moderation_failed",
  "canceled",
]);

const STATUS_LABELS: Readonly<Record<string, string>> = {
  canceled: "已取消",
  failed: "创作失败",
  moderation_failed: "未通过内容审核",
  queued: "等待处理",
  running: "正在创作",
  succeeded: "创作完成",
};

export function BoardAgentPanel({
  boardStatus,
  collapsed,
  onToggle,
}: BoardAgentPanelProps) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const generation = useGenerationWorkspace();
  const [conversations, setConversations] = useState<
    readonly AgentConversationSummary[]
  >([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<readonly AgentMessageView[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [contextOverride, setContextOverride] = useState<{
    readonly excludedIds: readonly string[];
    readonly selectionKey: string;
  }>({ excludedIds: [], selectionKey: "" });
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [conversationMutating, setConversationMutating] = useState(false);
  const [conversationActionsOpen, setConversationActionsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [hydrateRevision, setHydrateRevision] = useState(0);
  const [messageRevision, setMessageRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScroll = useRef(false);
  const initialConversationRef = useRef<
    Promise<AgentConversationSummary> | null
  >(null);

  const selection = useValue(
    "agent-selection-context",
    () =>
      editor.getSelectedShapes().map((shape) => ({
        id: shape.id,
        label: shapeLabel(shape.type, shape.props),
      })),
    [editor],
  );
  const selectionKey = selection.map((item) => item.id).join("|");
  const excludedIds =
    contextOverride.selectionKey === selectionKey
      ? new Set(contextOverride.excludedIds)
      : new Set<string>();
  const contextItems = selection.filter((item) => !excludedIds.has(item.id));
  const contextReady =
    contextItems.length === 0 || boardStatus === "ready" || boardStatus === "saved";

  const refreshConversations = useCallback(async () => {
    const response = await listAgentConversations(projectId);
    setConversations(response.items);
    return response.items;
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    const hydrate = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        let items = await refreshConversations();
        if (items.length === 0) {
          initialConversationRef.current ??= createAgentConversation(
            projectId,
          ).catch((cause: unknown) => {
            initialConversationRef.current = null;
            throw cause;
          });
          const created = await initialConversationRef.current;
          items = [created];
          if (!disposed) setConversations(items);
        }
        if (!disposed) {
          setActiveConversationId(items[0]?.id ?? "");
          if (!items[0]?.id) setLoading(false);
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "Agent 初始化失败");
          setLoading(false);
        }
      }
    };
    void hydrate();
    return () => {
      disposed = true;
    };
  }, [hydrateRevision, projectId, refreshConversations]);

  useEffect(() => {
    if (!activeConversationId) return;
    let disposed = false;
    void listAgentMessages(activeConversationId)
      .then((response) => {
        if (!disposed) {
          setMessages(response.items);
          setMessageCursor(response.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "消息读取失败");
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeConversationId, messageRevision]);

  useEffect(() => {
    if (skipNextAutoScroll.current) {
      skipNextAutoScroll.current = false;
      return;
    }
    if (!collapsed) endRef.current?.scrollIntoView({ block: "end" });
  }, [collapsed, messages]);

  useEffect(() => {
    if (collapsed) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (
        event.key === "Escape" &&
        window.matchMedia("(max-width: 1024px)").matches
      ) {
        onToggle();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [collapsed, onToggle]);

  const taskById = useMemo(
    () => new Map(generation.tasks.map((task) => [task.id, task] as const)),
    [generation.tasks],
  );
  const activeConversation = conversations.find(
    (item) => item.id === activeConversationId,
  );
  const linkedTaskIds = new Set(
    messages.flatMap((message) =>
      message.generationTaskId ? [message.generationTaskId] : [],
    ),
  );
  const projectTasks = generation.tasks
    .filter((task) => !linkedTaskIds.has(task.id))
    .slice(0, 6);

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (!activeConversationId || !messageCursor || loadingOlder) return;
    const timeline = timelineRef.current;
    const previousHeight = timeline?.scrollHeight ?? 0;
    setLoadingOlder(true);
    setError(null);
    try {
      const response = await listAgentMessages(
        activeConversationId,
        messageCursor,
      );
      skipNextAutoScroll.current = true;
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id));
        return [
          ...response.items.filter((message) => !existing.has(message.id)),
          ...current,
        ];
      });
      setMessageCursor(response.nextCursor);
      window.requestAnimationFrame(() => {
        if (timeline)
          timeline.scrollTop += timeline.scrollHeight - previousHeight;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更早消息读取失败");
    } finally {
      setLoadingOlder(false);
    }
  }, [activeConversationId, loadingOlder, messageCursor]);

  const renameConversation = async (): Promise<void> => {
    const title = titleDraft.trim();
    if (!activeConversationId || !title || conversationMutating) return;
    setConversationMutating(true);
    setError(null);
    try {
      const updated = await updateAgentConversation(activeConversationId, {
        title,
      });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
      setEditingTitle(false);
      setConversationActionsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话重命名失败");
    } finally {
      setConversationMutating(false);
    }
  };

  const archiveConversation = async (): Promise<void> => {
    if (!activeConversationId || conversationMutating) return;
    setConversationMutating(true);
    setError(null);
    try {
      await updateAgentConversation(activeConversationId, { archived: true });
      const remaining = conversations.filter(
        (conversation) => conversation.id !== activeConversationId,
      );
      const next = remaining[0] ?? (await createAgentConversation(projectId));
      setConversations(remaining.length > 0 ? remaining : [next]);
      setMessages([]);
      setMessageCursor(null);
      setLoading(true);
      setActiveConversationId(next.id);
      setConversationActionsOpen(false);
      setEditingTitle(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话归档失败");
    } finally {
      setConversationMutating(false);
    }
  };

  const submit = useCallback(
    async (
      content: string,
      shapeIds: readonly string[],
      retry?: {
        readonly assistantMessageId: string;
        readonly clientRequestId: string;
        readonly userMessageId: string;
      },
    ): Promise<void> => {
      const normalized = content.trim();
      if (!normalized || !activeConversationId || sending) return;
      if (
        shapeIds.length > 0 &&
        boardStatus !== "ready" &&
        boardStatus !== "saved"
      ) {
        setError(
          boardStatus === "offline"
            ? "选中的画布元素尚未同步；恢复联网并保存后才能作为上下文发送。"
            : "选中的画布元素正在保存，保存完成后即可发送。",
        );
        return;
      }
      const clientRequestId = retry?.clientRequestId ?? crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const optimisticUser = optimisticMessage({
        clientRequestId,
        content: normalized,
        context: { fileAssetIds: [], shapeIds },
        id: `optimistic-user-${clientRequestId}`,
        role: "user",
        status: "completed",
        timestamp,
      });
      const optimisticAssistant = optimisticMessage({
        clientRequestId: null,
        content: "正在理解你的设计需求…",
        context: null,
        id: `optimistic-assistant-${clientRequestId}`,
        replyToId: optimisticUser.id,
        role: "assistant",
        status: "pending",
        timestamp,
      });
      if (retry) {
        setMessages((current) =>
          current.map((message) =>
            message.id === retry.assistantMessageId
              ? {
                  ...message,
                  content: "正在理解你的设计需求…",
                  error: null,
                  status: "pending",
                  updatedAt: timestamp,
                }
              : message,
          ),
        );
      } else {
        setMessages((current) => [
          ...current,
          optimisticUser,
          optimisticAssistant,
        ]);
        setPrompt("");
      }
      setSending(true);
      setError(null);
      try {
        const result = await sendAgentMessage(activeConversationId, {
          clientRequestId,
          content: normalized,
          fileAssetIds: [],
          shapeIds,
        });
        setMessages((current) =>
          retry
            ? current.map((message) => {
                if (message.id === retry.userMessageId)
                  return result.userMessage;
                if (message.id === retry.assistantMessageId)
                  return result.assistantMessage;
                return message;
              })
            : [
                ...current.filter(
                  (message) =>
                    message.id !== optimisticUser.id &&
                    message.id !== optimisticAssistant.id,
                ),
                result.userMessage,
                result.assistantMessage,
              ],
        );
        if (result.taskId) {
          void generation.track(result.taskId).catch(() => {
            setError("生成任务已创建，状态同步稍有延迟");
          });
        }
        void refreshConversations()
          .then((refreshed) => {
            if (
              refreshed.length > 0 &&
              !refreshed.some((item) => item.id === activeConversationId)
            ) {
              setActiveConversationId(refreshed[0]?.id ?? "");
            }
          })
          .catch(() => undefined);
      } catch (cause) {
        if (retry) {
          setMessageRevision((current) => current + 1);
        } else {
          setMessages((current) =>
            current.filter(
              (message) =>
                message.id !== optimisticUser.id &&
                message.id !== optimisticAssistant.id,
            ),
          );
          setPrompt(normalized);
        }
        setError(cause instanceof Error ? cause.message : "消息发送失败");
      } finally {
        setSending(false);
      }
    },
    [
      activeConversationId,
      boardStatus,
      generation,
      refreshConversations,
      sending,
    ],
  );

  const newConversation = async (): Promise<void> => {
    if (sending) return;
    setError(null);
    try {
      const created = await createAgentConversation(projectId);
      setConversations((current) => [created, ...current]);
      setLoading(true);
      setActiveConversationId(created.id);
      setMessages([]);
      setMessageCursor(null);
      setConversationActionsOpen(false);
      setEditingTitle(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新会话创建失败");
    }
  };

  if (collapsed) {
    return (
      <aside
        aria-label="设计助手（已折叠）"
        className={styles.collapsedRail}
        data-agent-panel
      >
        <button
          aria-label="展开设计助手"
          className={styles.railButton}
          onClick={onToggle}
          type="button"
        >
          <AgentMark />
        </button>
        <span className={styles.railLabel}>Design agent</span>
        {generation.tasks.some((task) => !TERMINAL_TASKS.has(task.status)) ? (
          <i className={styles.activityDot} title="有生成任务进行中" />
        ) : null}
      </aside>
    );
  }

  return (
    <>
      <button
        aria-label="关闭设计助手"
        className={styles.mobileScrim}
        onClick={onToggle}
        type="button"
      />
      <aside
        aria-busy={loading || sending}
        aria-label="设计助手"
        className={styles.panel}
        data-agent-panel
      >
        <header className={styles.header}>
          <div className={styles.identity}>
            <AgentMark />
            <div>
              <span>DESIGN AGENT</span>
              <strong>{activeConversation?.title ?? "新的设计对话"}</strong>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              aria-label="新建会话"
              onClick={() => void newConversation()}
              title="新建会话"
              type="button"
            >
              <PlusIcon />
            </button>
            <button
              aria-expanded={conversationActionsOpen}
              aria-label="管理当前会话"
              onClick={() => {
                setConversationActionsOpen((current) => !current);
                setEditingTitle(false);
                setTitleDraft(activeConversation?.title ?? "");
              }}
              title="管理会话"
              type="button"
            >
              <MoreIcon />
            </button>
            <button
              aria-label="折叠设计助手"
              onClick={onToggle}
              title="折叠"
              type="button"
            >
              <CollapseIcon />
            </button>
          </div>
        </header>

        {conversationActionsOpen && activeConversation ? (
          <section className={styles.conversationActions} aria-label="会话管理">
            {editingTitle ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void renameConversation();
                }}
              >
                <label>
                  <span>会话标题</span>
                  <input
                    autoFocus
                    disabled={conversationMutating}
                    maxLength={80}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    value={titleDraft}
                  />
                </label>
                <div>
                  <button
                    disabled={conversationMutating || !titleDraft.trim()}
                    type="submit"
                  >
                    保存
                  </button>
                  <button onClick={() => setEditingTitle(false)} type="button">
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button onClick={() => setEditingTitle(true)} type="button">
                  重命名会话
                </button>
                <button
                  disabled={conversationMutating}
                  onClick={() => void archiveConversation()}
                  type="button"
                >
                  {conversationMutating ? "归档中…" : "归档会话"}
                </button>
              </>
            )}
          </section>
        ) : null}

        {conversations.length > 1 ? (
          <label className={styles.historySelect}>
            <span>会话历史</span>
            <select
              aria-label="切换 Agent 会话"
              onChange={(event) => {
                setLoading(true);
                setMessages([]);
                setMessageCursor(null);
                setConversationActionsOpen(false);
                setActiveConversationId(event.target.value);
              }}
              value={activeConversationId}
            >
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className={styles.timeline} ref={timelineRef}>
          {messageCursor ? (
            <button
              className={styles.loadOlder}
              disabled={loadingOlder}
              onClick={() => void loadOlderMessages()}
              type="button"
            >
              {loadingOlder ? "正在读取…" : "载入更早消息"}
            </button>
          ) : null}
          {loading && messages.length === 0 ? (
            <div className={styles.loadingState}>
              <i />
              <span>正在恢复项目会话</span>
            </div>
          ) : error && messages.length === 0 ? (
            <section className={styles.loadError} role="alert">
              <strong>项目会话暂时无法恢复</strong>
              <p>{error}</p>
              <button
                onClick={() => {
                  if (activeConversationId) {
                    setLoading(true);
                    setError(null);
                    setMessageRevision((current) => current + 1);
                    return;
                  }
                  setHydrateRevision((current) => current + 1);
                }}
                type="button"
              >
                重新连接
              </button>
            </section>
          ) : messages.length === 0 ? (
            <section className={styles.welcome}>
              <span>START WITH A DIRECTION</span>
              <h2>从一条设计想法开始</h2>
              <p>
                描述服装方向，或先在白板上选中参考素材。Agent
                会判断是继续讨论，还是创建生成任务。
              </p>
              <div>
                <button
                  onClick={() =>
                    setPrompt("基于选中的参考，提出三个可执行的设计方向")
                  }
                  type="button"
                >
                  提炼设计方向
                </button>
                <button
                  onClick={() =>
                    setPrompt("生成一版强调面料质感的完整成衣效果图")
                  }
                  type="button"
                >
                  生成成衣方案
                </button>
              </div>
            </section>
          ) : null}

          {messages.map((message) => {
            const task = message.generationTaskId
              ? taskById.get(message.generationTaskId)
              : undefined;
            const repliedUser = message.replyToId
              ? messages.find((item) => item.id === message.replyToId)
              : undefined;
            return (
              <article
                className={styles.message}
                data-role={message.role}
                key={message.id}
              >
                <div className={styles.messageMeta}>
                  <span>{message.role === "user" ? "你" : "设计助手"}</span>
                  <time dateTime={message.createdAt}>
                    {formatTime(message.createdAt)}
                  </time>
                </div>
                <p>{message.content}</p>
                {message.context?.shapeIds.length ? (
                  <small>
                    {message.context.shapeIds.length} 个白板元素作为上下文
                  </small>
                ) : null}
                {message.status === "pending" ? (
                  <div className={styles.agentProgress} role="status">
                    <i />
                    理解需求
                  </div>
                ) : null}
                {task ? (
                  <div className={styles.taskCard} data-status={task.status}>
                    <div>
                      <span>{STATUS_LABELS[task.status] ?? task.status}</span>
                      <small>
                        {task.connection === "sse"
                          ? "实时更新"
                          : "实时连接中断 · 轮询同步"}
                      </small>
                    </div>
                    {!TERMINAL_TASKS.has(task.status) ? (
                      <button
                        onClick={() => void generation.cancel(task.id)}
                        type="button"
                      >
                        停止
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {message.status === "failed" && repliedUser ? (
                  <button
                    className={styles.retryButton}
                    disabled={sending || !repliedUser.clientRequestId}
                    onClick={() =>
                      repliedUser.clientRequestId
                        ? void submit(
                            repliedUser.content,
                            repliedUser.context?.shapeIds ?? [],
                            {
                              assistantMessageId: message.id,
                              clientRequestId: repliedUser.clientRequestId,
                              userMessageId: repliedUser.id,
                            },
                          )
                        : undefined
                    }
                    type="button"
                  >
                    重试本次请求
                  </button>
                ) : null}
              </article>
            );
          })}
          {projectTasks.length > 0 ? (
            <section className={styles.projectTasks} aria-label="项目生成记录">
              <header>
                <span>PROJECT GENERATIONS</span>
                <strong>生成记录</strong>
              </header>
              {projectTasks.map((task) => (
                <div
                  className={styles.taskCard}
                  data-status={task.status}
                  key={task.id}
                >
                  <div>
                    <span>{STATUS_LABELS[task.status] ?? task.status}</span>
                    <small>
                      {task.connection === "sse"
                        ? "实时更新"
                        : "实时连接中断 · 轮询同步"}
                    </small>
                  </div>
                  {!TERMINAL_TASKS.has(task.status) ? (
                    <button
                      onClick={() => void generation.cancel(task.id)}
                      type="button"
                    >
                      停止
                    </button>
                  ) : task.status === "failed" ||
                    task.status === "moderation_failed" ? (
                    <button
                      onClick={() => void generation.retry(task.id)}
                      type="button"
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          <div className={styles.results}>
            <CandidateGrid />
          </div>
          <div ref={endRef} />
        </div>

        <div className={styles.composerDock}>
          {contextItems.length > 0 ? (
            <div className={styles.contextStrip} aria-label="发送上下文">
              <span>画布上下文</span>
              <div>
                {contextItems.map((item) => (
                  <button
                    aria-label={`移除 ${item.label}`}
                    key={item.id}
                    onClick={() =>
                      setContextOverride((current) => ({
                        excludedIds:
                          current.selectionKey === selectionKey
                            ? [...current.excludedIds, item.id]
                            : [item.id],
                        selectionKey,
                      }))
                    }
                    title="点击移除"
                    type="button"
                  >
                    {item.label}
                    <b aria-hidden="true">×</b>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className={styles.composer}>
            <span>告诉 Agent 你想完成什么</span>
            <textarea
              disabled={sending || !activeConversationId}
              maxLength={4_000}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit(
                    prompt,
                    contextItems.map((item) => item.id),
                  );
                }
              }}
              placeholder="例如：保留廓形，把面料改成轻薄防水材质…"
              rows={3}
              value={prompt}
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.composerFooter}>
            <span>
              {contextItems.length > 0
                ? contextReady
                  ? `${contextItems.length} 项参考`
                  : `${contextItems.length} 项参考 · 保存中`
                : "未附加画布内容"}
              {prompt.length > 0 ? ` · ${prompt.length}/4000` : ""}
            </span>
            <button
              disabled={
                sending || prompt.trim().length === 0 || !contextReady
              }
              onClick={() =>
                void submit(
                  prompt,
                  contextItems.map((item) => item.id),
                )
              }
              type="button"
            >
              {sending ? "处理中…" : "发送"}
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function optimisticMessage(input: {
  readonly clientRequestId: string | null;
  readonly content: string;
  readonly context: AgentMessageView["context"];
  readonly id: string;
  readonly replyToId?: string;
  readonly role: AgentMessageView["role"];
  readonly status: AgentMessageView["status"];
  readonly timestamp: string;
}): AgentMessageView {
  return {
    clientRequestId: input.clientRequestId,
    content: input.content,
    context: input.context,
    createdAt: input.timestamp,
    error: null,
    generationTaskId: null,
    id: input.id,
    replyToId: input.replyToId ?? null,
    role: input.role,
    status: input.status,
    updatedAt: input.timestamp,
  };
}

function shapeLabel(type: string, props: unknown): string {
  if (props && typeof props === "object" && "title" in props) {
    const title = (props as { readonly title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  const labels: Readonly<Record<string, string>> = {
    arrow: "连接箭头",
    bookmark: "网页参考",
    draw: "手绘线稿",
    embed: "嵌入内容",
    "fashion-fabric": "面料",
    "fashion-frame": "组织框",
    "fashion-image": "图片参考",
    "fashion-note": "灵感便签",
    "fashion-swatch": "色卡",
    frame: "画板框",
    geo: "几何图形",
    image: "图片参考",
    line: "线条",
    note: "便签",
    text: "文字说明",
    video: "视频参考",
  };
  return labels[type] ?? "白板元素";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function AgentMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 2.8 14 9l6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2 2-6.2Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m12.5 5-5 5 5 5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4 10 12-6-4.5 12-2-4-5.5-2Z" />
    </svg>
  );
}
