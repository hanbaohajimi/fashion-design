"use client";
import { Menu } from "../../../components/ui";
import { STUDIO_LAYOUT } from "../../../components/ui-config";
import { userFacingError } from "../../../components/user-facing-error";
import { useSerialPolling } from "../../use-serial-polling";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DesignRequirementsDrawer } from "./DesignRequirementsDrawer";
import { MessageReferenceRecord } from "./MessageReferenceRecord";
import { resolveDraftReferences, removeReferenceMentions } from "./discussion-references";
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
import { decideWorkflowProposal, fetchWorkflowToolCatalog, updateWorkflowAgentSettings, type WorkflowGraph, type WorkflowNode, type WorkflowProposal } from "./workflow-api";
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
  readonly focusRequest?: number;
  readonly referenceRequest?: { readonly nodeId: string; readonly nonce: number } | null;
  readonly renderLegacyRuns: (conversationId: string) => ReactNode;
  readonly onConversationChange?: (conversationId: string | null) => void;
}

function mergeMessages(current: readonly WorkflowMessageView[], incoming: readonly WorkflowMessageView[]) {
  const updates = new Map(incoming.map((message) => [message.id, message]));
  const merged = current.map((message) => updates.get(message.id) ?? message);
  const seen = new Set(current.map((message) => message.id));
  return [...merged, ...incoming.filter((message) => !seen.has(message.id))];
}

export function WorkflowAssistantPanel({ graph, projectId, selected, onGraphChange, onProposal, onNotice, onError, onLocate, renderLegacyRuns, onConversationChange, onOpenResult, focusRequest = 0, referenceRequest }: Props) {
  const [conversations, setConversations] = useState<readonly WorkflowConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<readonly WorkflowMessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [context, setContext] = useState<WorkflowConversationContext | null>(null);
  const [adjustment, setAdjustment] = useState<WorkflowProposal | null>(null);
  const [executionErrors, setExecutionErrors] = useState<Record<string, string>>({});
  const executionFlight = useRef(false);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusRequest) composerInput.current?.focus({ preventScroll: true }); }, [focusRequest]);
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
  const [legacyRunsOpen, setLegacyRunsOpen] = useState(false);
  const activeId = useRef(conversationId);
  const initializedMessages = useRef("");
  const contextEpoch = useRef(0);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  const conversationView = useRef<HTMLDivElement>(null);
  const composerSurface = useRef<HTMLDivElement>(null);
  const conversationSize = useRef({ width: 0, height: 0 });
  const readingAnchor = useRef<{ id: string; offset: number } | null>(null);
  const followMessages = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const active = conversations.find((item) => item.id === conversationId);
  const legacy = Boolean(active && active.mode !== "workflow");
  const pendingReply = messages.some((message) => message.role === "assistant" && message.status === "pending" && message.origin !== "background_analysis" && message.origin !== "execution_result");
  const collaborationReadOnly = legacy || agentVersion === 1;
  const consumedReference = useRef<unknown>(null);
  useEffect(() => {
    if (!referenceRequest || loading || consumedReference.current === referenceRequest) return;
    consumedReference.current = referenceRequest;
    if (collaborationReadOnly) { onError("请先打开可编辑的设计对话再引用素材。"); return; }
    if (!graph.nodes.some((node) => node.id === referenceRequest.nodeId)) return;
    setReferencedIds((current) => [...new Set([...current, referenceRequest.nodeId])]);
    composerInput.current?.focus({ preventScroll: true });
  }, [collaborationReadOnly, graph.nodes, loading, onError, referenceRequest]);
  const mentionMatch = prompt.match(/(?:^|\s)@([^@\s]*)$/u);
  const mentionChoices = mentionMatch ? graph.nodes.filter((node) => node.title.includes(mentionMatch[1] ?? "") && !referencedIds.includes(node.id)).slice(0, 6) : [];

  useEffect(() => { activeId.current = conversationId; }, [conversationId]);
  useEffect(() => { onConversationChange?.(legacy || !conversationId ? null : conversationId); }, [conversationId, legacy, onConversationChange]);
  useEffect(() => { let active = true; void fetchWorkflowToolCatalog(projectId).then((catalog) => { if (active) setAgentVersion(catalog.agentVersion); }).catch(() => undefined); return () => { active = false; }; }, [projectId]);

  const activateConversation = useCallback((id: string) => {
    followMessages.current = true;
    readingAnchor.current = null;
    setNewMessages(false);
    initializedMessages.current = "";
    contextEpoch.current += 1;
    activeId.current = id;
    setConversationId(id);
    setMessages([]);
    setCursor(null);
    setContext(null);
    setAdjustment(null);
    setContextError(null);
    setReferencedIds([]);
    setPrompt("");
    setRequirementsOpen(false);
    setCorrectionError(null);
    setLoading(Boolean(id));
    pendingRequest.current = null;
    onProposal(null);
  }, [onProposal]);

  useEffect(() => {
    const activate = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      activateConversation(id);
      void listAgentConversations(projectId).then((page) => setConversations(page.items)).catch(() => undefined);
    };
    window.addEventListener("fashion-workflow:conversation", activate);
    return () => window.removeEventListener("fashion-workflow:conversation", activate);
  }, [activateConversation, projectId]);

  useEffect(() => {
    let disposed = false;
    void listAgentConversations(projectId).then((page) => {
      if (disposed) return;
      setConversations(page.items);
      activateConversation(page.items.find((item) => item.mode === "workflow")?.id ?? "");
    }).catch((error: unknown) => {
      if (!disposed) { onError(error instanceof Error ? error.message : "会话读取失败"); setLoading(false); }
    });
    return () => { disposed = true; };
  }, [activateConversation, onError, projectId]);

  useEffect(() => {
    let disposed = false;
    if (!conversationId || !legacy) return;
    void listWorkflowMessages(conversationId).then((page) => {
      if (!disposed) { setMessages((current) => mergeMessages(page.items, current)); setCursor(page.nextCursor); setLoading(false); }
    }).catch((error: unknown) => {
      if (!disposed) { onError(error instanceof Error ? error.message : "会话消息读取失败"); setLoading(false); }
    });
    return () => { disposed = true; };
  }, [conversationId, legacy, onError, onProposal]);

  const refreshContext = useCallback(async () => {
    if (!conversationId || legacy) return;
    const epoch = contextEpoch.current;
    const result = await fetchWorkflowConversationContext(conversationId);
    if (activeId.current === conversationId && contextEpoch.current === epoch) { setContext(result); setContextError(null); }
  }, [conversationId, legacy]);

  useEffect(() => {
    let disposed = false;
    if (!conversationId || legacy) return;
    const epoch = ++contextEpoch.current;
    void fetchWorkflowConversationContext(conversationId).then((result) => {
      if (!disposed && contextEpoch.current === epoch) { setContext(result); setContextError(null); }
    }).catch((error: unknown) => { if (!disposed && contextEpoch.current === epoch) setContextError(error instanceof Error ? error.message : "上下文读取失败"); });
    return () => { disposed = true; };
  }, [conversationId, graph.revision, legacy]);

  useEffect(() => {
    if (!context?.visualCoverage?.pending || legacy || contextSaving) return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void refreshContext().catch(() => undefined).finally(() => { inFlight = false; });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [context?.visualCoverage?.pending, contextSaving, legacy, refreshContext]);

  const messageSync = useSerialPolling(conversationId ?? "", Boolean(conversationId && !legacy), 2500, async (signal) => {
    if (!conversationId) return;
    try {
      const page = await listWorkflowMessages(conversationId, undefined, signal);
      signal.throwIfAborted(); setMessages((current) => mergeMessages(current, page.items));
      if (initializedMessages.current !== conversationId) { initializedMessages.current = conversationId; setCursor(page.nextCursor); }
    } finally { if (!signal.aborted) setLoading(false); }
  });


  useEffect(() => {
    const pending = [...messages].reverse().find((message) => message.proposal?.status === "pending")?.proposal ?? null;
    onProposal(pending);
    const latestContext = [...messages].reverse().find((message) => message.role === "assistant" && message.context)?.context;
    if (latestContext && !pendingReply) void refreshContext().catch(() => undefined);
  }, [messages, onProposal, pendingReply, refreshContext]);

  const latestMessage = messages.at(-1);
  const latestMessageKey = latestMessage ? `${latestMessage.id}:${latestMessage.status}:${latestMessage.content.length}` : "";
  const proposalResultKey = messages.filter((message) => message.proposal).map(({ proposal }) => {
    const tool = graph.nodes.find((node) => node.id === proposal?.toolNodeId);
    const outputs = graph.edges.filter((edge) => edge.sourceNodeId === tool?.id).map((edge) => edge.targetNodeId);
    return `${proposal?.id}:${proposal?.status}:${tool?.status}:${outputs.join(",")}`;
  }).join("|");
  useEffect(() => {
    if (followMessages.current && conversationView.current) conversationView.current.scrollTop = conversationView.current.scrollHeight;
    else setNewMessages(true);
  }, [latestMessageKey, pendingReply, proposalResultKey]);

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
        conversationSize.current = { width: view.clientWidth, height: view.clientHeight };
        if (followMessages.current) view.scrollTop = view.scrollHeight;
        else if (readingAnchor.current) {
          const anchor = Array.from(view.querySelectorAll<HTMLElement>("[data-message-id]")).find((item) => item.dataset.messageId === readingAnchor.current?.id);
          if (anchor) view.scrollTop += anchor.getBoundingClientRect().top - view.getBoundingClientRect().top - readingAnchor.current.offset;
        }
      });
    });
    observer.observe(view);
    observer.observe(composer);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [conversationId]);

  const createConversation = async (keepDraft = false) => {
    const created = await createAgentConversation(projectId, { mode: "workflow" });
    const workflow = { ...created, mode: "workflow" as const };
    setConversations((current) => [workflow, ...current]);
    activateConversation(created.id);
    if (keepDraft) { setPrompt(prompt); setReferencedIds(referencedIds); }
    setLegacyRunsOpen(false);
    return created.id;
  };

  const reloadContextAfterTurn = (targetId: string) => {
    const epoch = ++contextEpoch.current;
    setContext(null);
    setContextError(null);
    void fetchWorkflowConversationContext(targetId).then((value) => {
      if (activeId.current === targetId && contextEpoch.current === epoch) { setContext(value); setContextError(null); }
    }).catch((error: unknown) => {
      if (activeId.current === targetId && contextEpoch.current === epoch) setContextError(error instanceof Error ? error.message : "讨论对象读取失败，请重新读取");
    });
  };

  const send = async () => {
    const content = prompt.trim();
    if (!content || sending || loading || contextSaving || collaborationReadOnly || pendingReply || (conversationId && !context)) return;
    if (content.length > MAX_AGENT_MESSAGE_LENGTH) { onError(`设计需求最多 ${MAX_AGENT_MESSAGE_LENGTH} 个字符`); return; }
    const { ids: refs, error: referenceError } = resolveDraftReferences(graph.nodes, content, referencedIds);
    if (referenceError) { onError(referenceError); return; }
    if (refs.length > 16) { onError("每次最多引用 16 个节点，请移除部分引用"); return; }
    followMessages.current = true;
    setNewMessages(false);
    setSending(true);
    onError(null);
    try {
      const targetId = conversationId || await createConversation(true);
      const focus = refs.length ? refs : context?.focusNodeIds ?? [];
      const key = JSON.stringify({ targetId, content, refs, focus, proposalId: adjustment?.id });
      const requestId = pendingRequest.current?.key === key ? pendingRequest.current.id : crypto.randomUUID();
      pendingRequest.current = { key, id: requestId };
      const turn = await sendWorkflowMessage(targetId, { clientRequestId: requestId, content, referencedNodeIds: refs, focusNodeIds: focus, ...(adjustment ? { respondingToProposalId: adjustment.id } : {}) });
      if (activeId.current !== targetId) return;
      setMessages((current) => mergeMessages(current, [turn.userMessage, turn.assistantMessage]));
      if (turn.assistantMessage.proposal?.status === "pending") onProposal(turn.assistantMessage.proposal);
      setPrompt("");
      setAdjustment(null);
      setReferencedIds([]);
      pendingRequest.current = null;
      reloadContextAfterTurn(targetId);
    } catch (error) { onError(error instanceof Error ? error.message : "设计消息发送失败"); }
    finally { setSending(false); }
  };

  const updateContext = async (change: WorkflowContextCorrection) => {
    if (!context || !conversationId || collaborationReadOnly || contextSaving) return false;
    const epoch = ++contextEpoch.current;
    setContextSaving(true);
    setCorrectionError(null);
    try {
      const result = await updateWorkflowConversationContext(conversationId, { baseRevision: context.revision, ...(context.summaryRevision !== undefined ? { summaryRevision: context.summaryRevision } : {}), mutationId: crypto.randomUUID(), ...change });
      if (activeId.current !== conversationId || contextEpoch.current !== epoch) return false;
      setContext(result);
      setContextError(null);
      onNotice(change.focusNodeIds ? "讨论对象已更新" : "设计要求已更新");
      return true;
    } catch (error) {
      if (activeId.current === conversationId) {
        const message = error instanceof Error ? error.message : "修改未保存，请重试";
        setCorrectionError(message);
        onError(message);
        void refreshContext().catch(() => undefined);
      }
      return false;
    }
    finally { setContextSaving(false); }
  };

  const retryMessage = async (assistant: WorkflowMessageView) => {
    const user = messages.find((message) => message.id === assistant.replyToId && message.role === "user");
    if (!user?.clientRequestId || !conversationId || sending || contextSaving || pendingReply || legacy) return;
    setSending(true);
    onError(null);
    const targetId = conversationId;
    try {
      const turn = await sendWorkflowMessage(targetId, {
        clientRequestId: user.clientRequestId, content: user.content,
        referencedNodeIds: user.context?.referencedNodeIds ?? [],
        ...(Array.isArray(user.context?.focusNodeIds) ? { focusNodeIds: user.context.focusNodeIds } : {}),
        ...(user.context?.respondingToProposalId ? { respondingToProposalId: user.context.respondingToProposalId } : {}),
      });
      if (activeId.current === targetId) {
        setMessages((current) => mergeMessages(current, [turn.userMessage, turn.assistantMessage]));
        reloadContextAfterTurn(targetId);
      }
    } catch (error) { onError(error instanceof Error ? error.message : "回复重试失败"); }
    finally { setSending(false); }
  };

  const decide = async (proposal: WorkflowProposal, decision: "accept" | "reject") => {
    if (executionFlight.current || sending || collaborationReadOnly) return;
    executionFlight.current = true;
    setSending(true);
    const targetId = conversationId;
    setExecutionErrors((current) => ({ ...current, [proposal.id]: "" }));
    const markAccepted = (next: WorkflowGraph) => {
      onGraphChange(next);
      if (activeId.current === targetId) {
        setMessages((current) => current.map((message) => message.proposal?.id === proposal.id
          ? { ...message, proposal: { ...message.proposal, status: "accepted" } } : message));
        onProposal(null);
        if (adjustment?.id === proposal.id) setAdjustment(null);
      }
    };
    try {
      if (decision === "reject") {
        onGraphChange(await decideWorkflowProposal(projectId, proposal, "reject"));
        if (activeId.current === targetId) {
          setMessages((current) => current.map((message) => message.proposal?.id === proposal.id
            ? { ...message, proposal: { ...message.proposal, status: "rejected" } } : message));
          onProposal(null);
          if (adjustment?.id === proposal.id) setAdjustment(null);
        }
      } else {
        if (!targetId) throw new Error("请先打开这条方案所属的对话。");
        onGraphChange(await acceptAndExecuteProposal(projectId, proposal, targetId, markAccepted));
        window.dispatchEvent(new Event("fashion-workflow:refresh"));
      }
    } catch (error) {
      setExecutionErrors((current) => ({ ...current, [proposal.id]: userFacingError(error, "本次提交未完成，请重试；已保存的方案会保留。") }));
    } finally {
      executionFlight.current = false;
      setSending(false);
    }
  };

  const draftReferences = resolveDraftReferences(graph.nodes, prompt, referencedIds);
  const discussionIds = draftReferences.ids.length ? draftReferences.ids : context?.focusNodeIds ?? [];
  const clearDiscussion = async () => {
    const target = activeId.current;
    const ids = [...new Set([...draftReferences.ids, ...(context?.focusNodeIds ?? [])])];
    if (conversationId && (!context || !await updateContext({ focusNodeIds: [] }))) return;
    if (activeId.current !== target) return;
    setReferencedIds([]);
    setPrompt((value) => removeReferenceMentions(value, graph.nodes, ids));
    composerInput.current?.focus({ preventScroll: true });
  };
  const retryContext = () => { void refreshContext().catch((error: unknown) => setContextError(error instanceof Error ? error.message : "设计要求读取失败")); };

  return <div className={styles.assistantBody}>
    {historyOpen ? <div className={styles.chatToolbar}><select aria-label="历史会话" disabled={sending} onChange={(event) => activateConversation(event.target.value)} value={conversationId}>
      {!conversationId ? <option value="">新设计对话</option> : null}
      {conversations.map((item) => <option key={item.id} value={item.id}>{item.title || "未命名对话"}{item.mode === "workflow" ? "" : " · 只读历史"}</option>)}
    </select></div> : null}
    <div ref={conversationView} aria-label="设计对话" aria-live="polite" className={styles.assistantConversation} onScroll={(event) => {
      const view = event.currentTarget;
      if (view.clientWidth !== conversationSize.current.width || view.clientHeight !== conversationSize.current.height) return;
      followMessages.current = view.scrollHeight - view.scrollTop - view.clientHeight < STUDIO_LAYOUT.followThreshold;
      if (followMessages.current) { setNewMessages(false); readingAnchor.current = null; }
      else {
        const top = view.getBoundingClientRect().top;
        const anchor = Array.from(view.querySelectorAll<HTMLElement>("[data-message-id]")).find((item) => item.getBoundingClientRect().bottom > top);
        readingAnchor.current = anchor?.dataset.messageId ? { id: anchor.dataset.messageId, offset: anchor.getBoundingClientRect().top - top } : null;
      }
    }} data-empty={!loading && messages.length === 0}>
      {messageSync.error ? <p role="status">{userFacingError(messageSync.error, "设计对话暂时无法同步")}<button onClick={() => { messageSync.retry(); }} type="button">重试同步</button></p> : null}
      {loading ? <p className={styles.chatEmpty}>正在恢复设计对话…</p> : messages.length === 0 ? <div className={styles.assistantWelcome}><h3>{legacy ? "这段历史会话没有消息" : graph.nodes.some((node) => node.type === "candidate") ? "选择方案，继续调整" : "你想设计一件什么服装？"}</h3><p>{graph.nodes.some((node) => node.type === "candidate") ? "从作品旁选择“继续修改”，再写下想调整的细节与保留项。确认要求后再生成。" : "写下款式、场景和想保留的细节。确认方案后，直接在这里生成。"}</p></div> : null}
      {cursor ? <button className={styles.historyAction} disabled={loading} onClick={() => { setLoading(true); void listWorkflowMessages(conversationId, cursor).then((page) => { setMessages((current) => [...page.items, ...current.filter((item) => !page.items.some((older) => older.id === item.id))]); setCursor(page.nextCursor); }).catch((error: unknown) => onError(error instanceof Error ? error.message : "历史读取失败")).finally(() => setLoading(false)); }} type="button">读取更早消息</button> : null}
      {messages.map((message) => <article className={styles.workflowMessage} data-role={message.role} data-message-id={message.id} key={message.id}>
        {message.kind === "clarify" ? <span className={styles.messageKind}>需要补充</span> : null}
        {message.origin === "execution_result" ? <span className={styles.messageKind}>执行回执</span> : message.origin === "background_analysis" ? <span className={styles.messageKind}>结果分析 · 可继续输入</span> : null}
        <p className={message.role === "user" ? styles.userExample : styles.assistantReply}>{message.content}</p>
        {message.status === "pending" ? <small role="status">正在分析设计需求…</small> : null}
        {message.error ? <small role="alert">{userFacingError(message.error.message, "本轮处理未完成，可以重试")}</small> : null}
        {message.role === "assistant" && message.status === "failed" && message.error?.code !== "WORKFLOW_BUDGET_EXHAUSTED" && !legacy && messages.some((user) => user.id === message.replyToId && user.clientRequestId) ? <button className={styles.actionSecondary} disabled={sending || contextSaving || pendingReply} onClick={() => void retryMessage(message)} type="button">重试这条回复</button> : null}
        {message.role === "assistant" && message.status !== "pending" ? <MessageReferenceRecord context={message.context} graph={graph} onLocate={onLocate} /> : null}
        {message.proposal ? <ProposalReview proposal={message.proposal} graph={graph} disabled={sending || pendingReply || collaborationReadOnly} error={executionErrors[message.proposal.id]} onAccept={() => { if (message.proposal) void decide(message.proposal, "accept"); }} onReject={() => { if (message.proposal) void decide(message.proposal, "reject"); }} onAdjust={() => { if (!message.proposal) return; setAdjustment(message.proposal); setReferencedIds(message.proposal.referencedNodeIds); composerInput.current?.focus({ preventScroll: true }); }} onOpenResult={onOpenResult} /> : null}
      </article>)}
    </div>
    {newMessages ? <button className={styles.newMessages} onClick={() => { followMessages.current = true; setNewMessages(false); if (conversationView.current) conversationView.current.scrollTop = conversationView.current.scrollHeight; }} type="button">有新消息 ↓</button> : null}
    {legacy && legacyRunsOpen ? renderLegacyRuns(conversationId) : null}
    <div ref={composerSurface} className={styles.composer}>
      {legacy ? <div className={styles.legacyReadOnly}><p>历史聊天保留为只读。可在“更多”中新建设计对话，继承项目目标和有效偏好。</p></div> : agentVersion === 1 ? <div className={styles.legacyReadOnly}><p>设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。</p></div> : <>
      <div className={ui.discussion} aria-label="正在讨论">
        <span>{draftReferences.ids.length ? "待发送引用" : "正在讨论"}</span>
        {discussionIds.length > 0 ? <button className={styles.actionQuiet} disabled={sending || pendingReply || contextSaving || (Boolean(conversationId) && !context)} onClick={() => void clearDiscussion()} type="button">讨论整个项目</button> : null}
        <div className={ui.discussionReferences}>
          {discussionIds.length ? discussionIds.map((id) => <span className={draftReferences.ids.length ? ui.referenceChip : undefined} key={id}>
            <button className={styles.nodeLink} title={graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"} disabled={!graph.nodes.some((node) => node.id === id)} onClick={() => onLocate(id)} type="button">{graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"}</button>
            {draftReferences.ids.length ? <button className={ui.removeReference} disabled={sending || contextSaving} aria-label={`移除引用 ${graph.nodes.find((node) => node.id === id)?.title ?? id}`} onClick={() => { setReferencedIds((current) => current.filter((item) => item !== id)); setPrompt((value) => removeReferenceMentions(value, graph.nodes, [id])); }} type="button">×</button> : null}
          </span>) : <span>{conversationId && !context ? contextError ? "讨论对象读取失败" : "正在读取…" : "整个项目"}</span>}
        </div>
      </div>
      {contextError ? <p role="alert">{contextError}<button type="button" onClick={retryContext}>重新读取</button></p> : null}
      {draftReferences.error ? <p role="status">{draftReferences.error}</p> : null}
      {selected && !referencedIds.includes(selected.id) ? <button className={styles.referenceAction} disabled={sending || contextSaving} onClick={() => setReferencedIds((current) => [...new Set([...current, selected.id])].slice(0, 16))} type="button">＋ 引用「{displayNodeTitle(selected)}」</button> : null}

      {mentionChoices.length > 0 ? <div aria-label="引用画布节点" className={styles.mentionChoices} role="listbox">{mentionChoices.map((node) => <button disabled={sending || contextSaving} aria-selected={false} key={node.id} onClick={() => { setReferencedIds((current) => [...new Set([...current, node.id])].slice(0, 16)); setPrompt((value) => value.replace(/(?:^|\s)@([^@\s]*)$/u, (match) => `${match.startsWith(" ") ? " " : ""}@${node.title} `)); }} role="option" type="button">@{node.title}<small>{node.kind === "asset" ? "素材" : "工具"}{graph.nodes.filter((item) => item.title === node.title).length > 1 ? ` · ${node.id.slice(0, 8)}` : ""}</small></button>)}</div> : null}
      {adjustment ? <div className={styles.adjustmentContext}><span>修改这条方案的要求</span><button type="button" onClick={() => setAdjustment(null)}>取消修改</button></div> : null}
      <textarea ref={composerInput} aria-label="向设计助手描述下一步" disabled={loading || sending || contextSaving} maxLength={MAX_AGENT_MESSAGE_LENGTH} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={adjustment ? "例如：保留版型，将面料改为亚麻，生成 2 张。" : "例如：设计一件秋冬通勤风衣，藏蓝色，宽松廓形。"} rows={3} value={prompt} />
      </>}
      <div className={styles.composerActions}>
        <Menu label="对话操作" trigger="更多" placement="top" align="start">
          {!legacy ? <button onClick={() => setRequirementsOpen(true)} type="button">设计要求与偏好</button> : null}
          <button onClick={() => setHistoryOpen((value) => !value)} type="button">历史会话</button>
          <button disabled={sending} onClick={() => { setSending(true); void createConversation().catch((error: unknown) => onError(error instanceof Error ? error.message : "会话创建失败")).finally(() => setSending(false)); }} type="button">新建设计对话</button>
          {legacy ? <button onClick={() => setLegacyRunsOpen((value) => !value)} type="button">旧设计运行</button> : null}
          <button disabled={sending} onClick={() => { setSending(true); const version = agentVersion === 2 ? 1 : 2; void updateWorkflowAgentSettings(projectId, version).then(() => { setAgentVersion(version); onNotice(version === 2 ? "设计协作已启用" : "设计协作已暂停，历史和已有执行仍保留"); }).catch((error: unknown) => onError(error instanceof Error ? error.message : "协作设置保存失败")).finally(() => setSending(false)); }} type="button">{agentVersion === 2 ? "暂停设计协作" : "启用设计协作"}</button>
        </Menu>
        {!legacy && agentVersion !== 1 ? <><small>Shift + Enter 换行</small><button className={styles.actionPrimary} disabled={loading || sending || contextSaving || pendingReply || !prompt.trim() || (Boolean(conversationId) && !context)} onClick={() => void send()} type="button">{sending || pendingReply ? executionFlight.current ? "提交中…" : "理解中…" : adjustment ? "更新方案 ↑" : messages.length || graph.nodes.length ? "发送 ↑" : "开始设计 ↑"}</button></> : null}
      </div>
    </div>
    {requirementsOpen ? <DesignRequirementsDrawer key={conversationId} hasDraftReferences={draftReferences.ids.length > 0} context={context} error={correctionError ?? contextError} graph={graph} saving={collaborationReadOnly || contextSaving || sending || pendingReply} onLocate={(id) => { onLocate(id); setRequirementsOpen(false); }} onUpdate={updateContext} onRetry={retryContext} onClose={() => setRequirementsOpen(false)} /> : null}
  </div>;
}
