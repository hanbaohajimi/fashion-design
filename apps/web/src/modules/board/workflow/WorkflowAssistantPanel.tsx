"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getWorkflowToolContract, parseWorkflowToolParameters, WORKFLOW_TOOL_KEYS, type WorkflowToolKey } from "@fashion/shared";
import {
  createAgentConversation,
  fetchWorkflowConversationContext,
  fetchWorkflowConversationPlan,
  listAgentConversations,
  listWorkflowMessages,
  sendWorkflowMessage,
  updateWorkflowConversationContext,
  MAX_AGENT_MESSAGE_LENGTH,
  type WorkflowConversationContext,
  type WorkflowConversationSummary,
  type WorkflowContextItem,
  type WorkflowMessageView,
  type WorkflowCollaborationPlan,
  type WorkflowContextCorrection,
} from "../agent/agent-api";
import { decideWorkflowProposal, fetchWorkflowToolCatalog, updateWorkflowAgentSettings, type WorkflowGraph, type WorkflowNode, type WorkflowProposal, type WorkflowInputPort } from "./workflow-api";
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
  readonly renderLegacyRuns: (conversationId: string) => ReactNode;
  readonly onConversationChange?: (conversationId: string | null) => void;
}

function mergeMessages(current: readonly WorkflowMessageView[], incoming: readonly WorkflowMessageView[]) {
  const updates = new Map(incoming.map((message) => [message.id, message]));
  const merged = current.map((message) => updates.get(message.id) ?? message);
  const seen = new Set(current.map((message) => message.id));
  return [...merged, ...incoming.filter((message) => !seen.has(message.id))];
}

export function WorkflowAssistantPanel({ graph, projectId, selected, onGraphChange, onProposal, onNotice, onError, onLocate, renderLegacyRuns, onConversationChange }: Props) {
  const [conversations, setConversations] = useState<readonly WorkflowConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<readonly WorkflowMessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [context, setContext] = useState<WorkflowConversationContext | null>(null);
  const [plan, setPlan] = useState<WorkflowCollaborationPlan | null>(null);
  const [agentVersion, setAgentVersion] = useState<1 | 2>(2);
  const [contextError, setContextError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [referencedIds, setReferencedIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [legacyRunsOpen, setLegacyRunsOpen] = useState(false);
  const activeId = useRef(conversationId);
  const contextEpoch = useRef(0);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  const timelineEnd = useRef<HTMLDivElement>(null);
  const active = conversations.find((item) => item.id === conversationId);
  const legacy = Boolean(active && active.mode !== "workflow");
  const pendingReply = messages.some((message) => message.role === "assistant" && message.status === "pending" && message.origin !== "background_analysis" && message.origin !== "execution_result");
  const collaborationReadOnly = legacy || agentVersion === 1;
  const mentionMatch = prompt.match(/(?:^|\s)@([^@\s]*)$/u);
  const mentionChoices = mentionMatch ? graph.nodes.filter((node) => node.title.includes(mentionMatch[1] ?? "") && !referencedIds.includes(node.id)).slice(0, 6) : [];

  useEffect(() => { activeId.current = conversationId; }, [conversationId]);
  useEffect(() => { onConversationChange?.(legacy || !conversationId ? null : conversationId); }, [conversationId, legacy, onConversationChange]);
  useEffect(() => { let active = true; void fetchWorkflowToolCatalog(projectId).then((catalog) => { if (active) setAgentVersion(catalog.agentVersion); }).catch(() => undefined); return () => { active = false; }; }, [projectId]);

  const activateConversation = useCallback((id: string) => {
    contextEpoch.current += 1;
    activeId.current = id;
    setConversationId(id);
    setMessages([]);
    setCursor(null);
    setContext(null);
    setPlan(null);
    setContextError(null);
    setReferencedIds([]);
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
    if (!conversationId) return;
    void listWorkflowMessages(conversationId).then((page) => {
      if (!disposed) { setMessages((current) => mergeMessages(page.items, current)); setCursor(page.nextCursor); setLoading(false); }
    }).catch((error: unknown) => {
      if (!disposed) { onError(error instanceof Error ? error.message : "会话消息读取失败"); setLoading(false); }
    });
    return () => { disposed = true; };
  }, [conversationId, onError, onProposal]);

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

  useEffect(() => {
    if (!conversationId || legacy) return;
    let disposed = false;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void listWorkflowMessages(conversationId).then((page) => {
        if (!disposed) setMessages((current) => mergeMessages(current, page.items));
      }).catch((error: unknown) => { if (!disposed) onError(error instanceof Error ? error.message : "消息同步失败"); }).finally(() => { inFlight = false; });
      void fetchWorkflowConversationPlan(conversationId).then((next) => { if (!disposed) setPlan((current) => !current || next.revision >= current.revision ? next : current); }).catch(() => undefined);
    }, 2_500);
    void fetchWorkflowConversationPlan(conversationId).then((next) => { if (!disposed) setPlan(next); }).catch(() => undefined);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [conversationId, legacy, onError]);

  useEffect(() => {
    const pending = [...messages].reverse().find((message) => message.proposal?.status === "pending")?.proposal ?? null;
    onProposal(pending);
    const latestContext = [...messages].reverse().find((message) => message.role === "assistant" && message.context)?.context;
    if (latestContext && !pendingReply) void refreshContext().catch(() => undefined);
  }, [messages, onProposal, pendingReply, refreshContext]);

  useEffect(() => { timelineEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, pendingReply]);

  const createConversation = async () => {
    const created = await createAgentConversation(projectId, { mode: "workflow" });
    const workflow = { ...created, mode: "workflow" as const };
    setConversations((current) => [workflow, ...current]);
    activateConversation(created.id);
    setLegacyRunsOpen(false);
    return created.id;
  };

  const send = async (adjustment?: { proposalId: string; content: string; refs: readonly string[] }) => {
    const content = (adjustment?.content ?? prompt).trim();
    if (!content || sending || loading || contextSaving || collaborationReadOnly || pendingReply) return;
    if (content.length > MAX_AGENT_MESSAGE_LENGTH) { onError(`设计需求最多 ${MAX_AGENT_MESSAGE_LENGTH} 个字符`); return; }
    const namedRefs: string[] = [];
    for (const mention of content.matchAll(/(?:^|\s)@/gu)) {
      const suffix = content.slice((mention.index ?? 0) + mention[0].lastIndexOf("@") + 1);
      const matches = graph.nodes.filter((node) => suffix.startsWith(node.title) && (!suffix[node.title.length] || /[\s，。！？,.;:!?）)]/u.test(suffix[node.title.length] ?? "")));
      const longest = Math.max(0, ...matches.map((node) => node.title.length));
      const exact = matches.filter((node) => node.title.length === longest);
      if (exact.length > 1 && !exact.some((node) => referencedIds.includes(node.id))) { onError(`画布中有多个「${exact[0]?.title}」，请从 @列表选择准确节点`); return; }
      if (exact.length === 1 && exact[0]) namedRefs.push(exact[0].id);
    }
    const refs = [...new Set(adjustment ? adjustment.refs : [...referencedIds, ...namedRefs])].filter((id) => graph.nodes.some((node) => node.id === id));
    if (refs.length > 16) { onError("每次最多引用 16 个节点，请移除部分引用"); return; }
    setSending(true);
    onError(null);
    try {
      const targetId = conversationId || await createConversation();
      const focus = refs.length ? refs : context?.focusNodeIds ?? [];
      const key = JSON.stringify({ targetId, content, refs, focus, proposalId: adjustment?.proposalId });
      const requestId = pendingRequest.current?.key === key ? pendingRequest.current.id : crypto.randomUUID();
      pendingRequest.current = { key, id: requestId };
      const turn = await sendWorkflowMessage(targetId, { clientRequestId: requestId, content, referencedNodeIds: refs, focusNodeIds: focus, ...(adjustment ? { respondingToProposalId: adjustment.proposalId } : {}) });
      if (activeId.current !== targetId) return;
      setMessages((current) => mergeMessages(current, [turn.userMessage, turn.assistantMessage]));
      if (turn.assistantMessage.proposal?.status === "pending") onProposal(turn.assistantMessage.proposal);
      setPrompt("");
      setReferencedIds([]);
      pendingRequest.current = null;
      const epoch = contextEpoch.current;
      void fetchWorkflowConversationContext(targetId).then((value) => { if (activeId.current === targetId && contextEpoch.current === epoch) { setContext(value); setContextError(null); } }).catch(() => undefined);
    } catch (error) { onError(error instanceof Error ? error.message : "设计消息发送失败"); }
    finally { setSending(false); }
  };

  const updateContext = async (change: WorkflowContextCorrection) => {
    if (!context || !conversationId || collaborationReadOnly || contextSaving) return false;
    const epoch = ++contextEpoch.current;
    setContextSaving(true);
    try {
      const result = await updateWorkflowConversationContext(conversationId, { baseRevision: context.revision, ...(context.summaryRevision !== undefined ? { summaryRevision: context.summaryRevision } : {}), mutationId: crypto.randomUUID(), ...change });
      if (activeId.current === conversationId && contextEpoch.current === epoch) setContext(result);
      onNotice("设计上下文已更新");
      return true;
    } catch (error) { onError(error instanceof Error ? error.message : "上下文保存失败"); void refreshContext().catch(() => undefined); return false; }
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
      if (activeId.current === targetId) setMessages((current) => mergeMessages(current, [turn.userMessage, turn.assistantMessage]));
    } catch (error) { onError(error instanceof Error ? error.message : "回复重试失败"); }
    finally { setSending(false); }
  };

  const decide = async (proposal: WorkflowProposal, decision: "accept" | "reject", reason?: string) => {
    setSending(true);
    try {
      const next = await decideWorkflowProposal(projectId, proposal, decision, reason);
      onGraphChange(next);
      setMessages((current) => current.map((message) => message.proposal?.id === proposal.id ? { ...message, proposal: { ...message.proposal, status: decision === "accept" ? "accepted" : "rejected" } } : message));
      onProposal(null);
      onNotice(decision === "accept" ? proposal.action?.type === "configure_tool" ? "工具配置已更新，确认执行后才会运行" : "建议已加入画布，确认执行后才会运行工具" : "已跳过这条建议");
    } catch (error) { onError(error instanceof Error ? error.message : "建议处理失败"); }
    finally { setSending(false); }
  };

  return <div className={styles.assistantBody}>
    <div className={styles.assistantUtility}>
      <span>{legacy ? "历史会话 · 只读" : "持续设计协作"}</span>
      <details className={styles.assistantMore}><summary>更多</summary><div onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>
        <button onClick={() => setHistoryOpen((value) => !value)} type="button">历史会话</button>
        <button disabled={sending} onClick={() => { setSending(true); void createConversation().catch((error: unknown) => onError(error instanceof Error ? error.message : "会话创建失败")).finally(() => setSending(false)); }} type="button">新建设计对话</button>
        {legacy ? <button onClick={() => setLegacyRunsOpen((value) => !value)} type="button">旧设计运行</button> : null}
        <button disabled={sending} onClick={() => { setSending(true); const version = agentVersion === 2 ? 1 : 2; void updateWorkflowAgentSettings(projectId, version).then(() => { setAgentVersion(version); onNotice(version === 2 ? "设计协作已启用" : "设计协作已暂停，历史和已有执行仍保留"); }).catch((error: unknown) => onError(error instanceof Error ? error.message : "协作设置保存失败")).finally(() => setSending(false)); }} type="button">{agentVersion === 2 ? "暂停设计协作" : "启用设计协作"}</button>
      </div></details>
    </div>
    {historyOpen ? <div className={styles.chatToolbar}><select aria-label="历史会话" disabled={sending} onChange={(event) => activateConversation(event.target.value)} value={conversationId}>
      {!conversationId ? <option value="">新设计对话</option> : null}
      {conversations.map((item) => <option key={item.id} value={item.id}>{item.title || "未命名对话"}{item.mode === "workflow" ? "" : " · 只读历史"}</option>)}
    </select></div> : null}
    {!legacy ? <PlanPanel plan={plan} graph={graph} onLocate={onLocate} /> : null}
    {!legacy ? <ContextPanel context={context} error={contextError} graph={graph} saving={collaborationReadOnly || contextSaving || sending || pendingReply} selected={selected} onLocate={onLocate} onUpdate={updateContext} onRetry={() => { void refreshContext().catch((error: unknown) => setContextError(error instanceof Error ? error.message : "上下文读取失败")); }} /> : null}
    <div aria-label="设计对话" aria-live="polite" className={styles.assistantConversation} data-empty={!loading && messages.length === 0}>
      {loading ? <p className={styles.chatEmpty}>正在恢复设计对话…</p> : messages.length === 0 ? <p className={styles.chatEmpty}>{legacy ? "这段历史会话没有消息。" : "开始新的设计对话"}</p> : null}
      {cursor ? <button className={styles.referenceSelected} disabled={loading} onClick={() => { setLoading(true); void listWorkflowMessages(conversationId, cursor).then((page) => { setMessages((current) => [...page.items, ...current.filter((item) => !page.items.some((older) => older.id === item.id))]); setCursor(page.nextCursor); }).catch((error: unknown) => onError(error instanceof Error ? error.message : "历史读取失败")).finally(() => setLoading(false)); }} type="button">读取更早消息</button> : null}
      {messages.map((message) => <article className={styles.workflowMessage} data-role={message.role} data-message-id={message.id} key={message.id}>
        {message.kind === "clarify" ? <span className={styles.messageKind}>需要补充</span> : null}
        {message.origin === "execution_result" ? <span className={styles.messageKind}>执行回执</span> : message.origin === "background_analysis" ? <span className={styles.messageKind}>结果分析 · 可继续输入</span> : null}
        <p className={message.role === "user" ? styles.userExample : styles.assistantReply}>{message.content}</p>
        {message.status === "pending" ? <small role="status">正在结合画布理解你的需求…</small> : null}
        {message.error ? <small role="alert">{message.error.message}</small> : null}
        {message.role === "assistant" && message.status === "failed" && !legacy && messages.some((user) => user.id === message.replyToId && user.clientRequestId) ? <button className={styles.referenceSelected} disabled={sending || contextSaving || pendingReply} onClick={() => void retryMessage(message)} type="button">重试这条回复</button> : null}
        {message.proposal ? <ProposalReview proposal={message.proposal} graph={graph} disabled={sending || pendingReply || collaborationReadOnly} onAccept={() => { if (message.proposal) void decide(message.proposal, "accept"); }} onReject={(reason) => { if (message.proposal) void decide(message.proposal, "reject", reason); }} onAdjust={(content, refs) => { if (message.proposal) void send({ proposalId: message.proposal.id, content, refs }); }} /> : null}
      </article>)}
      <div ref={timelineEnd} />
    </div>
    {legacy && legacyRunsOpen ? renderLegacyRuns(conversationId) : null}
    {legacy ? <div className={styles.legacyReadOnly}><p>历史聊天保留为只读。新设计对话会继承项目目标和有效偏好。</p><button disabled={sending} onClick={() => { setSending(true); void createConversation().catch((error: unknown) => onError(error instanceof Error ? error.message : "会话创建失败")).finally(() => setSending(false)); }} type="button">新建设计对话</button></div> : agentVersion === 1 ? <div className={styles.legacyReadOnly}><p>设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。</p></div> : <div className={styles.composer}>
      {selected && !referencedIds.includes(selected.id) ? <button className={styles.referenceSelected} onClick={() => setReferencedIds((current) => [...new Set([...current, selected.id])].slice(0, 16))} type="button">＋ 引用「{displayNodeTitle(selected)}」</button> : null}
      {referencedIds.length > 0 ? <div className={styles.mentions}>{referencedIds.map((id) => <button aria-label={`移除引用 ${graph.nodes.find((node) => node.id === id)?.title ?? id}`} key={id} onClick={() => { const title = graph.nodes.find((node) => node.id === id)?.title; setReferencedIds((current) => current.filter((item) => item !== id)); if (title) setPrompt((value) => value.replace(`@${title}`, "").trimStart()); }} type="button">@{graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"} ×</button>)}</div> : null}
      {mentionChoices.length > 0 ? <div aria-label="引用画布节点" className={styles.mentionChoices} role="listbox">{mentionChoices.map((node) => <button aria-selected={false} key={node.id} onClick={() => { setReferencedIds((current) => [...new Set([...current, node.id])].slice(0, 16)); setPrompt((value) => value.replace(/(?:^|\s)@([^@\s]*)$/u, (match) => `${match.startsWith(" ") ? " " : ""}@${node.title} `)); }} role="option" type="button">@{node.title}<small>{node.kind === "asset" ? "素材" : "工具"}{graph.nodes.filter((item) => item.title === node.title).length > 1 ? ` · ${node.id.slice(0, 8)}` : ""}</small></button>)}</div> : null}
      <textarea aria-label="向设计助手描述下一步" disabled={loading} maxLength={MAX_AGENT_MESSAGE_LENGTH} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={messages.length === 0 && !legacy ? "描述你的目标、讨论已有方案，或 @ 引用画布内容…助手会结合设计路径继续协作" : "讨论设计、描述修改，或 @ 引用画布节点…"} rows={3} value={prompt} />
      <div className={styles.composerActions}><button disabled={loading || sending || contextSaving || pendingReply || !prompt.trim()} onClick={() => void send()} type="button">{sending || pendingReply ? "理解中…" : "发送 ↑"}</button></div>
    </div>}
  </div>;
}

function PlanPanel({ plan, graph, onLocate }: { readonly plan: WorkflowCollaborationPlan | null; readonly graph: WorkflowGraph; readonly onLocate: (id: string) => void }) {
  if (!plan?.plan) return null;
  const status = { pending: "待进行", active: "当前步骤", completed: "已完成", blocked: "待解决" };
  return <details aria-label="工作计划" className={styles.designContext}>
    <summary><span>工作计划</span><small>{plan.plan.milestones.find((item) => item.id === plan.plan?.activeMilestoneId)?.title ?? plan.plan.goal}</small></summary>
    <div className={styles.contextContents}><p>{plan.plan.goal}</p><ol>{plan.plan.milestones.map((item) => <li key={item.id}><strong>{status[item.status]} · {item.title}</strong>{item.completionCriteria.map((criterion) => <p key={criterion}>{criterion}</p>)}{item.evidenceRefs.filter((id) => graph.nodes.some((node) => node.id === id)).map((id) => <button key={id} onClick={() => onLocate(id)} type="button">依据：{graph.nodes.find((node) => node.id === id)?.title}</button>)}</li>)}</ol>{plan.plan.nextGoal ? <p>下一目标：{plan.plan.nextGoal}</p> : null}<small>计划会随结果和你的决定更新。每个动作仍需确认。</small></div>
  </details>;
}

const PARAMETER_LABELS: Readonly<Record<string, string>> = { prompt: "执行指令", negativePrompt: "排除内容", count: "候选数量", width: "宽度", height: "高度", quality: "图像质量", taskType: "生成方式", referenceInputs: "参考设置", mask: "蒙版", palette: "调色板" };
const INPUT_LABELS: Readonly<Record<WorkflowInputPort, string>> = { goal: "设计目标", reference: "参考素材", constraint: "设计约束", candidate: "候选方案", source: "母图" };
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function previewText(value: unknown): string {
  if (value === undefined || value === null) return "无";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(previewText).join("；");
  return Object.entries(objectValue(value)).map(([key, entry]) => `${PARAMETER_LABELS[key] ?? (key === "title" ? "标题" : key === "parameters" || key === "params" ? "参数" : key === "inputs" ? "输入" : key)}：${previewText(entry)}`).join("\n");
}

function ProposalReview({ proposal, graph, disabled, onAccept, onReject, onAdjust }: {
  readonly proposal: WorkflowProposal; readonly graph: WorkflowGraph; readonly disabled: boolean;
  readonly onAccept: () => void; readonly onReject: (reason?: string) => void;
  readonly onAdjust: (content: string, refs: readonly string[]) => void;
}) {
  const added = proposal.operations.find((operation) => operation.type === "add_node" && operation.node.kind === "tool");
  const legacyNode = added?.type === "add_node" ? added.node : null;
  const key = proposal.action?.toolKey ?? (legacyNode && WORKFLOW_TOOL_KEYS.includes(legacyNode.type as WorkflowToolKey) ? legacyNode.type as WorkflowToolKey : null);
  const contract = key ? getWorkflowToolContract(key) : null;
  const initial = proposal.action?.parameters ?? objectValue(legacyNode?.payload.params);
  const [adjusting, setAdjusting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [parameters, setParameters] = useState<Readonly<Record<string, unknown>>>({ ...contract?.defaults, ...initial });
  const [inputs, setInputs] = useState<readonly { readonly nodeId: string; readonly port: WorkflowInputPort }[]>(proposal.action?.inputs ?? proposal.operations.flatMap((operation) => operation.type === "add_edge" ? [{ nodeId: operation.edge.sourceNodeId, port: operation.edge.targetPort }] : []));
  const [error, setError] = useState<string | null>(null);
  const configure = proposal.action?.type === "configure_tool";
  const pending = proposal.status === "pending";
  const imageTool = key === "generate_design" || key === "edit_design";
  const preserve = proposal.preserve ?? proposal.action?.preserve ?? [];
  const submit = () => {
    try {
      const validated = key ? parseWorkflowToolParameters(key, parameters) : parameters;
      const text = [`请调整这条建议，保持未修改的明确要求。`, ...Object.entries(validated).map(([field, value]) => `${PARAMETER_LABELS[field] ?? field}：${previewText(value)}`), `输入绑定：${inputs.map((input) => `${INPUT_LABELS[input.port]}=${graph.nodes.find((node) => node.id === input.nodeId)?.title ?? input.nodeId}（${input.nodeId}）`).join("；")}`, ...(reason.trim() ? [`调整原因：${reason.trim()}`] : [])].join("\n");
      if (text.length > MAX_AGENT_MESSAGE_LENGTH) { setError("修改内容过长，请精简执行指令和调整原因"); return; }
      onAdjust(text, inputs.map((input) => input.nodeId));
      setAdjusting(false);
    } catch (cause) { setError(cause instanceof Error ? "参数不符合工具要求，请检查数量、尺寸、质量和参考设置。" : "参数无法读取"); }
  };
  return <div className={styles.suggestionCard}>
    <span className={styles.suggestionLabel}>{configure ? "工具配置修改" : proposal.action?.type === "fork_tool" ? "建立新的设计分支" : "画布修改建议"}</span><p>{proposal.rationale}</p>
    {preserve.length ? <p>保留：{preserve.join("、")}</p> : null}
    {configure && proposal.action?.targetNodeId ? <small>更新「{graph.nodes.find((node) => node.id === proposal.action?.targetNodeId)?.title ?? "原工具"}」；历史版本会保留。</small> : null}
    {proposal.preview ? <details className={styles.suggestionEvidence}><summary>查看修改前后</summary><strong>修改前</strong><p className={styles.previewValue}>{previewText(proposal.preview.before)}</p><strong>修改后</strong><p className={styles.previewValue}>{previewText(proposal.preview.after)}</p>{proposal.preview.effect ? <p>{previewText(proposal.preview.effect)}</p> : null}</details> : null}
    <details className={styles.suggestionEvidence}><summary>参考依据</summary><small>{proposal.referencedNodeIds.map((id) => graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点").join("、") || "当前设计路径"}</small></details>
    {pending ? <>
      {adjusting ? <div aria-label="调整建议" className={styles.proposalEditor}>
        <label>执行指令<textarea aria-label="调整执行指令" maxLength={4000} onChange={(event) => setParameters({ ...parameters, prompt: event.target.value })} rows={3} value={String(parameters.prompt ?? "")} /></label>
        {imageTool ? <><label>排除内容<textarea aria-label="调整排除内容" maxLength={3000} onChange={(event) => setParameters({ ...parameters, negativePrompt: event.target.value })} rows={2} value={String(parameters.negativePrompt ?? "")} /></label><div className={styles.toolDimensions}>{["count", "width", "height"].map((field) => <label key={field}>{PARAMETER_LABELS[field]}<input aria-label={`调整${PARAMETER_LABELS[field]}`} type="number" min={field === "count" ? 1 : 256} max={field === "count" ? 4 : 2048} step={field === "count" ? 1 : 8} value={String(parameters[field] ?? contract?.defaults[field] ?? "")} onChange={(event) => setParameters({ ...parameters, [field]: Number(event.target.value) })} /></label>)}</div><label>图像质量<select aria-label="调整图像质量" value={String(parameters.quality ?? "high")} onChange={(event) => setParameters({ ...parameters, quality: event.target.value })}><option value="auto">自动</option><option value="low">低</option><option value="medium">标准</option><option value="high">高</option></select></label></> : null}
        <strong>明确连接的输入</strong>{inputs.map((input, index) => <div className={styles.proposalInput} key={`${index}:${input.port}`}><label>{INPUT_LABELS[input.port]}<select aria-label={`调整${INPUT_LABELS[input.port]} ${index + 1}`} value={input.nodeId} onChange={(event) => setInputs((current) => current.map((item, i) => i === index ? { ...item, nodeId: event.target.value } : item))}>{graph.nodes.filter((node) => node.kind === "asset" && contract?.inputSlots.find((slot) => slot.port === input.port)?.assetTypes.includes(node.type)).map((node) => <option key={node.id} value={node.id}>{node.title} · {node.id.slice(0, 8)}</option>)}</select></label><button onClick={() => setInputs((current) => current.filter((_, i) => i !== index))} type="button">移除</button></div>)}
        {contract?.inputSlots.map((slot) => { const first = graph.nodes.find((node) => node.kind === "asset" && ["ready", "completed"].includes(node.status) && slot.assetTypes.includes(node.type) && !inputs.some((input) => input.nodeId === node.id && input.port === slot.port)); return first && inputs.filter((input) => input.port === slot.port).length < slot.max ? <button key={slot.port} onClick={() => setInputs((current) => [...current, { nodeId: first.id, port: slot.port }])} type="button">添加{INPUT_LABELS[slot.port]}</button> : null; })}
        <label>调整原因（可选）<textarea aria-label="调整原因" maxLength={600} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} /></label>
        {error ? <p role="alert">{error}</p> : null}<div className={styles.suggestionActions}><button disabled={disabled} onClick={submit} type="button">提交调整建议</button><button onClick={() => setAdjusting(false)} type="button">取消调整</button></div><small>助手会重新校验这些修改，形成新的待确认建议。</small>
      </div> : rejecting ? <div className={styles.proposalEditor}><label>跳过理由（可选）<textarea aria-label="跳过理由" maxLength={1000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className={styles.suggestionActions}><button disabled={disabled} onClick={() => onReject(reason)} type="button">确认跳过</button><button onClick={() => setRejecting(false)} type="button">返回建议</button></div></div> : <div className={styles.suggestionActions}>
        <button disabled={disabled} onClick={onAccept} type="button">{configure ? "确认修改" : "加入画布"}</button><button disabled={disabled} onClick={() => { setAdjusting(true); setRejecting(false); }} type="button">调整</button><button disabled={disabled} onClick={() => { setRejecting(true); setAdjusting(false); }} type="button">跳过</button>
      </div>}
    </> : <small>{proposal.status === "accepted" ? configure ? "配置已更新" : "已加入画布" : proposal.status === "rejected" ? `已跳过${proposal.rejectionReason ? `：${proposal.rejectionReason}` : ""}` : "建议已失效"}</small>}
  </div>;
}

function ContextPanel({ context, error, graph, saving, selected, onLocate, onUpdate, onRetry }: {
  readonly context: WorkflowConversationContext | null;
  readonly error: string | null;
  readonly graph: WorkflowGraph;
  readonly saving: boolean;
  readonly selected: WorkflowNode | null;
  readonly onLocate: (id: string) => void;
  readonly onUpdate: (change: WorkflowContextCorrection) => Promise<boolean>;
  readonly onRetry: () => void;
}) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemText, setItemText] = useState("");
  const [itemScope, setItemScope] = useState<"project" | "branch">("project");
  const focus = context?.focusNodeIds ?? [];
  const requirements = context?.requirements ?? [];
  const preferences = context?.state?.preferences ?? context?.preferences ?? [];
  const sources = context?.sources?.map((source) => ({ id: source.nodeId, title: source.title, reason: source.reason })) ?? context?.nodes?.map((node) => ({ id: node.id, title: node.title, reason: "" })) ?? [];
  const coverage = context?.coverage;
  const attemptCoverage = coverage?.attempts as { omitted?: number } | undefined;
  const memoryCoverage = coverage?.memory as { omitted?: number } | undefined;
  const renderItem = (item: WorkflowContextItem, preference: boolean) => <li key={item.id} data-status={item.status}>
    <span>{item.text}</span><small>{item.status === "inactive" ? "已停用" : item.origin === "inferred" ? "推断偏好" : item.origin === "explicit" ? "明确提出" : "来源未标注"}{item.scope === "branch" ? " · 分支范围" : " · 整个项目"}</small>
    {preference && item.status !== "inactive" ? <small>{item.scope === "branch" ? context?.scopedMemory?.find((entry) => entry.id === item.id)?.applicable === true ? "当前焦点适用" : "当前焦点不适用" : "各会话均适用"}</small> : null}
    {item.sourceQuote ? <blockquote>{item.sourceQuote}</blockquote> : null}
    {item.sourceMessageId ? <small>来源：项目对话</small> : null}
    {item.scope === "branch" ? <small>作用分支：{(item.branchNodeIds ?? []).map((id) => graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点").join("、") || "来源未标注"}</small> : null}
    {[...new Set([...(item.sourceNodeIds ?? []), ...(item.branchNodeIds ?? [])])].map((id) => <button disabled={!graph.nodes.some((node) => node.id === id)} key={id} onClick={() => onLocate(id)} type="button">定位 {graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"}</button>)}
    {preference && item.status !== "inactive" ? <button disabled={saving} onClick={() => void onUpdate({ disabledPreferenceIds: [item.id] })} type="button">停用这条偏好</button> : null}
    {item.status !== "inactive" ? <button disabled={saving} onClick={() => { setEditingItem(item.id); setItemText(item.text); setItemScope(item.scope ?? "project"); }} type="button">{preference ? "更正这条偏好" : "更正这条要求"}</button> : null}
    {item.origin === "inferred" && item.status !== "inactive" ? <button disabled={saving} onClick={() => void onUpdate({ updatedItems: [{ id: item.id, confirm: true }] })} type="button">确认这条理解</button> : null}
    {editingItem === item.id ? <form className={styles.proposalEditor} onSubmit={(event) => { event.preventDefault(); void onUpdate({ updatedItems: [{ id: item.id, text: itemText.trim(), scope: itemScope, confirm: true }] }).then((saved) => { if (saved) setEditingItem(null); }); }}><label>更正内容<textarea aria-label="更正内容" maxLength={600} rows={2} value={itemText} onChange={(event) => setItemText(event.target.value)} /></label><label>作用范围<select aria-label="作用范围" value={itemScope} onChange={(event) => setItemScope(event.target.value as "project" | "branch")}><option value="project">整个项目</option><option disabled={!item.branchNodeIds?.length} value="branch">原分支</option></select></label><button disabled={saving || !itemText.trim()} type="submit">保存更正</button><button onClick={() => setEditingItem(null)} type="button">取消更正</button></form> : null}
  </li>;
  return <details aria-label="设计上下文" className={styles.designContext}>
    <summary><span>设计上下文</span><small>{context?.currentObjective || (error ? "读取失败" : "项目目标与当前焦点")}</small></summary>
    <div className={styles.contextContents}>
      {error ? <p role="alert">{error}<button onClick={onRetry} type="button">重新读取</button></p> : !context ? <p>开始设计对话后，查看项目目标、焦点与实际使用的参考。</p> : <>
        <section><h3>项目目标</h3>{editingGoal ? <form onSubmit={(event) => { event.preventDefault(); if (goalDraft.trim()) void onUpdate({ currentObjective: goalDraft.trim() }).then((saved) => { if (saved) setEditingGoal(false); }); }}><textarea aria-label="更正项目目标" maxLength={4000} onChange={(event) => setGoalDraft(event.target.value)} rows={3} value={goalDraft} /><button disabled={saving || !goalDraft.trim()} type="submit">保存目标</button><button onClick={() => setEditingGoal(false)} type="button">取消</button></form> : <><p>{context.currentObjective || "尚未明确项目目标"}</p><button disabled={saving} onClick={() => { setGoalDraft(context.currentObjective ?? ""); setEditingGoal(true); }} type="button">更正项目目标</button></>}</section>
        <section><h3>当前任务</h3><p>{context.currentTask || "尚未确定下一步任务"}</p></section>
        <section><h3>当前焦点</h3>{focus.length ? <>{focus.map((id) => <button disabled={!graph.nodes.some((node) => node.id === id)} key={id} onClick={() => onLocate(id)} type="button">{graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"}</button>)}<button disabled={saving} onClick={() => void onUpdate({ focusNodeIds: [] })} type="button">清除焦点</button></> : <p>整个项目</p>}{selected && !focus.includes(selected.id) ? <button disabled={saving} onClick={() => void onUpdate({ focusNodeIds: [selected.id] })} type="button">将「{displayNodeTitle(selected)}」设为焦点</button> : null}<small>查看节点不会改变助手焦点。</small></section>
        <section><h3>已确认要求</h3>{requirements.length ? <ul>{requirements.map((item) => renderItem(item, false))}</ul> : <p>暂无已记录要求</p>}</section>
        <section><h3>项目偏好记录</h3><small>各会话共享记录；仅有效且适用于当前范围的偏好参与本轮规划。</small>{preferences.length ? <ul>{preferences.map((item) => renderItem(item, true))}</ul> : <p>暂无已记录偏好</p>}</section>
        <section><h3>图片理解覆盖</h3>{context.visualCoverage ? <><p>共 {context.visualCoverage.total} 张 · 已理解 {context.visualCoverage.ready} · 处理中 {context.visualCoverage.pending} · 失败 {context.visualCoverage.failed}</p><small>本次读取原图 {context.visualCoverage.attachedNodeIds.length} 张</small></> : <p>覆盖信息暂不可用</p>}</section>
        <section><h3>上下文来源</h3>{sources.length ? <ul>{sources.map((source) => <li key={source.id}><button disabled={!graph.nodes.some((node) => node.id === source.id)} onClick={() => onLocate(source.id)} type="button">定位 {source.title}</button>{source.reason ? <small>{source.reason}</small> : null}</li>)}</ul> : <p>本轮未记录节点来源</p>}</section>
        {coverage ? <section><h3>读取范围</h3>{typeof coverage.note === "string" ? <p>{coverage.note}</p> : null}{typeof attemptCoverage?.omitted === "number" && attemptCoverage.omitted > 0 ? <small>另有 {attemptCoverage.omitted} 条执行历史未载入本轮详情。</small> : null}{typeof memoryCoverage?.omitted === "number" && memoryCoverage.omitted > 0 ? <small>另有 {memoryCoverage.omitted} 条项目记忆未载入本轮详情。</small> : null}</section> : null}
      </>}
    </div>
  </details>;
}
