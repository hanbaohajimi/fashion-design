"use client";
import { Button, Menu, Notice, Skeleton } from "../../../components/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import prose from "../../../components/reading.module.css";
import { STUDIO_LAYOUT } from "../../../components/ui-config";
import { userFacingError } from "../../../components/user-facing-error";
import { useSerialPolling } from "../../use-serial-polling";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AssistantReferencePicker,
  MAX_ASSISTANT_REFERENCES,
} from "./AssistantReferencePicker";
import { DesignRequirementsDrawer } from "./DesignRequirementsDrawer";
import { MessageReferenceRecord } from "./MessageReferenceRecord";
import {
  resolveDraftReferences,
  removeReferenceMentions,
} from "./discussion-references";
import ui from "./assistant-context.module.css";
import { ProposalReview } from "./ProposalReview";
import { acceptAndExecuteProposal } from "./proposal-execution";
import {
  createAgentConversation,
  fetchWorkflowConversationContext,
  listAgentConversations,
  listWorkflowMessages,
  sendWorkflowMessage,
  updateWorkflowConversationContext,
  MAX_AGENT_MESSAGE_LENGTH,
  type WorkflowConversationContext,
  type WorkflowConversationSummary,
  type WorkflowMessageView,
  type WorkflowContextCorrection,
} from "../agent/agent-api";
import {
  decideWorkflowProposal,
  fetchWorkflowToolCatalog,
  updateWorkflowAgentSettings,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowProposal,
} from "./workflow-api";
import { displayNodeTitle } from "./workflow-graph";
import styles from "./workflow-canvas.module.css";

interface Props {
  readonly graph: WorkflowGraph;
  readonly projectId: string;
  readonly selected: WorkflowNode | null;
  readonly onGraphChange: (graph: WorkflowGraph) => void;
  readonly onProposal: (proposal: WorkflowProposal | null) => void;
  readonly onNotice: (message: string | null) => void;
  readonly onError: (message: string | null) => void;
  readonly onLocate: (nodeId: string) => void;
  readonly onOpenResult: (nodeId: string) => void;
  readonly onAddMaterial: () => void;
  readonly focusRequest?: number;
  readonly referenceRequest?: {
    readonly nodeId: string;
    readonly nonce: number;
  } | null;
  readonly renderLegacyRuns: (conversationId: string) => ReactNode;
  readonly onConversationChange?: (conversationId: string | null) => void;
}

function mergeMessages(
  current: readonly WorkflowMessageView[],
  incoming: readonly WorkflowMessageView[],
) {
  const updates = new Map(incoming.map((message) => [message.id, message]));
  const merged = current.map((message) => {
    const update = updates.get(message.id);
    if (!update) return message;
    // An in-flight poll must not revive a confirmation already handled here.
    if (
      update.proposal?.status === "pending" &&
      message.proposal &&
      message.proposal.status !== "pending"
    ) {
      return { ...update, proposal: message.proposal };
    }
    return update;
  });
  const seen = new Set(current.map((message) => message.id));
  return [...merged, ...incoming.filter((message) => !seen.has(message.id))];
}

type ConversationDraft = {
  prompt: string;
  referencedIds: readonly string[];
  adjustment: WorkflowProposal | null;
};
type LocalSubmission = { conversationId: string; clientRequestId: string; content: string; phase: "sending" | "uncertain" };
const messageDisplayKey = (conversationId: string, message: Pick<WorkflowMessageView, "role" | "clientRequestId" | "id">) =>
  message.role === "user" && message.clientRequestId ? `request:${conversationId}:${message.clientRequestId}` : message.id;

export function WorkflowAssistantPanel({
  graph,
  projectId,
  selected,
  onGraphChange,
  onProposal,
  onNotice,
  onError,
  onLocate,
  renderLegacyRuns,
  onConversationChange,
  onOpenResult,
  onAddMaterial,
  focusRequest = 0,
  referenceRequest,
}: Props) {
  const inputId = useId();
  const draftStore = useRef(new Map<string, ConversationDraft>());
  const [conversations, setConversations] = useState<
    readonly WorkflowConversationSummary[]
  >([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<readonly WorkflowMessageView[]>([]);
  const [localSubmission, setLocalSubmission] = useState<LocalSubmission | null>(null);
  const acknowledgedRequests = useRef(new Set<string>());
  const freshMessages = useRef(new Set<string>());
  const scrollFrame = useRef(0);
  const expectedScroll = useRef(0);
  const followedConversation = useRef("");
  const stopScroll = useCallback(() => { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = 0; }, []);
  const scrollToLatest = useCallback((view: HTMLElement) => {
    stopScroll();
    const target = Math.max(0, view.scrollHeight - view.clientHeight);
    const start = view.scrollTop;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(target - start) < 1) { view.scrollTop = target; return; }
    const at = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - at) / 180);
      expectedScroll.current = start + (target - start) * (1 - (1 - progress) ** 3);
      view.scrollTop = expectedScroll.current;
      scrollFrame.current = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    scrollFrame.current = requestAnimationFrame(step);
  }, [stopScroll]);
  useEffect(() => stopScroll, [stopScroll]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [context, setContext] = useState<WorkflowConversationContext | null>(
    null,
  );
  const [adjustment, setAdjustment] = useState<WorkflowProposal | null>(null);
  const [executionErrors, setExecutionErrors] = useState<
    Record<string, string>
  >({});
  const [submittingProposal, setSubmittingProposal] = useState<string | null>(
    null,
  );
  const executionFlight = useRef(false);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusRequest) composerInput.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const [agentVersion, setAgentVersion] = useState<1 | 2>(2);
  const [contextError, setContextError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [referencedIds, setReferencedIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [conversationReload, setConversationReload] = useState(0);
  const [legacyMessageError, setLegacyMessageError] = useState<string | null>(
    null,
  );
  const [legacyReload, setLegacyReload] = useState(0);
  const [legacyRunsOpen, setLegacyRunsOpen] = useState(false);
  const activeId = useRef(conversationId);
  const initializedMessages = useRef("");
  const contextEpoch = useRef(0);
  const requestIds = useRef(new Map<string, string>());
  const conversationView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = conversationView.current;
    if (!view) return;
    let visible = true;
    const update = () => view.style.setProperty("--assistant-play-state", visible && !document.hidden ? "running" : "paused");
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); update(); });
    observer?.observe(view);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const composerSurface = useRef<HTMLDivElement>(null);
  const conversationSize = useRef({ width: 0, height: 0 });
  const readingAnchor = useRef<{ id: string; offset: number } | null>(null);
  const followMessages = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const active = conversations.find((item) => item.id === conversationId);
  const legacy = Boolean(active && active.mode !== "workflow");
  const pendingReply = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "pending" &&
      message.origin !== "background_analysis" &&
      message.origin !== "execution_result",
  );
  const collaborationReadOnly = legacy || agentVersion === 1;
  useEffect(() => {
    draftStore.current.set(`${projectId}:${conversationId}`, {
      prompt,
      referencedIds,
      adjustment,
    });
  }, [projectId, conversationId, prompt, referencedIds, adjustment]);
  const addReference = useCallback(
    (id: string) => {
      if (collaborationReadOnly) {
        onError("请先打开可编辑的设计对话再引用素材。");
        return false;
      }
      const ids = resolveDraftReferences(
        graph.nodes,
        prompt,
        referencedIds,
      ).ids;
      if (!ids.includes(id) && ids.length >= MAX_ASSISTANT_REFERENCES) {
        onError("每次最多引用 16 项，请先移除一项再添加。");
        return false;
      }
      setReferencedIds((current) => [...new Set([...current, id])]);
      composerInput.current?.focus({ preventScroll: true });
      return true;
    },
    [collaborationReadOnly, graph.nodes, onError, prompt, referencedIds],
  );
  const consumedReference = useRef<unknown>(null);
  useEffect(() => {
    if (
      !referenceRequest ||
      loading ||
      consumedReference.current === referenceRequest
    )
      return;
    consumedReference.current = referenceRequest;
    if (!graph.nodes.some((node) => node.id === referenceRequest.nodeId))
      return;
    addReference(referenceRequest.nodeId);
  }, [addReference, graph.nodes, loading, referenceRequest]);
  const mentionMatch = prompt.match(/(?:^|\s)@([^@\s]*)$/u);
  const mentionChoices = mentionMatch
    ? graph.nodes
        .filter(
          (node) =>
            node.title.includes(mentionMatch[1] ?? "") &&
            !referencedIds.includes(node.id),
        )
        .slice(0, 6)
    : [];

  useEffect(() => {
    activeId.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    onConversationChange?.(legacy || !conversationId ? null : conversationId);
  }, [conversationId, legacy, onConversationChange]);
  useEffect(() => {
    let active = true;
    void fetchWorkflowToolCatalog(projectId)
      .then((catalog) => {
        if (active) setAgentVersion(catalog.agentVersion);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId]);

  const activateConversation = useCallback(
    (id: string) => {
      const draft = draftStore.current.get(`${projectId}:${id}`);
      followMessages.current = true;
      readingAnchor.current = null;
      setNewMessages(false);
      initializedMessages.current = "";
      contextEpoch.current += 1;
      activeId.current = id;
      freshMessages.current.clear();
      setConversationId(id);
      setMessages([]);
      setCursor(null);
      setContext(null);
      setAdjustment(draft?.adjustment ?? null);
      setContextError(null);
      setReferencedIds(draft?.referencedIds ?? []);
      setPrompt(draft?.prompt ?? "");
      setDraftNotice(
        draft &&
          (draft.prompt || draft.referencedIds.length || draft.adjustment)
          ? "已恢复此对话的未发送草稿，请核对后发送。草稿仅保留在当前页面。"
          : null,
      );
      setPickerOpen(false);
      setLegacyMessageError(null);
      setRequirementsOpen(false);
      setCorrectionError(null);
      setLoading(Boolean(id));
      onProposal(null);
    },
    [onProposal, projectId],
  );

  useEffect(() => {
    const activate = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      activateConversation(id);
      void listAgentConversations(projectId)
        .then((page) => setConversations(page.items))
        .catch(() => undefined);
    };
    window.addEventListener("fashion-workflow:conversation", activate);
    return () =>
      window.removeEventListener("fashion-workflow:conversation", activate);
  }, [activateConversation, projectId]);

  useEffect(() => {
    let disposed = false;
    setConversationError(null);
    setLoading(true);
    void listAgentConversations(projectId)
      .then((page) => {
        if (disposed) return;
        setConversations(page.items);
        activateConversation(
          page.items.find((item) => item.mode === "workflow")?.id ?? "",
        );
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setConversationError(
            userFacingError(error, "历史对话读取失败，请重试。"),
          );
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [activateConversation, projectId, conversationReload]);

  useEffect(() => {
    let disposed = false;
    if (!conversationId || !legacy) return;
    setLoading(true);
    setLegacyMessageError(null);
    void listWorkflowMessages(conversationId)
      .then((page) => {
        if (!disposed) {
          setMessages((current) => mergeMessages(page.items, current));
          setCursor(page.nextCursor);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLegacyMessageError(
            userFacingError(error, "历史消息读取失败，请重试。"),
          );
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [conversationId, legacy, legacyReload]);

  const refreshContext = useCallback(async () => {
    if (!conversationId || legacy) return;
    const epoch = contextEpoch.current;
    const result = await fetchWorkflowConversationContext(conversationId);
    if (activeId.current === conversationId && contextEpoch.current === epoch) {
      setContext(result);
      setContextError(null);
    }
  }, [conversationId, legacy]);

  useEffect(() => {
    let disposed = false;
    if (!conversationId || legacy) return;
    const epoch = ++contextEpoch.current;
    void fetchWorkflowConversationContext(conversationId)
      .then((result) => {
        if (!disposed && contextEpoch.current === epoch) {
          setContext(result);
          setContextError(null);
        }
      })
      .catch((error: unknown) => {
        if (!disposed && contextEpoch.current === epoch)
          setContextError(
            error instanceof Error ? error.message : "上下文读取失败",
          );
      });
    return () => {
      disposed = true;
    };
  }, [conversationId, graph.revision, legacy]);

  useEffect(() => {
    if (!context?.visualCoverage?.pending || legacy || contextSaving) return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void refreshContext()
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [context?.visualCoverage?.pending, contextSaving, legacy, refreshContext]);

  const messageSync = useSerialPolling(
    conversationId ?? "",
    Boolean(conversationId && !legacy),
    2500,
    async (signal) => {
      if (!conversationId) return;
      try {
        const page = await listWorkflowMessages(
          conversationId,
          undefined,
          signal,
        );
        signal.throwIfAborted();
        for (const message of page.items) if (message.role === "user" && message.clientRequestId) acknowledgedRequests.current.add(message.clientRequestId);
        const initialized = initializedMessages.current === conversationId;
        setMessages((current) => {
          if (initialized) {
            const known = new Set(current.map((message) => message.id));
            for (const message of page.items) if (!known.has(message.id)) freshMessages.current.add(message.id);
          }
          return mergeMessages(current, page.items);
        });
        if (initializedMessages.current !== conversationId) {
          initializedMessages.current = conversationId;
          setCursor(page.nextCursor);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
  );

  useEffect(() => {
    const pending =
      [...messages]
        .reverse()
        .find((message) => message.proposal?.status === "pending")?.proposal ??
      null;
    onProposal(pending);
    const latestContext = [...messages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.context,
      )?.context;
    if (latestContext && !pendingReply)
      void refreshContext().catch(() => undefined);
  }, [messages, onProposal, pendingReply, refreshContext]);

  const latestMessage = messages.at(-1);
  const latestMessageKey = latestMessage
    ? `${latestMessage.id}:${latestMessage.status}:${latestMessage.content.length}`
    : "";
  const proposalResultKey = messages
    .filter((message) => message.proposal)
    .map(({ proposal }) => {
      const tool = graph.nodes.find((node) => node.id === proposal?.toolNodeId);
      const outputs = graph.edges
        .filter((edge) => edge.sourceNodeId === tool?.id)
        .map((edge) => edge.targetNodeId);
      return `${proposal?.id}:${proposal?.status}:${tool?.status}:${outputs.join(",")}`;
    })
    .join("|");
  useEffect(() => {
    if (followMessages.current && conversationView.current) {
      if (followedConversation.current !== conversationId) {
        stopScroll();
        conversationView.current.scrollTop = conversationView.current.scrollHeight;
        if (messages.length) followedConversation.current = conversationId;
      } else scrollToLatest(conversationView.current);
    }
    else setNewMessages(true);
  }, [latestMessageKey, messages.length, pendingReply, proposalResultKey, localSubmission, scrollToLatest, conversationId, stopScroll]);

  // §2.1/§3.6: resizing the composer must not hide the current confirmation or
  // pull a reader away from history. Scroll events caused by reflow keep intent.
  useEffect(() => {
    const view = conversationView.current;
    const composer = composerSurface.current;
    if (!view || !composer || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        conversationSize.current = {
          width: view.clientWidth,
          height: view.clientHeight,
        };
        if (followMessages.current)
          view.scrollTop = view.querySelector("[data-message-id]")
            ? view.scrollHeight
            : 0;
        else if (readingAnchor.current) {
          const anchor = Array.from(
            view.querySelectorAll<HTMLElement>("[data-message-id]"),
          ).find(
            (item) => item.dataset.messageId === readingAnchor.current?.id,
          );
          if (anchor)
            view.scrollTop +=
              anchor.getBoundingClientRect().top -
              view.getBoundingClientRect().top -
              readingAnchor.current.offset;
        }
      });
    });
    observer.observe(view);
    observer.observe(composer);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [conversationId]);

  const createConversation = async (keepDraft = false) => {
    const created = await createAgentConversation(projectId, {
      mode: "workflow",
    });
    const workflow = { ...created, mode: "workflow" as const };
    setConversations((current) => [workflow, ...current]);
    activateConversation(created.id);
    if (keepDraft) {
      setPrompt(prompt);
      setReferencedIds(referencedIds);
      setAdjustment(adjustment);
      draftStore.current.delete(`${projectId}:`);
    }
    setLegacyRunsOpen(false);
    return created.id;
  };

  const reloadContextAfterTurn = (targetId: string) => {
    const epoch = ++contextEpoch.current;
    setContext(null);
    setContextError(null);
    void fetchWorkflowConversationContext(targetId)
      .then((value) => {
        if (activeId.current === targetId && contextEpoch.current === epoch) {
          setContext(value);
          setContextError(null);
        }
      })
      .catch((error: unknown) => {
        if (activeId.current === targetId && contextEpoch.current === epoch)
          setContextError(
            error instanceof Error
              ? error.message
              : "讨论对象读取失败，请重新读取",
          );
      });
  };

  const send = async () => {
    const content = prompt.trim();
    if (
      !content ||
      sending ||
      loading ||
      contextSaving ||
      collaborationReadOnly ||
      pendingReply ||
      conversationError ||
      missingReferenceIds.length ||
      staleAdjustment ||
      (conversationId && !context)
    )
      return;
    if (content.length > MAX_AGENT_MESSAGE_LENGTH) {
      onError(`设计需求最多 ${MAX_AGENT_MESSAGE_LENGTH} 个字符`);
      return;
    }
    const { ids: refs, error: referenceError } = resolveDraftReferences(
      graph.nodes,
      content,
      referencedIds,
    );
    if (referenceError) {
      onError(referenceError);
      return;
    }
    if (refs.length > MAX_ASSISTANT_REFERENCES) {
      onError("每次最多引用 16 项，请移除部分引用。");
      return;
    }
    followMessages.current = true;
    setNewMessages(false);
    setSending(true);
    const proposedRequestId = localSubmission?.conversationId === conversationId && localSubmission.content === content ? localSubmission.clientRequestId : crypto.randomUUID();
    let attemptedRequestId = proposedRequestId;
    setLocalSubmission({ conversationId, clientRequestId: proposedRequestId, content, phase: "sending" });
    onError(null);
    try {
      const targetId = conversationId || (await createConversation(true));
      const focus = refs.length ? refs : (context?.focusNodeIds ?? []);
      const key = JSON.stringify({
        targetId,
        content,
        refs,
        focus,
        proposalId: adjustment?.id,
      });
      const requestId = requestIds.current.get(key) ?? proposedRequestId;
      attemptedRequestId = requestId;
      requestIds.current.set(key, requestId);
      setLocalSubmission({ conversationId: targetId, clientRequestId: requestId, content, phase: "sending" });
      const turn = await sendWorkflowMessage(targetId, {
        clientRequestId: requestId,
        content,
        referencedNodeIds: refs,
        focusNodeIds: focus,
        ...(adjustment ? { respondingToProposalId: adjustment.id } : {}),
      });
      draftStore.current.delete(`${projectId}:${targetId}`);
      requestIds.current.delete(key);
      acknowledgedRequests.current.add(requestId);
      if (activeId.current !== targetId) return;
      freshMessages.current.add(turn.userMessage.id);
      freshMessages.current.add(turn.assistantMessage.id);
      setMessages((current) =>
        mergeMessages(
          current.map((message) =>
            adjustment && message.proposal?.id === adjustment.id
              ? {
                  ...message,
                  proposal: { ...message.proposal, status: "superseded" },
                }
              : message,
          ),
          [turn.userMessage, turn.assistantMessage],
        ),
      );
      if (turn.assistantMessage.proposal?.status === "pending")
        onProposal(turn.assistantMessage.proposal);
      setPrompt("");
      setAdjustment(null);
      setReferencedIds([]);
      setDraftNotice(null);
      reloadContextAfterTurn(targetId);
    } catch (error) {
      setLocalSubmission((current) => current ? { ...current, phase: "uncertain" } : current);
      if (!acknowledgedRequests.current.has(attemptedRequestId)) onError(error instanceof Error ? error.message : "发送结果尚未确认，请重试");
    } finally {
      setSending(false);
    }
  };

  const updateContext = async (change: WorkflowContextCorrection) => {
    if (!context || !conversationId || collaborationReadOnly || contextSaving)
      return false;
    const epoch = ++contextEpoch.current;
    setContextSaving(true);
    setCorrectionError(null);
    try {
      const result = await updateWorkflowConversationContext(conversationId, {
        baseRevision: context.revision,
        ...(context.summaryRevision !== undefined
          ? { summaryRevision: context.summaryRevision }
          : {}),
        mutationId: crypto.randomUUID(),
        ...change,
      });
      if (activeId.current !== conversationId || contextEpoch.current !== epoch)
        return false;
      setContext(result);
      setContextError(null);
      onNotice(change.focusNodeIds ? "讨论对象已更新" : "设计要求已更新");
      return true;
    } catch (error) {
      if (activeId.current === conversationId) {
        const message =
          error instanceof Error ? error.message : "修改未保存，请重试";
        setCorrectionError(message);
        onError(message);
        void refreshContext().catch(() => undefined);
      }
      return false;
    } finally {
      setContextSaving(false);
    }
  };

  const retryMessage = async (assistant: WorkflowMessageView) => {
    const user = messages.find(
      (message) =>
        message.id === assistant.replyToId && message.role === "user",
    );
    if (
      !user?.clientRequestId ||
      !conversationId ||
      sending ||
      contextSaving ||
      pendingReply ||
      legacy
    )
      return;
    setSending(true);
    onError(null);
    const targetId = conversationId;
    try {
      const turn = await sendWorkflowMessage(targetId, {
        clientRequestId: user.clientRequestId,
        content: user.content,
        referencedNodeIds: user.context?.referencedNodeIds ?? [],
        ...(Array.isArray(user.context?.focusNodeIds)
          ? { focusNodeIds: user.context.focusNodeIds }
          : {}),
        ...(user.context?.respondingToProposalId
          ? { respondingToProposalId: user.context.respondingToProposalId }
          : {}),
      });
      if (activeId.current === targetId) {
        setMessages((current) =>
          mergeMessages(current, [turn.userMessage, turn.assistantMessage]),
        );
        reloadContextAfterTurn(targetId);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "回复重试失败");
    } finally {
      setSending(false);
    }
  };

  const decide = async (
    proposal: WorkflowProposal,
    decision: "accept" | "reject",
  ) => {
    if (executionFlight.current || sending || collaborationReadOnly) return;
    executionFlight.current = true;
    setSending(true);
    setSubmittingProposal(proposal.id);
    const targetId = conversationId;
    setExecutionErrors((current) => ({ ...current, [proposal.id]: "" }));
    const markAccepted = (next: WorkflowGraph) => {
      onGraphChange(next);
      if (activeId.current === targetId) {
        setMessages((current) =>
          current.map((message) =>
            message.proposal?.id === proposal.id
              ? {
                  ...message,
                  proposal: { ...message.proposal, status: "accepted" },
                }
              : message,
          ),
        );
        onProposal(null);
        if (adjustment?.id === proposal.id) setAdjustment(null);
      }
    };
    try {
      if (decision === "reject") {
        onGraphChange(
          await decideWorkflowProposal(projectId, proposal, "reject"),
        );
        if (activeId.current === targetId) {
          setMessages((current) =>
            current.map((message) =>
              message.proposal?.id === proposal.id
                ? {
                    ...message,
                    proposal: { ...message.proposal, status: "rejected" },
                  }
                : message,
            ),
          );
          onProposal(null);
          if (adjustment?.id === proposal.id) setAdjustment(null);
        }
      } else {
        if (!targetId) throw new Error("请先打开这条方案所属的对话。");
        onGraphChange(
          await acceptAndExecuteProposal(
            projectId,
            proposal,
            targetId,
            markAccepted,
          ),
        );
        window.dispatchEvent(new Event("fashion-workflow:refresh"));
      }
    } catch (error) {
      setExecutionErrors((current) => ({
        ...current,
        [proposal.id]: userFacingError(
          error,
          "本次提交未完成，请重试；已保存的方案会保留。",
        ),
      }));
    } finally {
      executionFlight.current = false;
      setSending(false);
      setSubmittingProposal(null);
    }
  };

  const draftReferences = resolveDraftReferences(
    graph.nodes,
    prompt,
    referencedIds,
  );
  const missingReferenceIds = referencedIds.filter(
    (id) => !graph.nodes.some((node) => node.id === id),
  );
  const currentAdjustment = adjustment
    ? (messages.find((message) => message.proposal?.id === adjustment.id)
        ?.proposal ??
      graph.proposals?.find((proposal) => proposal.id === adjustment.id))
    : null;
  const staleAdjustment = Boolean(
    adjustment &&
    !loading &&
    (!currentAdjustment || currentAdjustment.status !== "pending"),
  );
  const discussionIds = draftReferences.ids.length
    ? draftReferences.ids
    : (context?.focusNodeIds ?? []);
  const clearDiscussion = async () => {
    const target = activeId.current;
    const ids = [
      ...new Set([...draftReferences.ids, ...(context?.focusNodeIds ?? [])]),
    ];
    if (
      conversationId &&
      (!context || !(await updateContext({ focusNodeIds: [] })))
    )
      return;
    if (activeId.current !== target) return;
    setReferencedIds([]);
    setPrompt((value) => removeReferenceMentions(value, graph.nodes, ids));
    composerInput.current?.focus({ preventScroll: true });
  };
  const retryContext = () => {
    void refreshContext().catch((error: unknown) =>
      setContextError(
        error instanceof Error ? error.message : "设计要求读取失败",
      ),
    );
  };
  const newConversation = () => {
    setSending(true);
    void createConversation()
      .catch((error: unknown) =>
        onError(userFacingError(error, "新建对话失败，请重试。")),
      )
      .finally(() => setSending(false));
  };
  const toggleAgent = () => {
    setSending(true);
    const version = agentVersion === 2 ? 1 : 2;
    void updateWorkflowAgentSettings(projectId, version)
      .then(() => {
        setAgentVersion(version);
        onNotice(
          version === 2
            ? "本项目设计助手已恢复"
            : "本项目设计助手已暂停，已有任务继续运行，历史消息仍可查看。",
        );
      })
      .catch((error: unknown) =>
        onError(userFacingError(error, "助手设置保存失败，请重试。")),
      )
      .finally(() => setSending(false));
  };

  return (
    <div className={styles.assistantBody}>
      <div className={ui.toolbar}>
        <strong className={ui.conversationTitle}>
          {active?.title || "新设计对话"}
        </strong>
        <div className={ui.toolbarActions}>
          <Button
            size="small"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            历史对话
          </Button>
          <Button
            size="small"
            disabled={
              loading || sending || contextSaving || Boolean(conversationError)
            }
            onClick={newConversation}
          >
            新建对话
          </Button>
          <Button
            size="small"
            data-assistant-requirements-trigger
            disabled={legacy}
            onClick={() => setRequirementsOpen(true)}
          >
            设计要求
          </Button>
        </div>
      </div>
      {historyOpen ? (
        <div className={ui.history}>
          <label htmlFor={`${inputId}-history`}>选择历史对话</label>
          <select
            id={`${inputId}-history`}
            aria-label="历史对话"
            disabled={sending || contextSaving || loading}
            onChange={(event) => activateConversation(event.target.value)}
            value={conversationId}
          >
            {!conversationId ? <option value="">新设计对话</option> : null}
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || "未命名对话"}
                {item.mode === "workflow" ? "" : " · 只读历史"}
              </option>
            ))}
          </select>
          {!conversations.length && !loading ? (
            <small>还没有历史对话。发送第一条需求后会建立对话。</small>
          ) : null}
        </div>
      ) : null}
      <div
        ref={conversationView}
        onWheel={stopScroll}
        onPointerDown={stopScroll}
        onKeyDown={stopScroll}
        aria-label="设计对话"
        aria-live="polite"
        className={styles.assistantConversation}
        onScroll={(event) => {
          const view = event.currentTarget;
          if (scrollFrame.current) {
            if (Math.abs(view.scrollTop - expectedScroll.current) <= 2) return;
            stopScroll();
          }
          if (
            view.clientWidth !== conversationSize.current.width ||
            view.clientHeight !== conversationSize.current.height
          )
            return;
          followMessages.current =
            view.scrollHeight - view.scrollTop - view.clientHeight <
            STUDIO_LAYOUT.followThreshold;
          if (followMessages.current) {
            setNewMessages(false);
            readingAnchor.current = null;
          } else {
            const top = view.getBoundingClientRect().top;
            const anchor = Array.from(
              view.querySelectorAll<HTMLElement>("[data-message-id]"),
            ).find((item) => item.getBoundingClientRect().bottom > top);
            readingAnchor.current = anchor?.dataset.messageId
              ? {
                  id: anchor.dataset.messageId,
                  offset: anchor.getBoundingClientRect().top - top,
                }
              : null;
          }
        }}
        data-empty={!loading && messages.length === 0}
      >
        {messageSync.error ? (
          <Notice tone="warning">
            {userFacingError(messageSync.error, "设计对话暂时无法同步")}
            <Button
              onClick={() => {
                messageSync.retry();
              }}
              type="button"
            >
              重试同步
            </Button>
          </Notice>
        ) : null}
        {legacyMessageError ? (
          <Notice tone="error">
            {legacyMessageError}
            <Button onClick={() => setLegacyReload((value) => value + 1)}>
              重新读取消息
            </Button>
          </Notice>
        ) : null}
        {conversationError ? (
          <Notice tone="error">
            {conversationError}
            <Button onClick={() => setConversationReload((value) => value + 1)}>
              重新读取对话
            </Button>
          </Notice>
        ) : null}
        {loading ? (
          <div className={styles.chatEmpty}>
            <Skeleton label="正在恢复设计对话…" />
            <Skeleton label="正在读取历史消息" />
          </div>
        ) : !conversationError &&
          !legacyMessageError &&
          messages.length === 0 && !(localSubmission && localSubmission.conversationId === conversationId) ? (
          <div className={styles.assistantWelcome}>
            <h3>
              {legacy
                ? "这段历史会话没有消息"
                : graph.nodes.some((node) => node.type === "candidate")
                  ? "从已有方案继续设计"
                  : "先说说你想做的服装"}
            </h3>
            {!legacy ? (
              <>
                <p>
                  {graph.nodes.some((node) => node.type === "candidate")
                    ? "选择作品旁的“继续修改”，写下要调整和保留的细节。也可以描述一个新想法。"
                    : "写下款式、穿着场景和想保留的细节，也可以添加参考素材。"}
                </p>
                <ol className={ui.startSteps}>
                  <li>描述需求</li>
                  <li>核对生成要求</li>
                  <li>确认生成</li>
                </ol>
                <Button
                  disabled={collaborationReadOnly || Boolean(prompt.trim())}
                  onClick={() => {
                    setPrompt(
                      "设计一件秋冬通勤风衣，藏蓝色、宽松廓形，保留立领，生成 2 张方案。",
                    );
                    composerInput.current?.focus({ preventScroll: true });
                  }}
                >
                  填入示例
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {cursor ? (
          <button
            className={styles.historyAction}
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void listWorkflowMessages(conversationId, cursor)
                .then((page) => {
                  setMessages((current) => [
                    ...page.items,
                    ...current.filter(
                      (item) =>
                        !page.items.some((older) => older.id === item.id),
                    ),
                  ]);
                  setCursor(page.nextCursor);
                })
                .catch((error: unknown) =>
                  onError(
                    error instanceof Error ? error.message : "历史读取失败",
                  ),
                )
                .finally(() => setLoading(false));
            }}
            type="button"
          >
            读取更早消息
          </button>
        ) : null}
        {([...messages.map((message) => ({ kind: "server" as const, message })),
          ...(localSubmission && localSubmission.conversationId === conversationId && !messages.some((message) => message.role === "user" && message.clientRequestId === localSubmission.clientRequestId)
            ? [{ kind: "local" as const, submission: localSubmission }] : []),
        ]).map((row) => {
          if (row.kind === "local") return <article className={styles.workflowMessage} data-role="user" data-new="true" key={`request:${conversationId}:${row.submission.clientRequestId}`}>
            <div className={styles.userExample}>{row.submission.content}</div>
            <small role="status">{row.submission.phase === "sending" ? "正在发送…" : "发送结果尚未确认，可用下方发送按钮重试。"}</small>
          </article>;
          const message = row.message;
          return (
          <article
            className={styles.workflowMessage}
            data-role={message.role}
            data-message-id={message.id}
            data-new={freshMessages.current.has(message.id)}
            key={messageDisplayKey(conversationId, message)}
          >
            {message.kind === "clarify" ? (
              <span className={styles.messageKind}>需要补充</span>
            ) : null}
            {message.origin === "execution_result" ? (
              <span className={styles.messageKind}>执行结果</span>
            ) : message.origin === "background_analysis" ? (
              <span className={styles.messageKind}>结果分析 · 可继续输入</span>
            ) : null}
            <div
              data-revealed={message.role === "assistant" && message.status !== "pending" && freshMessages.current.has(message.id)}
              className={
                message.role === "user"
                  ? styles.userExample
                  : `${styles.assistantReply} ${prose.prose}`
              }
            >
              {message.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {message.content}
                </ReactMarkdown>
              ) : (
                message.content
              )}
            </div>
            {message.status === "pending" ? (
              <small role="status" className={styles.thinking}>正在分析设计需求<span aria-hidden="true"><i /><i /><i /></span></small>
            ) : null}
            {message.error ? (
              <small role="alert">
                {userFacingError(
                  message.error.message,
                  "本轮处理未完成，可以重试",
                )}
              </small>
            ) : null}
            {message.role === "assistant" &&
            message.status === "failed" &&
            message.error?.code !== "WORKFLOW_BUDGET_EXHAUSTED" &&
            !legacy &&
            messages.some(
              (user) => user.id === message.replyToId && user.clientRequestId,
            ) ? (
              <button
                className={styles.actionSecondary}
                disabled={sending || contextSaving || pendingReply}
                onClick={() => void retryMessage(message)}
                type="button"
              >
                重试这条回复
              </button>
            ) : null}
            {message.role === "assistant" && message.status !== "pending" ? (
              <MessageReferenceRecord
                context={message.context}
                graph={graph}
                onLocate={onLocate}
              />
            ) : null}
            {message.proposal ? (
              <ProposalReview
                proposal={message.proposal}
                graph={graph}
                submitting={submittingProposal === message.proposal.id}
                disabled={sending || pendingReply || collaborationReadOnly}
                error={executionErrors[message.proposal.id]}
                onAccept={() => {
                  if (message.proposal) void decide(message.proposal, "accept");
                }}
                onReject={() => {
                  if (message.proposal) void decide(message.proposal, "reject");
                }}
                onAdjust={() => {
                  if (!message.proposal) return;
                  setAdjustment(message.proposal);
                  setReferencedIds(message.proposal.referencedNodeIds);
                  composerInput.current?.focus({ preventScroll: true });
                }}
                onOpenResult={onOpenResult}
                onContinue={addReference}
              />
            ) : null}
          </article>
        ); })}
      </div>
      {newMessages ? (
        <button
          className={styles.newMessages}
          onClick={() => {
            followMessages.current = true;
            setNewMessages(false);
            if (conversationView.current)
              scrollToLatest(conversationView.current);
          }}
          type="button"
        >
          有新消息 ↓
        </button>
      ) : null}
      {legacy && legacyRunsOpen ? renderLegacyRuns(conversationId) : null}
      <div ref={composerSurface} className={styles.composer}>
        {legacy ? (
          <div className={styles.legacyReadOnly}>
            <p>
              这是只读历史。使用顶部“新建对话”继续设计，项目目标和有效偏好仍会沿用。
            </p>
          </div>
        ) : agentVersion === 1 ? (
          <div className={styles.legacyReadOnly}>
            <p>本项目设计助手已暂停。已有任务继续运行，历史消息仍可查看。</p>
            <Button disabled={sending} onClick={toggleAgent}>
              恢复设计助手
            </Button>
          </div>
        ) : (
          <>
            {draftNotice ? (
              <div className={ui.draftNotice} role="status">
                <span>{draftNotice}</span>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setDraftNotice(null)}
                >
                  知道了
                </Button>
              </div>
            ) : null}
            <div className={ui.discussion} aria-label="正在讨论">
              <span>
                {draftReferences.ids.length ? "本次发送的引用" : "当前讨论对象"}
              </span>
              {discussionIds.length > 0 ? (
                <button
                  className={styles.actionQuiet}
                  disabled={
                    sending ||
                    pendingReply ||
                    contextSaving ||
                    (Boolean(conversationId) && !context)
                  }
                  onClick={() => void clearDiscussion()}
                  type="button"
                >
                  改为讨论整个项目
                </button>
              ) : null}
              <div className={ui.discussionReferences}>
                {discussionIds.length ? (
                  discussionIds.map((id) => (
                    <span
                      className={
                        draftReferences.ids.length
                          ? ui.referenceChip
                          : undefined
                      }
                      key={id}
                    >
                      <button
                        className={styles.nodeLink}
                        title={
                          graph.nodes.find((node) => node.id === id)?.title ??
                          "已移除节点"
                        }
                        disabled={!graph.nodes.some((node) => node.id === id)}
                        onClick={() => onLocate(id)}
                        type="button"
                      >
                        {graph.nodes.find((node) => node.id === id)?.title ??
                          "已移除节点"}
                      </button>
                      {draftReferences.ids.length ? (
                        <button
                          className={ui.removeReference}
                          disabled={sending || contextSaving}
                          aria-label={`移除引用 ${graph.nodes.find((node) => node.id === id)?.title ?? id}`}
                          onClick={() => {
                            setReferencedIds((current) =>
                              current.filter((item) => item !== id),
                            );
                            setPrompt((value) =>
                              removeReferenceMentions(value, graph.nodes, [id]),
                            );
                          }}
                          type="button"
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))
                ) : (
                  <span>
                    {conversationId && !context
                      ? contextError
                        ? "讨论对象读取失败"
                        : "正在读取…"
                      : "整个项目"}
                  </span>
                )}
              </div>
            </div>
            {contextError ? (
              <p role="alert">
                {userFacingError(
                  contextError,
                  "讨论对象读取失败，请重新读取后发送。",
                )}
                <button type="button" onClick={retryContext}>
                  重新读取
                </button>
              </p>
            ) : null}
            {missingReferenceIds.length ? (
              <div className={ui.draftNotice} role="alert">
                <span>
                  {missingReferenceIds.length}{" "}
                  项引用已被移除，请清除失效引用并核对正文后再发送。
                </span>
                <Button
                  size="small"
                  onClick={() =>
                    setReferencedIds((ids) =>
                      ids.filter((id) => !missingReferenceIds.includes(id)),
                    )
                  }
                >
                  清除失效引用
                </Button>
              </div>
            ) : null}
            {draftReferences.error ? (
              <p role="status">{draftReferences.error}</p>
            ) : null}
            {draftReferences.ids.length >= MAX_ASSISTANT_REFERENCES ? (
              <p className={ui.helper} role="status">
                已引用 {draftReferences.ids.length} 项，最多 16
                项，请移除后再添加。
              </p>
            ) : null}
            {selected && !draftReferences.ids.includes(selected.id) ? (
              <button
                className={styles.referenceAction}
                disabled={sending || contextSaving}
                onClick={() => addReference(selected.id)}
                type="button"
              >
                引用选中对象「{displayNodeTitle(selected)}」
              </button>
            ) : null}

            {mentionChoices.length > 0 ? (
              <div aria-label="引用画布节点" className={styles.mentionChoices}>
                {mentionChoices.map((node) => (
                  <button
                    disabled={sending || contextSaving}
                    key={node.id}
                    onClick={() => {
                      if (!addReference(node.id)) return;
                      setPrompt((value) =>
                        value.replace(
                          /(?:^|\s)@([^@\s]*)$/u,
                          (match) =>
                            `${match.startsWith(" ") ? " " : ""}@${node.title} `,
                        ),
                      );
                    }}
                    type="button"
                  >
                    @{node.title}
                    <small>
                      {node.kind === "asset" ? "素材" : "工具"}
                      {graph.nodes.filter((item) => item.title === node.title)
                        .length > 1
                        ? ` · ${node.id}`
                        : ""}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
            {adjustment ? (
              <div className={styles.adjustmentContext}>
                <span>
                  {staleAdjustment
                    ? "这条确认要求已失效或无法核实，请取消后重新描述需求。"
                    : "正在修改确认卡中的要求"}
                </span>
                <button type="button" onClick={() => setAdjustment(null)}>
                  取消修改
                </button>
              </div>
            ) : null}
            <label className={ui.fieldLabel} htmlFor={inputId}>
              描述设计需求
            </label>
            <textarea
              id={inputId}
              ref={composerInput}
              aria-describedby={`${inputId}-hint`}
              disabled={loading || sending || contextSaving}
              maxLength={MAX_AGENT_MESSAGE_LENGTH}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                adjustment
                  ? "例如：保留版型，将面料改为亚麻，生成 2 张。"
                  : "例如：设计一件秋冬通勤风衣，藏蓝色，宽松廓形。"
              }
              rows={3}
              value={prompt}
            />
            <p className={ui.helper} id={`${inputId}-hint`}>
              {pendingReply
                ? "助手正在回复，你可以先写下下一条需求。"
                : "发送后先讨论需求，生成前会请你确认。"}
            </p>
          </>
        )}
        <div className={styles.composerActions}>
          {!collaborationReadOnly ? (
            <Button
              size="small"
              data-assistant-reference-trigger
              disabled={loading || sending || contextSaving}
              onClick={() => setPickerOpen(true)}
            >
              添加引用
            </Button>
          ) : null}
          <Menu
            label="对话操作"
            trigger="更多"
            placement="top"
            align="start"
            portal
          >
            {legacy ? (
              <button
                onClick={() => setLegacyRunsOpen((value) => !value)}
                type="button"
              >
                旧设计运行
              </button>
            ) : null}
            <button disabled={sending} onClick={toggleAgent} type="button">
              {agentVersion === 2 ? "暂停本项目设计助手" : "恢复设计助手"}
            </button>
            <p className={ui.menuHint}>
              设置作用于整个项目；暂停后，已有任务继续运行。
            </p>
          </Menu>
          {!collaborationReadOnly ? (
            <button
              className={styles.actionPrimary}
              disabled={
                loading ||
                sending ||
                contextSaving ||
                pendingReply ||
                !prompt.trim() ||
                Boolean(conversationError) ||
                Boolean(draftReferences.error) ||
                missingReferenceIds.length > 0 ||
                draftReferences.ids.length > MAX_ASSISTANT_REFERENCES ||
                staleAdjustment ||
                (Boolean(conversationId) && !context)
              }
              onClick={() => void send()}
              type="button"
            >
              {sending
                ? executionFlight.current
                  ? "提交中…"
                  : "发送中…"
                : adjustment
                  ? "发送修改要求"
                  : "发送需求"}
            </button>
          ) : null}
        </div>
        {!collaborationReadOnly ? (
          <small className={ui.keyboardHint}>
            Enter 发送 · Shift + Enter 换行
          </small>
        ) : null}
      </div>
        <AssistantReferencePicker
          open={pickerOpen}
          graph={graph}
          selectedIds={draftReferences.ids}
          onApply={(ids) => {
            setReferencedIds(ids);
            setPrompt((value) =>
              removeReferenceMentions(
                value,
                graph.nodes,
                draftReferences.ids.filter((id) => !ids.includes(id)),
              ),
            );
            setPickerOpen(false);
          }}
          onAddMaterial={() => {
            setPickerOpen(false);
            onAddMaterial();
          }}
          onClose={() => setPickerOpen(false)}
        />
        <DesignRequirementsDrawer
          open={requirementsOpen}
          key={conversationId}
          hasDraftReferences={draftReferences.ids.length > 0}
          context={context}
          error={correctionError ?? contextError}
          graph={graph}
          saving={
            collaborationReadOnly || contextSaving || sending || pendingReply
          }
          onLocate={(id) => {
            onLocate(id);
            setRequirementsOpen(false);
          }}
          onUpdate={updateContext}
          onRetry={retryContext}
          onClose={() => setRequirementsOpen(false)}
        />
    </div>
  );
}
