"use client";

import type {
  AgentConversationSummary,
  AgentMessageView,
} from "@fashion/shared";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type TLShape, type TLShapeId, useEditor } from "tldraw";

import { BoardProjectContext } from "../board-context";
import type { BoardPersistStatus } from "../hooks/useBoardPersist";
import { useGenerationWorkspace } from "../generation/GenerationWorkspace";
import { resolveRoleBadgeLabel } from "../shapes/RoleBadge";
import {
  createAgentConversation,
  getProjectConversationRequest,
  listAgentConversations,
  listAgentMessages,
  sendAgentMessage,
  updateAgentConversation,
  MAX_AGENT_CONTEXT_ITEMS,
  MAX_AGENT_MESSAGE_LENGTH,
  validateAgentMessage,
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
  const [draftShapeIds, setDraftShapeIds] = useState<readonly TLShapeId[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"conversations" | "generations">(
    "conversations",
  );
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [conversationMutating, setConversationMutating] = useState(false);
  const [conversationActionsOpen, setConversationActionsOpen] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [hydrateRevision, setHydrateRevision] = useState(0);
  const [messageRevision, setMessageRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const skipNextAutoScroll = useRef(false);
  const initialConversationRef = useRef<{
    readonly projectId: string;
    readonly promise: Promise<AgentConversationSummary>;
  } | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const contextItems = draftShapeIds.flatMap((id) => {
    const shape = editor.getShape(id);
    return shape ? [attachmentFromShape(shape)] : [];
  });
  const contextLimitExceeded = contextItems.length > MAX_AGENT_CONTEXT_ITEMS;
  const contextReady =
    !contextLimitExceeded &&
    (contextItems.length === 0 ||
      boardStatus === "ready" ||
      boardStatus === "saved");
  const activeConversation = conversations.find(
    (item) => item.id === activeConversationId,
  );
  const activeConversationBelongsToProject =
    activeConversation?.projectId === projectId;

  const refreshConversations = useCallback(async () => {
    const targetProjectId = projectId;
    const response = await listAgentConversations(projectId);
    if (response.items.some((item) => item.projectId !== targetProjectId)) {
      throw new Error("会话列表包含其他项目的数据，请重新加载");
    }
    if (projectIdRef.current === targetProjectId) {
      setConversations(response.items);
    }
    return response.items;
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    const hydrate = async (): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      try {
        let items = await refreshConversations();
        if (items.length === 0) {
          const request = getProjectConversationRequest(
            initialConversationRef.current,
            projectId,
            createAgentConversation,
          );
          initialConversationRef.current = request;
          let created: AgentConversationSummary;
          try {
            created = await request.promise;
          } finally {
            if (initialConversationRef.current === request) {
              initialConversationRef.current = null;
            }
          }
          if (created.projectId !== projectId) {
            throw new Error("新会话不属于当前项目，请重新加载");
          }
          items = [created];
          if (!disposed) setConversations(items);
        }
        if (!disposed) {
          setActiveConversationId(items[0]?.id ?? "");
          if (!items[0]?.id) setLoading(false);
        }
      } catch (cause) {
        if (!disposed) {
          setLoadError(
            cause instanceof Error ? cause.message : "Agent 初始化失败",
          );
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
    if (!activeConversationId || !activeConversationBelongsToProject) return;
    const targetProjectId = projectId;
    let disposed = false;
    void listAgentMessages(activeConversationId)
      .then((response) => {
        if (!disposed && projectIdRef.current === targetProjectId) {
          setLoadError(null);
          setMessages(response.items);
          setMessageCursor(response.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed && projectIdRef.current === targetProjectId) {
          setLoadError(cause instanceof Error ? cause.message : "消息读取失败");
        }
      })
      .finally(() => {
        if (!disposed && projectIdRef.current === targetProjectId) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    activeConversationBelongsToProject,
    activeConversationId,
    messageRevision,
    projectId,
  ]);

  useEffect(() => {
    if (skipNextAutoScroll.current) {
      skipNextAutoScroll.current = false;
      return;
    }
    if (!collapsed) endRef.current?.scrollIntoView({ block: "end" });
  }, [collapsed, messages]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      if (!collapsed && window.matchMedia("(max-width: 1280px)").matches) {
        onToggle();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [collapsed, historyOpen, onToggle]);

  useEffect(() => {
    let previousSelectionKey = "";
    return editor.store.listen(
      () => {
        const selectedShapes = editor.getSelectedShapes();
        if (selectedShapes.length === 0) return;
        const selectedIds = selectedShapes.map((shape) => shape.id);
        const selectedKey = selectedIds.join("|");
        if (selectedKey === previousSelectionKey) return;
        previousSelectionKey = selectedKey;
        setDraftShapeIds(selectedIds.slice(0, MAX_AGENT_CONTEXT_ITEMS));
        if (!selectedShapes.some(isImageShape)) return;
        setHistoryOpen(false);
        const selectedGarment =
          selectedShapes.length === 1 ? selectedShapes[0] : undefined;
        const selectedGarmentProps = selectedGarment?.props as
          | Readonly<Record<string, unknown>>
          | undefined;
        const hasLocalEditEntry =
          selectedGarment?.type === "fashion-image" &&
          selectedGarmentProps?.role === "garment_ref" &&
          typeof selectedGarmentProps.assetId === "string" &&
          selectedGarmentProps.assetId.length > 0 &&
          typeof selectedGarmentProps.url === "string" &&
          selectedGarmentProps.url.length > 0;
        if (hasLocalEditEntry) return;
        if (collapsed) onToggle();
        window.requestAnimationFrame(() => composerInputRef.current?.focus());
      },
      { scope: "session", source: "user" },
    );
  }, [collapsed, editor, onToggle]);

  useEffect(
    () =>
      editor.store.listen(
        () => {
          const existing = new Set(
            editor.getCurrentPageShapes().map((shape) => shape.id),
          );
          setDraftShapeIds((current) =>
            current.filter((id) => existing.has(id)),
          );
        },
        { scope: "document" },
      ),
    [editor],
  );

  const taskById = useMemo(
    () => new Map(generation.tasks.map((task) => [task.id, task] as const)),
    [generation.tasks],
  );
  const sendUnavailableReason = sending
    ? "Agent 正在处理"
    : !activeConversationBelongsToProject
      ? "会话尚未就绪"
      : !prompt.trim()
        ? "请输入编辑描述"
        : !contextReady
          ? contextLimitExceeded
            ? `附件不能超过 ${MAX_AGENT_CONTEXT_ITEMS} 项`
            : "附件正在保存"
          : null;

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (
      !activeConversationBelongsToProject ||
      !activeConversationId ||
      !messageCursor ||
      loadingOlder
    )
      return;
    const targetConversationId = activeConversationId;
    const targetProjectId = projectId;
    const timeline = timelineRef.current;
    const previousHeight = timeline?.scrollHeight ?? 0;
    setLoadingOlder(true);
    setError(null);
    try {
      const response = await listAgentMessages(
        targetConversationId,
        messageCursor,
      );
      if (
        projectIdRef.current !== targetProjectId ||
        activeConversationIdRef.current !== targetConversationId
      )
        return;
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
      if (projectIdRef.current === targetProjectId) {
        setError(cause instanceof Error ? cause.message : "更早消息读取失败");
      }
    } finally {
      if (projectIdRef.current === targetProjectId) setLoadingOlder(false);
    }
  }, [
    activeConversationBelongsToProject,
    activeConversationId,
    loadingOlder,
    messageCursor,
    projectId,
  ]);

  const renameConversation = async (): Promise<void> => {
    const title = titleDraft.trim();
    if (
      !activeConversationBelongsToProject ||
      !activeConversationId ||
      conversationMutating
    )
      return;
    const targetConversationId = activeConversationId;
    const targetProjectId = projectId;
    if (!title) {
      setError("会话标题不能为空");
      return;
    }
    setConversationMutating(true);
    setError(null);
    try {
      const updated = await updateAgentConversation(targetConversationId, {
        title,
      });
      if (projectIdRef.current !== targetProjectId) return;
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
      setEditingTitle(false);
      setConversationActionsOpen(false);
      setConfirmingArchive(false);
    } catch (cause) {
      if (projectIdRef.current === targetProjectId) {
        setError(cause instanceof Error ? cause.message : "会话重命名失败");
      }
    } finally {
      if (projectIdRef.current === targetProjectId) {
        setConversationMutating(false);
      }
    }
  };

  const archiveConversation = async (): Promise<void> => {
    if (
      !activeConversationBelongsToProject ||
      !activeConversationId ||
      conversationMutating
    )
      return;
    const targetConversationId = activeConversationId;
    const targetProjectId = projectId;
    setConversationMutating(true);
    setError(null);
    try {
      await updateAgentConversation(targetConversationId, { archived: true });
      if (projectIdRef.current !== targetProjectId) return;
      const remaining = conversations.filter(
        (conversation) => conversation.id !== targetConversationId,
      );
      const next =
        remaining[0] ?? (await createAgentConversation(targetProjectId));
      if (
        projectIdRef.current !== targetProjectId ||
        next.projectId !== targetProjectId
      )
        return;
      setConversations(remaining.length > 0 ? remaining : [next]);
      setMessages([]);
      setMessageCursor(null);
      setLoading(true);
      setActiveConversationId(next.id);
      setConversationActionsOpen(false);
      setEditingTitle(false);
      setConfirmingArchive(false);
    } catch (cause) {
      if (projectIdRef.current === targetProjectId) {
        setError(cause instanceof Error ? cause.message : "会话归档失败");
      }
    } finally {
      if (projectIdRef.current === targetProjectId) {
        setConversationMutating(false);
      }
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
      if (!activeConversationBelongsToProject || !activeConversation || sending)
        return;
      const validationError = validateAgentMessage(content, shapeIds.length);
      if (validationError) {
        setError(validationError);
        return;
      }
      const targetConversationId = activeConversation.id;
      const targetProjectId = projectId;
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
      }
      setSending(true);
      setError(null);
      try {
        const result = await sendAgentMessage(targetConversationId, {
          clientRequestId,
          content: normalized,
          fileAssetIds: [],
          shapeIds,
        });
        if (
          projectIdRef.current === targetProjectId &&
          activeConversationIdRef.current === targetConversationId
        ) {
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
        }
        if (result.taskId && projectIdRef.current === targetProjectId) {
          void generation.track(result.taskId).catch(() => {
            setError("生成任务已创建，状态同步稍有延迟");
          });
        }
        if (!retry && projectIdRef.current === targetProjectId) {
          setPrompt("");
          setDraftShapeIds([]);
          if (composerInputRef.current) {
            composerInputRef.current.style.height = "44px";
          }
        }
        if (projectIdRef.current !== targetProjectId) return;
        void refreshConversations()
          .then((refreshed) => {
            if (
              projectIdRef.current === targetProjectId &&
              refreshed.length > 0 &&
              !refreshed.some((item) => item.id === targetConversationId)
            ) {
              setActiveConversationId(refreshed[0]?.id ?? "");
            }
          })
          .catch(() => undefined);
      } catch (cause) {
        if (
          projectIdRef.current !== targetProjectId ||
          activeConversationIdRef.current !== targetConversationId
        ) {
          return;
        }
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
        }
        setError(cause instanceof Error ? cause.message : "消息发送失败");
      } finally {
        if (projectIdRef.current === targetProjectId) setSending(false);
      }
    },
    [
      activeConversation,
      activeConversationBelongsToProject,
      boardStatus,
      generation,
      projectId,
      refreshConversations,
      sending,
    ],
  );

  const newConversation = async (): Promise<void> => {
    if (sending || conversationMutating) return;
    const targetProjectId = projectId;
    setConversationMutating(true);
    setError(null);
    try {
      const created = await createAgentConversation(targetProjectId);
      if (
        projectIdRef.current !== targetProjectId ||
        created.projectId !== targetProjectId
      )
        return;
      setConversations((current) => [created, ...current]);
      setLoading(true);
      setActiveConversationId(created.id);
      setMessages([]);
      setMessageCursor(null);
      setConversationActionsOpen(false);
      setEditingTitle(false);
      setConfirmingArchive(false);
    } catch (cause) {
      if (projectIdRef.current === targetProjectId) {
        setError(cause instanceof Error ? cause.message : "新会话创建失败");
      }
    } finally {
      if (projectIdRef.current === targetProjectId) {
        setConversationMutating(false);
      }
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
              aria-expanded={historyOpen}
              aria-label="打开历史"
              onClick={() => {
                setConversationActionsOpen(false);
                void generation.refresh().catch(() => {
                  setError("生成历史暂时无法刷新");
                });
                setHistoryOpen(true);
              }}
              title="历史"
              type="button"
            >
              <HistoryIcon />
            </button>
            <button
              aria-label="新建会话"
              disabled={sending || conversationMutating}
              onClick={() => void newConversation()}
              title="新建会话"
              type="button"
            >
              <PlusIcon />
            </button>
            <button
              aria-expanded={conversationActionsOpen}
              aria-label="管理当前会话"
              disabled={sending || conversationMutating}
              onClick={() => {
                setConversationActionsOpen((current) => !current);
                setEditingTitle(false);
                setConfirmingArchive(false);
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
                  disabled={sending || conversationMutating}
                  onClick={() => {
                    if (!confirmingArchive) {
                      setConfirmingArchive(true);
                      return;
                    }
                    void archiveConversation();
                  }}
                  type="button"
                >
                  {conversationMutating
                    ? "归档中…"
                    : confirmingArchive
                      ? "再次点击确认归档"
                      : "归档会话"}
                </button>
              </>
            )}
          </section>
        ) : null}

        {historyOpen ? (
          <section className={styles.historyPanel} aria-label="历史记录">
            <header className={styles.historyHeader}>
              <button
                aria-label="返回对话"
                onClick={() => setHistoryOpen(false)}
                type="button"
              >
                <BackIcon />
              </button>
              <strong>历史</strong>
            </header>
            <div
              className={styles.historyTabs}
              role="tablist"
              aria-label="历史类型"
            >
              <button
                aria-selected={historyTab === "conversations"}
                onClick={() => setHistoryTab("conversations")}
                role="tab"
                type="button"
              >
                对话
              </button>
              <button
                aria-selected={historyTab === "generations"}
                onClick={() => setHistoryTab("generations")}
                role="tab"
                type="button"
              >
                生成
              </button>
            </div>
            {historyTab === "conversations" ? (
              <div className={styles.conversationHistory} role="tabpanel">
                {conversations.map((conversation) => (
                  <button
                    aria-current={
                      conversation.id === activeConversationId
                        ? "page"
                        : undefined
                    }
                    disabled={sending}
                    key={conversation.id}
                    onClick={() => {
                      if (conversation.id !== activeConversationId) {
                        setLoading(true);
                        setMessages([]);
                        setMessageCursor(null);
                        setLoadError(null);
                        setActiveConversationId(conversation.id);
                      }
                      setHistoryOpen(false);
                    }}
                    type="button"
                  >
                    <span>{conversation.title}</span>
                    <time dateTime={conversation.updatedAt}>
                      {formatDate(conversation.updatedAt)}
                    </time>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.generationHistory} role="tabpanel">
                {generation.tasks.length === 0 ? (
                  <p>暂无生成记录</p>
                ) : (
                  generation.tasks.map((task) => (
                    <article key={task.id}>
                      <div>
                        <span>{STATUS_LABELS[task.status] ?? task.status}</span>
                        <time dateTime={task.createdAt}>
                          {formatDate(task.createdAt)}
                        </time>
                      </div>
                      <p>{task.prompt}</p>
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        ) : (
          <>
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
              ) : loadError && messages.length === 0 ? (
                <section className={styles.loadError} role="alert">
                  <strong>项目会话暂时无法恢复</strong>
                  <p>{loadError}</p>
                  <button
                    onClick={() => {
                      if (activeConversationId) {
                        setLoading(true);
                        setLoadError(null);
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
                    <div className={styles.messageContent}>
                      {message.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
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
                      <div className={styles.taskResult}>
                        {task.status !== "succeeded" ? (
                          <div
                            className={styles.taskCard}
                            data-status={task.status}
                          >
                            <div>
                              <span>
                                {task.error ??
                                  STATUS_LABELS[task.status] ??
                                  task.status}
                              </span>
                              {task.connection === "polling" &&
                              !TERMINAL_TASKS.has(task.status) ? (
                                <small>连接中断，正在同步状态</small>
                              ) : null}
                            </div>
                            {!TERMINAL_TASKS.has(task.status) ? (
                              <button
                                onClick={() => void generation.cancel(task.id)}
                                type="button"
                              >
                                停止
                              </button>
                            ) : (
                              <button
                                onClick={() => void generation.retry(task.id)}
                                type="button"
                              >
                                重试
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className={styles.taskCanvasReceipt}>
                            <span>成图已放到画布</span>
                            <small>选中画布图片，可继续让设计助手修改</small>
                          </div>
                        )}
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
              <div ref={endRef} />
            </div>

            <div className={styles.composerDock}>
              <div className={styles.composerSurface}>
                {contextItems.length > 0 ? (
                  <SelectedElementBar
                    items={contextItems}
                    onRemove={(id) =>
                      setDraftShapeIds((current) =>
                        current.filter((shapeId) => shapeId !== id),
                      )
                    }
                  />
                ) : null}
                <label className={styles.composer}>
                  <span className={styles.srOnly}>编辑描述</span>
                  <textarea
                    ref={composerInputRef}
                    aria-label="编辑描述"
                    disabled={sending || !activeConversationId}
                    maxLength={MAX_AGENT_MESSAGE_LENGTH}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      event.target.style.height = "44px";
                      event.target.style.height = `${Math.min(
                        132,
                        Math.max(44, event.target.scrollHeight),
                      )}px`;
                      if (error) setError(null);
                    }}
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
                    placeholder="描述你想如何调整这张图…"
                    rows={1}
                    value={prompt}
                  />
                </label>
                <button
                  aria-label={sending ? "正在处理" : "发送"}
                  className={styles.sendButton}
                  disabled={sendUnavailableReason !== null}
                  onClick={() =>
                    void submit(
                      prompt,
                      contextItems.map((item) => item.id),
                    )
                  }
                  title={sendUnavailableReason ?? "发送"}
                  type="button"
                >
                  {sending ? <i aria-hidden="true" /> : <SendIcon />}
                </button>
              </div>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        )}
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

interface DraftAttachment {
  readonly colors: readonly string[];
  readonly dimensions: string | null;
  readonly id: TLShapeId;
  readonly kind: string;
  readonly label: string;
  readonly previewUrl: string | null;
  readonly role: string;
  readonly sourceName: string | null;
  readonly summary: string | null;
}

const ROLE_ASSIGNABLE_ATTACHMENT_TYPES = new Set([
  "fashion-fabric",
  "fashion-image",
  "fashion-note",
  "fashion-swatch",
]);

function attachmentFromShape(shape: TLShape): DraftAttachment {
  const props = shape.props as Record<string, unknown>;
  const colors = attachmentPaletteColors(props);
  const previewUrl = [props.thumbnailUrl, props.url].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const kindLabels: Readonly<Record<string, string>> = {
    "fashion-fabric": "面料",
    "fashion-frame": "框",
    "fashion-note": "便签",
    "fashion-swatch": "色卡",
    arrow: "连接",
    draw: "线稿",
    frame: "框",
    geo: "图形",
    note: "便签",
    text: "文字",
  };
  const width = typeof props.w === "number" ? Math.round(props.w) : null;
  const height = typeof props.h === "number" ? Math.round(props.h) : null;
  const label = boardElementLabel(shape, props);
  const sourceName = shapeSourceName(props);
  return {
    colors,
    dimensions: width && height ? `${width} × ${height}` : null,
    id: shape.id,
    kind: isImageShape(shape) ? "图片" : (kindLabels[shape.type] ?? "参考"),
    label,
    previewUrl: previewUrl ?? null,
    role: attachmentRoleLabel(shape.type, props),
    sourceName: sourceName && sourceName !== label ? sourceName : null,
    summary:
      colors.length > 1
        ? `${colors.length} 色 · ${colors.map((color) => color.toUpperCase()).join(" · ")}`
        : attachmentSummary(props),
  };
}

function SelectedElementBar({
  items,
  onRemove,
}: {
  readonly items: readonly DraftAttachment[];
  readonly onRemove: (id: TLShapeId) => void;
}) {
  const [activeId, setActiveId] = useState<TLShapeId | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const [pinnedId, setPinnedId] = useState<TLShapeId | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef(new Map<TLShapeId, HTMLButtonElement>());
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousIdsRef = useRef<readonly TLShapeId[]>([]);
  const activeItem = items.find((item) => item.id === activeId) ?? null;

  const clearTimers = useCallback((): void => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  const closePreview = useCallback((): void => {
    clearTimers();
    setActiveId(null);
    setActiveAnchor(null);
    setPinnedId(null);
  }, [clearTimers]);

  const openPreview = useCallback(
    (id: TLShapeId, delay = 140): void => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (activeId === id) return;
      openTimerRef.current = setTimeout(() => {
        setActiveAnchor(triggerRefs.current.get(id) ?? null);
        setActiveId(id);
        openTimerRef.current = null;
      }, delay);
    },
    [activeId],
  );

  const scheduleClose = useCallback((): void => {
    if (pinnedId) return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setActiveId(null);
      setActiveAnchor(null);
      closeTimerRef.current = null;
    }, 100);
  }, [pinnedId]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!activeId) return;
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (activeAnchor?.contains(target)) return;
      if (document.getElementById("selected-element-preview")?.contains(target))
        return;
      closePreview();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePreview();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeAnchor, activeId, closePreview]);

  useLayoutEffect(() => {
    const nextIds = items.map((item) => item.id);
    const previousIds = previousIdsRef.current;
    const added = nextIds.some((id) => !previousIds.includes(id));
    previousIdsRef.current = nextIds;
    if (!added || !rowRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const row = rowRef.current;
      if (!row) return;
      row.scrollTo({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        top: row.scrollHeight,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items]);

  return (
    <>
      <div
        aria-label="已附加内容"
        className={styles.attachmentRow}
        ref={rowRef}
        role="list"
      >
        {items.map((item) => {
          const isActive = activeId === item.id;
          const isPinned = pinnedId === item.id;
          return (
            <div
              className={styles.attachment}
              data-kind={item.kind}
              key={item.id}
              onPointerEnter={() => openPreview(item.id)}
              onPointerLeave={scheduleClose}
              role="listitem"
            >
              <span aria-hidden="true" className={styles.attachmentMarker} />
              <button
                aria-describedby={
                  isActive ? "selected-element-preview" : undefined
                }
                aria-label={`${item.label}，${item.role}`}
                aria-pressed={isPinned}
                className={styles.attachmentTrigger}
                onBlur={scheduleClose}
                onClick={() => {
                  clearTimers();
                  if (isPinned) {
                    closePreview();
                    return;
                  }
                  setActiveAnchor(triggerRefs.current.get(item.id) ?? null);
                  setActiveId(item.id);
                  setPinnedId(item.id);
                }}
                onFocus={() => openPreview(item.id, 0)}
                ref={(node) => {
                  if (node) triggerRefs.current.set(item.id, node);
                  else triggerRefs.current.delete(item.id);
                }}
                title={item.label}
                type="button"
              >
                <span>{item.label}</span>
              </button>
              <button
                aria-label={`移除 ${item.label}（素材）`}
                className={styles.attachmentRemove}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isActive) closePreview();
                  onRemove(item.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={`移除 ${item.label}`}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>
      {activeItem && activeAnchor ? (
        <ElementPreviewPopover
          anchor={activeAnchor}
          item={activeItem}
          key={`${activeItem.id}:${activeItem.previewUrl ?? "fallback"}`}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
        />
      ) : null}
    </>
  );
}

function ElementPreviewPopover({
  anchor,
  item,
  onPointerEnter,
  onPointerLeave,
}: {
  readonly anchor: HTMLElement;
  readonly item: DraftAttachment;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
}) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const [imageState, setImageState] = useState<"error" | "loaded" | "loading">(
    "loading",
  );
  const [position, setPosition] = useState({ left: 8, top: 8, visible: false });

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const popover = popoverRef.current;
      if (!popover || !anchor.isConnected) return;
      const margin = 8;
      const gap = 8;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - popoverRect.width - margin,
        Math.max(
          margin,
          anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2,
        ),
      );
      const fitsAbove = anchorRect.top - popoverRect.height - gap >= margin;
      const preferredTop = fitsAbove
        ? anchorRect.top - popoverRect.height - gap
        : anchorRect.bottom + gap;
      const top = Math.min(
        window.innerHeight - popoverRect.height - margin,
        Math.max(margin, preferredTop),
      );
      setPosition({ left, top, visible: true });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, item.id]);

  return createPortal(
    <aside
      className={styles.attachmentPreview}
      id="selected-element-preview"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      ref={popoverRef}
      role="tooltip"
      style={{
        left: position.left,
        opacity: position.visible ? 1 : 0,
        top: position.top,
      }}
    >
      <div className={styles.previewVisual} data-state={imageState}>
        {item.previewUrl ? (
          <>
            <div aria-hidden="true" className={styles.previewPlaceholder}>
              <span>
                {imageState === "error" ? "预览不可用" : "正在加载预览"}
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={item.label}
              onError={() => setImageState("error")}
              onLoad={() => setImageState("loaded")}
              src={item.previewUrl}
            />
          </>
        ) : (
          <div className={styles.previewFallback}>
            {item.colors.length > 0 ? (
              <div
                aria-label={`色板，${item.colors.length} 种颜色`}
                className={styles.previewPalette}
              >
                {item.colors.map((color) => (
                  <i
                    aria-hidden="true"
                    key={color}
                    style={{ backgroundColor: color }}
                    title={color.toUpperCase()}
                  />
                ))}
              </div>
            ) : (
              <strong aria-hidden="true">{item.kind.slice(0, 1)}</strong>
            )}
            {item.summary ? <span>{item.summary}</span> : null}
          </div>
        )}
      </div>
      <div className={styles.previewMeta}>
        <strong>{item.label}</strong>
        <span>
          {item.role}
          {item.dimensions ? ` · ${item.dimensions}` : ""}
        </span>
        {item.sourceName ? <small>源文件 · {item.sourceName}</small> : null}
      </div>
    </aside>,
    document.body,
  );
}

function boardElementLabel(
  shape: TLShape,
  props: Readonly<Record<string, unknown>>,
): string {
  const storedRole = typeof props.role === "string" ? props.role : "";
  const role =
    storedRole === "garment_ref" &&
    typeof props.fileId === "string" &&
    props.fileId.length > 0
      ? "reference_garment"
      : storedRole;
  if (ROLE_ASSIGNABLE_ATTACHMENT_TYPES.has(shape.type) && role) {
    const customLabel =
      shape.type === "fashion-image" && role === "note"
        ? stringProp(props.roleLabel)
        : undefined;
    return resolveRoleBadgeLabel(role, customLabel);
  }
  if (isImageShape(shape)) return "图片";
  return shapeLabel(shape.type, shape.props);
}

function shapeSourceName(
  props: Readonly<Record<string, unknown>>,
): string | null {
  return stringProp(props.title) ?? fabricTagSummary(props.fabricTags);
}

function stringProp(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fabricTagSummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const tags = value.flatMap((tag) => {
    const normalized = stringProp(tag);
    return normalized ? [normalized] : [];
  });
  return tags.length > 0 ? tags.join("、").slice(0, 120) : null;
}

function attachmentPaletteColors(
  props: Readonly<Record<string, unknown>>,
): readonly string[] {
  const stored = Array.isArray(props.colors) ? props.colors : [];
  const colors = stored.flatMap((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") return [];
    const color = (entry as Record<string, unknown>).color;
    return typeof color === "string" && /^#[\da-f]{6}$/iu.test(color)
      ? [color.toLowerCase()]
      : [];
  });

  if (colors.length > 0) return [...new Set(colors)];
  return typeof props.color === "string" && /^#[\da-f]{6}$/iu.test(props.color)
    ? [props.color.toLowerCase()]
    : [];
}

function attachmentRoleLabel(
  type: string,
  props: Readonly<Record<string, unknown>>,
): string {
  const roleLabels: Readonly<Record<string, string>> = {
    avoid: "避用参考",
    detail_ref: "服装细节",
    fabric_ref: "面料",
    garment_ref: "成衣",
    note: "设计备注",
    palette: "色彩",
    reference_garment: "参考衣",
    silhouette_ref: "服装廓形",
    style_ref: "参考图",
  };
  const role = typeof props.role === "string" ? props.role : "";
  if (roleLabels[role]) return roleLabels[role];
  const typeLabels: Readonly<Record<string, string>> = {
    "fashion-fabric": "面料",
    "fashion-note": "白板便签",
    "fashion-swatch": "色彩",
    draw: "白板线稿",
    geo: "白板图形",
    image: "参考图",
    text: "白板文字",
  };
  return typeLabels[type] ?? "白板元素";
}

function attachmentSummary(
  props: Readonly<Record<string, unknown>>,
): string | null {
  const summary = [props.text, props.label].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  return summary?.trim().slice(0, 120) ?? fabricTagSummary(props.fabricTags);
}

function isImageShape(shape: TLShape): boolean {
  return shape.type === "fashion-image" || shape.type === "image";
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
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

function HistoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4.5 6.5V3.8m0 0h2.7m-2.7 0A7 7 0 1 1 3 12" />
      <path d="M10 6v4.4l2.8 1.6" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m6 6 8 8M14 6l-8 8" />
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
