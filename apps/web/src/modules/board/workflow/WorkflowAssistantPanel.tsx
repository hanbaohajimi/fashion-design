"use client";

import { Select } from "../../../components/ui";
import { AssistantMentionInput } from "./AssistantMentionInput";
import { AssistantStarters } from "./AssistantStarters";
import { AssistantDelegationsPanel } from "./AssistantDelegationsPanel";
import { AssistantReferencePreview, referenceLabel, referenceTypeLabel } from "./AssistantReferencePreview";
import { Button, Notice, Skeleton, Menu } from "../../../components/ui";
import { StreamingReply, useAssistantStream, assistantPhaseLabel } from "../../../components/StreamingReply";
import type { AssistantStreamEvent } from "@fashion/shared";
import prose from "../../../components/reading.module.css";
import { useConversationViewport } from "../../../components/use-conversation-viewport";
import { useDraftScope, usePersistentDraft } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { useAssistantImageUploads } from "./use-assistant-image-uploads";
import { AssistantImageUploadTray } from "./AssistantImageUploadTray";
import { AssistantReferenceViewer, type ReferencePlacementActions } from "./AssistantReferenceViewer";
import { AssistantResultGallery } from "./AssistantResultGallery";
import { AssistantResultViewer } from "./AssistantResultViewer";
import { AssistantExecutionStatus } from "./AssistantExecutionStatus";
import { WorkspaceIcon } from "./WorkspaceIcon";
import {
  BUILT_IN_ASSISTANT_SKILLS,
  mergeAssistantSkills,
  readAssistantSkills,
  writeAssistantSkills,
  type AssistantSkill,
} from "./assistant-skills";
import {
  fetchAssistantSkills,
} from "./assistant-skills-api";
import { resultImageNode } from "./assistant-result-data";
import { workflowExecutionResultSchema, workflowExecutionProgressSchema, type WorkflowResultImage } from "@fashion/shared";
import type { AssistantImageImportResult } from "./assistant-image-uploads";
import uploadStyles from "./assistant-image-uploads.module.css";
import { userFacingError } from "../../../components/user-facing-error";
import { useSerialPolling } from "../../use-serial-polling";
import { useAuth } from "../../auth/AuthProvider";
import type { ChatActivity } from "../../assistant-character/project-activity";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
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
import { mergeMessages, executionObservationKey } from "./conversation-messages";
import {
  appendDraftReferences,
  retainReferenceInstances,
  resolveDraftReferences,
  removeReferenceMentions,
  type CanvasReferenceSelection,
  type ReferenceInstances,
} from "./discussion-references";
import ui from "./assistant-context.module.css";
import { ProposalReview } from "./ProposalReview";
import { acceptAndExecuteProposal } from "./proposal-execution";
import { AgentWorkflowPanel } from "../agent/AgentWorkflowPanel";
import {
  createAgentConversation,
  cancelAssistantReply,
  fetchWorkflowConversationContext,
  listAgentConversations,
  getAgentConversation,
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

export interface WorkflowAssistantDraftRequest {
  readonly nonce: number;
  readonly prompt: string;
  readonly nodeIds?: readonly string[];
  readonly notice?: string;
  readonly focusInput?: boolean;
  readonly onConsumed?: () => void;
}

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
    readonly nodeId?: string;
    readonly nodeIds?: string[];
    readonly nonce: number;
    readonly instances?: ReferenceInstances;
    readonly conversationId?: string | null;
    readonly notice?: string;
    readonly onConsumed?: () => void;
  } | null;
  readonly referencesPreparing?: boolean;
  readonly onBeforeSend?: (ids: readonly string[], instances: ReferenceInstances) => Promise<CanvasReferenceSelection>;
  readonly directExecution?: boolean;
  readonly onExecution?: () => void;
  readonly canUploadReferences?: boolean;
  readonly onPrepareImageImport?: (signal: AbortSignal) => Promise<void>;
  readonly onImageImported?: (result: AssistantImageImportResult, signal: AbortSignal) => Promise<void>;
  readonly referencePlacement?: ReferencePlacementActions;
  readonly onOpenGeneratedFiles?: () => void;
  readonly renderLegacyRuns: (conversationId: string) => ReactNode;
  readonly onConversationChange?: (conversationId: string | null) => void;
  readonly onActivityChange?: (activity: ChatActivity) => void;
  readonly starterPrompt?: string | null;
  readonly assistantDraftRequest?: WorkflowAssistantDraftRequest | null;
}

type ConversationDraft = {
  prompt: string;
  referencedIds: readonly string[];
  adjustment: WorkflowProposal | null;
  referenceInstances?: ReferenceInstances;
};
type LocalSubmission = { conversationId: string; clientRequestId: string; content: string; phase: "sending" | "uncertain" };
const messageDisplayKey = (conversationId: string, message: Pick<WorkflowMessageView, "role" | "clientRequestId" | "id">) =>
  message.role === "user" && message.clientRequestId ? `request:${conversationId}:${message.clientRequestId}` : message.id;

function readPersonalSkills(accountId: string): AssistantSkill[] {
  if (typeof window === "undefined" || !accountId) return [];
  try {
    return readAssistantSkills(window.localStorage, accountId);
  } catch {
    return [];
  }
}

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
  onActivityChange,
  starterPrompt = null,
  onOpenResult,
  onAddMaterial,
  focusRequest = 0,
  referenceRequest,
  referencesPreparing = false,
  onBeforeSend,
  directExecution: _directExecution = false,
  onExecution,
  canUploadReferences = false,
  onPrepareImageImport,
  onImageImported,
  referencePlacement,
  onOpenGeneratedFiles,
  assistantDraftRequest = null,
}: Props) {
  const inputId = useId();
  const { session } = useAuth();
  const draftScope = useDraftScope();
  const imageInput = useRef<HTMLInputElement>(null);
  const [imagesDragging, setImagesDragging] = useState(false);
  const [previewReferenceId, setPreviewReferenceId] = useState<string | null>(null);
  const [resultPreview, setResultPreview] = useState<{ images: readonly WorkflowResultImage[]; compare: boolean } | null>(null);
  const draftStore = useRef(new Map<string, ConversationDraft>());
  const [conversations, setConversations] = useState<
    readonly WorkflowConversationSummary[]
  >([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<readonly WorkflowMessageView[]>([]);
  const streaming = useAssistantStream(conversationId);
  const receiveStream = (targetId: string, event: AssistantStreamEvent) => {
    if (activeId.current !== targetId) return;
    streaming.receive(event);
    if (event.type === "accepted") setSending(false);
    if ("turn" in event) {
      const turn = event.turn as unknown as { userMessage: WorkflowMessageView; assistantMessage: WorkflowMessageView };
      setMessages((current) => mergeMessages(current, [turn.userMessage, turn.assistantMessage]));
    }
  };
  const [localSubmission, setLocalSubmission] = useState<LocalSubmission | null>(null);
  const acknowledgedRequests = useRef(new Set<string>());
  const freshMessages = useRef(new Set<string>());
  const { conversationView, composerSurface, followMessages, followedConversation, newMessages, awayFromLatest, setNewMessages, stopScroll, scrollToLatest, preserveReading, viewportProps } = useConversationViewport(`${session?.user.id ?? "guest"}:${projectId}:${conversationId}`);
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const messagePages = useRef(new Map<string, { messages: readonly WorkflowMessageView[]; cursor: string | null }>());
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [conversationPageLoading, setConversationPageLoading] = useState(false);
  const [conversationPageError, setConversationPageError] = useState<string | null>(null);
  const conversationPageRequest = useRef<AbortController | null>(null);
  const conversationResolution = useRef<AbortController | null>(null);
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
  const focusedRequest = useRef(0);
  const [agentVersion, setAgentVersion] = useState<1 | 2>(2);
  const [contextError, setContextError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [referencedIds, setReferencedIds] = useState<readonly string[]>([]);
  const [referenceInstances, setReferenceInstances] = useState<ReferenceInstances>({});
  const draftInstances = useMemo(() => retainReferenceInstances(referenceInstances, referencedIds), [referenceInstances, referencedIds]);
  const instanceDraft = Object.keys(draftInstances).length ? { referenceInstances: draftInstances } : {};
  useEffect(() => {
    setReferenceInstances(current => Object.keys(current).every(id => referencedIds.includes(id)) ? current : retainReferenceInstances(current, referencedIds));
  }, [referencedIds]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const sendFlight = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultIndexOpen, setResultIndexOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
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
  const [workflowPlannerOpen, setWorkflowPlannerOpen] = useState(false);
  const accountId = session?.user.id ?? "";
  const [skillState, setSkillState] = useState<{
    readonly accountId: string;
    readonly projectId: string;
    readonly items: readonly AssistantSkill[];
  }>(() => {
    if (typeof window === "undefined" || !accountId) {
      return { accountId, projectId, items: [] };
    }
    return {
      accountId,
      projectId,
      items: readPersonalSkills(accountId),
    };
  });
  const [delegationsOpen, setDelegationsOpen] = useState(false);
  const personalSkills = useMemo(() => {
    if (skillState.accountId === accountId && skillState.projectId === projectId) return skillState.items;
    return readPersonalSkills(accountId);
  }, [accountId, projectId, skillState]);
  useEffect(() => {
    if (!accountId || skillState.accountId !== accountId || skillState.projectId !== projectId) return;
    try { writeAssistantSkills(window.localStorage, accountId, skillState.items); } catch { /* Storage is optional. */ }
  }, [accountId, projectId, skillState]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    let active = true;
    void fetchAssistantSkills(projectId, controller.signal)
      .then((remote) => {
        if (!active) return;
        setSkillState(current => ({
          accountId, projectId,
          items: mergeAssistantSkills(remote, current.accountId === accountId && current.projectId === projectId ? current.items : readPersonalSkills(accountId)),
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, projectId]);
  const applyAssistantSkill = useCallback(
    (skill: AssistantSkill) => {
      setPrompt(skill.prompt);
      setReferencedIds([]);
      setReferenceInstances({});
      setDraftNotice(`已载入”${skill.name}”，发送前可以继续修改。`);
      requestAnimationFrame(() => composerInput.current?.focus({ preventScroll: true }));
    },
    [],
  );
  const activeId = useRef(conversationId);
  const starterPromptPending = useRef(Boolean(starterPrompt));
  const initializedMessages = useRef("");
  const messageEpoch = useRef(0);
  const contextEpoch = useRef(0);
  const requestIds = useRef(new Map<string, string>());
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
  }, [conversationView]);
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
  const waitingForConfirmation = !collaborationReadOnly && messages.some(message => message.proposal?.status === "pending");
  const activityPhase: ChatActivity["phase"] = legacy ? "idle"
    : sending || submittingProposal ? "sending"
    : localSubmission?.conversationId === conversationId && localSubmission.phase === "uncertain" ? "uncertain"
    : waitingForConfirmation ? "awaiting_confirmation"
    : pendingReply ? "replying" : "idle";
  useEffect(() => {
    onActivityChange?.({ conversationId: legacy || !conversationId ? null : conversationId, phase: activityPhase });
  }, [activityPhase, conversationId, legacy, onActivityChange]);
  useEffect(() => {
    draftStore.current.set(`${projectId}:${conversationId}`, {
      prompt,
      referencedIds,
      adjustment,
      ...(Object.keys(draftInstances).length ? { referenceInstances: draftInstances } : {}),
    });
  }, [projectId, conversationId, prompt, referencedIds, adjustment, draftInstances]);
  const localDraft = usePersistentDraft<ConversationDraft>({
    value: { prompt, referencedIds, adjustment, ...instanceDraft },
    baseline: JSON.stringify({ prompt: "", referencedIds: [], adjustment: null }),
    objectKey: `assistant:${conversationId || "new"}`,
    enabled: !loading,
    restore: (draft) => { setPrompt(draft.prompt); setReferencedIds(draft.referencedIds); setAdjustment(draft.adjustment); setReferenceInstances(draft.referenceInstances ?? {}); },
  });
  const uploadEnabled = canUploadReferences && Boolean(onPrepareImageImport && onImageImported) && !collaborationReadOnly && !loading && localDraft.ready && !sending && !contextSaving;
  const assistantReferenceNodes = useMemo(() => graph.nodes.filter(node => node.type !== "media"), [graph.nodes]);
  const uploads = useAssistantImageUploads({ accountId: session?.user.id ?? "", projectId, editor: draftScope?.editor ?? "workspace", conversationId }, {
    enabled: uploadEnabled,
    slots: MAX_ASSISTANT_REFERENCES - resolveDraftReferences(assistantReferenceNodes, prompt, referencedIds.filter(id => assistantReferenceNodes.some(node => node.id === id))).ids.length,
    checkpointDraft: () => localDraft.checkpoint({ prompt, referencedIds, adjustment, ...instanceDraft }, JSON.stringify({ prompt: "", referencedIds: [], adjustment: null })),
    beforeImport: async signal => {
      if (!onPrepareImageImport) throw new Error("当前白板尚未准备好，请稍后继续。");
      return onPrepareImageImport(signal);
    },
    apply: async (result, signal) => {
      if (!onImageImported) throw new Error("当前白板尚未准备好，请稍后继续。");
      await onImageImported(result, signal);
    },
    reference: async (result, signal) => {
      signal.throwIfAborted();
      if (!uploadEnabled) throw new Error("当前对话暂时不可添加引用，图片已加入项目。请稍后继续添加。");
      const next = appendDraftReferences(result.graph.nodes.filter(node => node.type !== "media"), prompt, referencedIds.filter(id => graph.nodes.some(node => node.id === id && node.type !== "media")), [result.nodeId]);
      if (next.error) throw new Error(next.error);
      const shapes = result.canvas.bindings.filter(binding => binding.nodeId === result.nodeId && !binding.removed).map(binding => binding.shapeId);
      const instances = { ...draftInstances, ...(shapes.length ? { [result.nodeId]: shapes } : {}) };
      setReferencedIds(next.ids); setReferenceInstances(instances);
      await localDraft.checkpoint({ prompt, referencedIds: next.ids, adjustment, ...(Object.keys(instances).length ? { referenceInstances: instances } : {}) }, JSON.stringify({ prompt: "", referencedIds: [], adjustment: null }));
      signal.throwIfAborted();
      if (draftScope) {
        const saved = await draftRepository.read<ConversationDraft>(JSON.stringify([draftScope.accountId, projectId, draftScope.editor, `assistant:${conversationId || "new"}`]));
        signal.throwIfAborted();
        if (!saved?.value.referencedIds.includes(result.nodeId)) throw new Error("图片已加入项目，引用暂未保存。请核对本机草稿后继续添加。");
      }
      onError(null);
    },
  });
  const imagesPending = Boolean(session?.user.id) && !uploads.ready || uploads.items.length > 0 || Boolean(uploads.error);
  useEffect(() => {
    const reset = () => setImagesDragging(false);
    window.addEventListener("dragend", reset); window.addEventListener("blur", reset);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("blur", reset); };
  }, []);
  useEffect(() => {
    if (!loading && localDraft.ready && focusRequest && focusedRequest.current !== focusRequest) {
      composerInput.current?.focus({ preventScroll: true });
      focusedRequest.current = focusRequest;
    }
  }, [focusRequest, loading, localDraft.ready]);
  const addReferences = useCallback(
    (incoming: readonly string[], focusInput: boolean, instances: ReferenceInstances = {}) => {
      if (collaborationReadOnly) {
        onError("请先打开可编辑的设计对话再引用素材。");
        return false;
      }
      if (sending || contextSaving) {
        onError("正在提交当前内容，请完成后再添加引用。");
        return false;
      }
      const mediaIds = incoming.filter(id => graph.nodes.some(node => node.id === id && node.type === "media"));
      if (mediaIds.length) {
        onError("视频和音频可在白板播放，但当前助手与图片生成暂不支持分析媒体内容；请回到服装秀来源查看原文件。");
        return false;
      }
      const result = appendDraftReferences(graph.nodes.filter(node => node.type !== "media"), prompt, referencedIds.filter(id => graph.nodes.some(node => node.id === id && node.type !== "media")), incoming.filter(id => graph.nodes.some(node => node.id === id && node.type !== "media")));
      if (result.error) { onError(result.error); return false; }
      if (result.ids.length + uploads.items.length > MAX_ASSISTANT_REFERENCES) { onError("还在准备的图片也占用引用名额，请先完成或移除部分附件。"); return false; }
      setReferencedIds(result.ids);
      setReferenceInstances(current => {
        const merged = { ...retainReferenceInstances(current, referencedIds) };
        for (const [id, shapes] of Object.entries(instances)) merged[id] = [...new Set([...(merged[id] ?? []), ...shapes])];
        return merged;
      });
      onError(null);
      if (focusInput) composerInput.current?.focus({ preventScroll: true });
      return true;
    },
    [collaborationReadOnly, contextSaving, graph.nodes, onError, prompt, referencedIds, sending, uploads.items.length],
  );
  const addReference = useCallback((id: string) => addReferences([id], true), [addReferences]);
  const consumedReference = useRef<unknown>(null);
  const consumedAssistantDraft = useRef<number | null>(null);
  useEffect(() => {
    if (referenceRequest && consumedReference.current !== referenceRequest && referenceRequest.conversationId !== undefined && referenceRequest.conversationId !== (conversationId || null)) {
      consumedReference.current = referenceRequest;
      referenceRequest.onConsumed?.();
      onError("对话已切换，请在当前对话重新引用素材。");
      return;
    }
    if (
      !referenceRequest ||
      loading ||
      !localDraft.ready ||
      consumedReference.current === referenceRequest
    )
      return;
    consumedReference.current = referenceRequest;
    const ids = referenceRequest.nodeIds ?? (referenceRequest.nodeId ? [referenceRequest.nodeId] : []);
    if (ids.length) addReferences(ids, false, referenceRequest.instances);
    if (referenceRequest.notice) setDraftNotice(referenceRequest.notice);
    referenceRequest.onConsumed?.();
  }, [addReferences, conversationId, loading, localDraft.ready, onError, referenceRequest]);
  useEffect(() => {
    const request = assistantDraftRequest;
    if (
      !request ||
      loading ||
      !localDraft.ready ||
      consumedAssistantDraft.current === request.nonce ||
      sending ||
      contextSaving
    )
      return;
    consumedAssistantDraft.current = request.nonce;
    if (collaborationReadOnly) {
      onError("当前对话不可编辑，请先新建设计对话再整理修订意见。");
      request.onConsumed?.();
      return;
    }
    const references = appendDraftReferences(
      graph.nodes,
      prompt,
      referencedIds,
      request.nodeIds ?? [],
    );
    if (references.error) {
      onError(references.error);
      request.onConsumed?.();
      return;
    }
    const nextPrompt = prompt.trim()
      ? `${prompt.trim()}\n\n${request.prompt.trim()}`
      : request.prompt.trim();
    if (!nextPrompt) {
      onError("修订意见为空，请先选择至少一条图片意见。");
      request.onConsumed?.();
      return;
    }
    if (nextPrompt.length > MAX_AGENT_MESSAGE_LENGTH) {
      onError("当前对话草稿已接近输入上限，请先精简原有内容，再整理修订意见。");
      request.onConsumed?.();
      return;
    }
    const nextInstances = retainReferenceInstances(draftInstances, references.ids);
    setPrompt(nextPrompt);
    setReferencedIds(references.ids);
    setReferenceInstances(nextInstances);
    setDraftNotice(request.notice ?? "已保存图片意见并准备修订计划；核对后再发送给设计助手。");
    void localDraft
      .checkpoint(
        {
          prompt: nextPrompt,
          referencedIds: references.ids,
          adjustment,
          ...(Object.keys(nextInstances).length
            ? { referenceInstances: nextInstances }
            : {}),
        },
        JSON.stringify({ prompt: "", referencedIds: [], adjustment: null }),
      )
      .catch(() => setDraftNotice("修订计划已准备，但本机暂存失败；请在离开前核对草稿。"));
    onError(null);
    if (request.focusInput !== false)
      requestAnimationFrame(() => composerInput.current?.focus({ preventScroll: true }));
    request.onConsumed?.();
  }, [
    adjustment,
    assistantDraftRequest,
    collaborationReadOnly,
    contextSaving,
    draftInstances,
    graph.nodes,
    loading,
    localDraft,
    onError,
    prompt,
    referencedIds,
    sending,
  ]);
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
      if (id && activeId.current === id && initializedMessages.current === id) {
        setLoading(false);
        setConversationError(null);
        return;
      }
      const draft = draftStore.current.get(`${projectId}:${id}`);
      const cached = messagePages.current.get(id);
      const seedStarter = Boolean(
        starterPromptPending.current &&
          starterPrompt &&
          !draft &&
          !(cached?.messages.length),
      );
      starterPromptPending.current = false;
      conversationResolution.current?.abort();
      olderRequest.current?.abort();
      olderRequest.current = null;
      messageEpoch.current++;
      setNewMessages(false);
      initializedMessages.current = cached ? id : "";
      contextEpoch.current += 1;
      activeId.current = id;
      const url = new URL(window.location.href);
      if (id && url.searchParams.has("conversationId") && url.searchParams.get("conversationId") !== id) {
        url.searchParams.set("conversationId", id);
        window.history.replaceState(window.history.state, "", url);
      }
      freshMessages.current.clear();
      setConversationId(id);
      setMessages(cached?.messages ?? []);
      setCursor(cached?.cursor ?? null);
      setOlderLoading(false);
      setOlderError(null);
      setContext(null);
      setAdjustment(draft?.adjustment ?? null);
      setContextError(null);
      setReferencedIds(draft?.referencedIds ?? []);
      setReferenceInstances(draft?.referenceInstances ?? {});
      setPrompt(draft?.prompt ?? (seedStarter ? starterPrompt ?? "" : ""));
      setDraftNotice(
        seedStarter
          ? "已根据你的创作方向准备一份未发送的设计需求，可以先修改再发送。"
          : draft &&
          (draft.prompt || draft.referencedIds.length || draft.adjustment)
          ? "已恢复此对话的未发送草稿，请核对后发送。草稿保留在本机。"
          : null,
      );
      setPickerOpen(false);
      setLegacyMessageError(null);
      setConversationError(null);
      setRequirementsOpen(false);
      setPreviewReferenceId(null);
      setResultPreview(null);
      setCorrectionError(null);
      setLoading(Boolean(id) && !cached);
      onProposal(null);
    },
    [onProposal, projectId, setNewMessages, starterPrompt],
  );

  useEffect(() => {
    const activate = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      conversationResolution.current?.abort();
      const controller = new AbortController();
      conversationResolution.current = controller;
      void getAgentConversation(projectId, id, controller.signal).then(item => {
        if (controller.signal.aborted) return;
        setConversations(current => current.some(entry => entry.id === item.id) ? current.map(entry => entry.id === item.id ? item : entry) : [item, ...current]);
        activateConversation(item.id);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) onError(userFacingError(error, "这段对话读取失败，请从历史对话重新选择。"));
      });
    };
    window.addEventListener("fashion-workflow:conversation", activate);
    return () =>
      window.removeEventListener("fashion-workflow:conversation", activate);
  }, [activateConversation, onError, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    conversationResolution.current?.abort();
    conversationResolution.current = controller;
    conversationPageRequest.current?.abort();
    conversationPageRequest.current = null;
    setConversationPageLoading(false);
    setConversationPageError(null);
    setConversationError(null);
    setLoading(true);
    void listAgentConversations(projectId, undefined, controller.signal)
      .then(async (page) => {
        if (controller.signal.aborted) return;
        setConversations(page.items);
        setConversationCursor(page.nextCursor);
        const linkedId = new URLSearchParams(window.location.search).get("conversationId");
        const target = linkedId ? page.items.find(item => item.id === linkedId) ?? await getAgentConversation(projectId, linkedId, controller.signal)
          : page.items.find(item => item.mode === "workflow");
        if (controller.signal.aborted) return;
        if (target && !page.items.some(item => item.id === target.id)) setConversations(current => [target, ...current]);
        activateConversation(target?.id ?? "");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setConversationError(
            userFacingError(error, "历史对话读取失败，请重试。"),
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      conversationPageRequest.current?.abort();
    };
  }, [activateConversation, projectId, conversationReload]);

  const loadConversations = async () => {
    if (!conversationCursor || conversationPageRequest.current) return;
    const requestedCursor = conversationCursor;
    const controller = new AbortController();
    conversationPageRequest.current = controller;
    setConversationPageLoading(true);
    setConversationPageError(null);
    try {
      const page = await listAgentConversations(projectId, requestedCursor, controller.signal);
      if (controller.signal.aborted) return;
      setConversations(current => {
        const seen = new Set(current.map(item => item.id));
        const added = page.items.filter(item => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return [...current, ...added];
      });
      setConversationCursor(page.nextCursor === requestedCursor ? null : page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted) setConversationPageError(userFacingError(error, "较早对话读取失败，请重试。"));
    } finally {
      if (conversationPageRequest.current === controller) {
        conversationPageRequest.current = null;
        setConversationPageLoading(false);
      }
    }
  };

  useEffect(() => () => {
    conversationResolution.current?.abort();
    olderRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (!conversationId || loading || initializedMessages.current !== conversationId) return;
    messagePages.current.delete(conversationId);
    messagePages.current.set(conversationId, { messages, cursor });
    const oldest = messagePages.current.keys().next().value;
    if (messagePages.current.size > 8 && oldest) messagePages.current.delete(oldest);
  }, [conversationId, cursor, loading, messages]);

  const loadOlderMessages = async () => {
    if (!cursor || olderRequest.current) return;
    const targetId = conversationId;
    const epoch = messageEpoch.current;
    const requestedCursor = cursor;
    const controller = new AbortController();
    olderRequest.current = controller;
    preserveReading();
    setOlderLoading(true);
    setOlderError(null);
    const current = () => !controller.signal.aborted && activeId.current === targetId && messageEpoch.current === epoch;
    try {
      const page = await listWorkflowMessages(targetId, requestedCursor, controller.signal);
      if (!current()) return;
      setMessages(messages => mergeMessages(messages, page.items, true));
      setCursor(page.nextCursor === requestedCursor ? null : page.nextCursor);
    } catch (error) {
      if (current()) setOlderError(userFacingError(error, "较早消息读取失败，请重试。"));
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        if (current()) setOlderLoading(false);
      }
    }
  };

  useEffect(() => {
    let disposed = false;
    if (!conversationId || !legacy) return;
    setLoading(initializedMessages.current !== conversationId);
    setLegacyMessageError(null);
    void listWorkflowMessages(conversationId)
      .then((page) => {
        if (!disposed) {
          setMessages((current) => mergeMessages(current, page.items));
          if (initializedMessages.current !== conversationId) setCursor(page.nextCursor);
          initializedMessages.current = conversationId;
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
    ? JSON.stringify([latestMessage.id, latestMessage.status, latestMessage.content])
    : "";
  const proposalResults = useMemo(() => new Map(messages.map(message => [message.id, executionObservationKey(message)])), [messages]);
  const latestSeen = useRef({ conversationId: "", key: "", results: new Map<string, string>() });
  useEffect(() => {
    const key = `${latestMessageKey}:${localSubmission?.clientRequestId ?? ""}`;
    const previous = latestSeen.current;
    // Newly loaded historical proposals establish a baseline, just like old text.
    const resultChanged = [...proposalResults].some(([id, value]) => previous.results.has(id) && previous.results.get(id) !== value);
    const changed = previous.conversationId === conversationId && Boolean(previous.key) && (previous.key !== key || resultChanged);
    latestSeen.current = { conversationId, key: latestMessageKey ? key : "", results: proposalResults };
    if (followMessages.current && conversationView.current) {
      if (followedConversation.current !== conversationId) {
        stopScroll();
        scrollToLatest(conversationView.current, true);
        if (messages.length) followedConversation.current = conversationId;
      } else scrollToLatest(conversationView.current);
    }
    else if (changed) setNewMessages(true);
  }, [latestMessageKey, messages.length, pendingReply, proposalResults, localSubmission, scrollToLatest, conversationId, stopScroll, conversationView, followMessages, followedConversation, setNewMessages]);

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
      setReferenceInstances(draftInstances);
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

  const stopReply = async () => {
    if (stopping) return;
    const pending = messages.find(message => message.role === "assistant" && message.status === "pending" && message.origin !== "background_analysis" && message.origin !== "execution_result");
    const requestId = messages.find(message => message.id === pending?.replyToId)?.clientRequestId ?? localSubmission?.clientRequestId;
    if (!pending || !requestId || !conversationId) return;
    setStopping(true);
    try {
      const result = await cancelAssistantReply(conversationId, requestId);
      if (result.status === "canceled") {
        streaming.stop(pending.id);
        setMessages(current => current.map(message => message.id === pending.id ? { ...message, status: "canceled", content: streaming.drafts[pending.id]?.text ?? message.content } : message));
      }
      messageSync.retry();
    } catch (cause) { onError(cause instanceof Error ? cause.message : "停止结果尚未确认"); messageSync.retry(); }
    finally { setStopping(false); }
  };

  const send = async () => {
    const content = prompt.trim();
    if (
      !content ||
      sendFlight.current ||
      sending ||
      referencesPreparing ||
      imagesPending ||
      uploads.queue.snapshot().items.length > 0 || Boolean(uploads.queue.snapshot().error) ||
      !localDraft.ready ||
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
      const references = resolveDraftReferences(
        assistantReferenceNodes,
      content,
      referencedIds,
    );
    let refs = references.ids;
    const referenceError = references.error;
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
    sendFlight.current = true;
    setSending(true);
    // Reuse only an identical request payload below. The same words can refer
    // to a different garment, focus, or proposal on the next send.
    const proposedRequestId = crypto.randomUUID();
    let attemptedRequestId = proposedRequestId;
    setLocalSubmission({ conversationId, clientRequestId: proposedRequestId, content, phase: "sending" });
    onError(null);
    try {
      const prepared = await onBeforeSend?.(refs, draftInstances);
      if (prepared && JSON.stringify(prepared.nodeIds) !== JSON.stringify(refs)) {
        // A consumed canvas material can fork when edited. Surface its new
        // identity before sending, instead of silently changing the preview.
        setReferencedIds(prepared.nodeIds);
        setReferenceInstances(prepared.instances);
        setPrompt(current => removeReferenceMentions(current, assistantReferenceNodes, refs.filter(id => !prepared.nodeIds.includes(id))));
        setLocalSubmission(null);
        onError("引用素材已更新，预览已同步。请核对后再次发送。");
        return;
      }
      refs = prepared?.nodeIds ?? refs;
      if (refs.length > MAX_ASSISTANT_REFERENCES)
        throw new Error("素材副本变更后超过 16 项，请重新核对引用再发送。");
      const submittedDraft = { prompt, referencedIds, adjustment, ...instanceDraft };
      const acknowledgeDraft = await localDraft.captureAcknowledgement(submittedDraft);
      const targetId = conversationId || (await createConversation(true));
      const focus = refs.length ? refs : (context?.focusNodeIds ?? []).filter(id => graph.nodes.some(node => node.id === id && node.type !== "media"));
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
      let draftAcceptance: Promise<void> | null = null;
      const acceptDraft = () => {
        if (draftAcceptance) return draftAcceptance;
        if (JSON.stringify(draftStore.current.get(`${projectId}:${targetId}`)) === JSON.stringify(submittedDraft))
          draftStore.current.delete(`${projectId}:${targetId}`);
        if (activeId.current === targetId) {
          setPrompt(current => current === prompt ? "" : current);
          setAdjustment(current => current?.id === adjustment?.id ? null : current);
          setReferencedIds(current => JSON.stringify(current) === JSON.stringify(referencedIds) ? [] : current);
          setDraftNotice(null);
        }
        draftAcceptance = acknowledgeDraft();
        return draftAcceptance;
      };
      const turn = await sendWorkflowMessage(targetId, {
        clientRequestId: requestId,
        content,
        referencedNodeIds: refs,
        focusNodeIds: focus,
        ...(adjustment ? { respondingToProposalId: adjustment.id } : {}),
      }, (event) => { receiveStream(targetId, event); if ("turn" in event) void acceptDraft(); }, streaming.signalFor(targetId));
      await acceptDraft();
      if (turn.assistantMessage.context?.executionReceipt) onExecution?.();
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
      reloadContextAfterTurn(targetId);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setLocalSubmission((current) => current ? { ...current, phase: "uncertain" } : current);
      if (!acknowledgedRequests.current.has(attemptedRequestId)) onError(error instanceof Error ? error.message : "发送结果尚未确认，请重试");
    } finally {
      sendFlight.current = false;
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

  const retryPackets = useRef(new Map<string, string>());
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
    if (sendFlight.current) return;
    sendFlight.current = true;
    setSending(true);
    onError(null);
    const targetId = conversationId;
    const retryId = retryPackets.current.get(assistant.id) ?? crypto.randomUUID();
    retryPackets.current.set(assistant.id, retryId);
    try {
      const turn = await sendWorkflowMessage(targetId, {
        clientRequestId: retryId,
        content: user.content,
        referencedNodeIds: user.context?.referencedNodeIds ?? [],
        ...(Array.isArray(user.context?.focusNodeIds)
          ? { focusNodeIds: user.context.focusNodeIds }
          : {}),
        ...(user.context?.respondingToProposalId
          ? { respondingToProposalId: user.context.respondingToProposalId }
          : {}),
      }, (event) => receiveStream(targetId, event), streaming.signalFor(targetId));
      if (turn.assistantMessage.status !== "pending") retryPackets.current.delete(assistant.id);
      if (activeId.current === targetId) {
        setMessages((current) =>
          mergeMessages(current, [turn.userMessage, turn.assistantMessage]),
        );
        reloadContextAfterTurn(targetId);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "回复重试失败");
    } finally {
      sendFlight.current = false;
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
      messageSync.retry();
    }
  };

  const draftReferences = resolveDraftReferences(
    graph.nodes.filter(node => node.type !== "media"),
    prompt,
    referencedIds,
  );
  const missingReferenceIds = referencedIds.filter(
    (id) => !graph.nodes.some((node) => node.id === id && node.type !== "media"),
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
  const discussionIds = useMemo(
    () => draftReferences.ids.length
      ? draftReferences.ids
      : (context?.focusNodeIds ?? []).filter(id => assistantReferenceNodes.some(node => node.id === id)),
    [assistantReferenceNodes, context?.focusNodeIds, draftReferences.ids],
  );
  const plannerShapeIds = useMemo(
    () => [...new Set(discussionIds.flatMap(id => draftInstances[id] ?? []))],
    [discussionIds, draftInstances],
  );
  const plannerTaskCreated = useCallback(async () => {
    window.dispatchEvent(new Event("fashion-workflow:refresh"));
  }, []);
  const reviewableCandidates = useMemo(
    () => graph.nodes.filter(
      (node) => node.type === "candidate" && node.status !== "proposed",
    ),
    [graph.nodes],
  );
  const prepareDesignReview = useCallback(() => {
    if (collaborationReadOnly || sending || contextSaving) return;
    if (!reviewableCandidates.length) {
      onError("当前白板还没有可审阅的服装方案。先生成或放入一张方案图片，再开始审阅。");
      return;
    }
    const selectedId = selected?.type === "candidate" && selected.status !== "proposed"
      ? selected.id
      : null;
    const supportNodes = graph.nodes.filter(
      (node) => node.type === "brief" || node.type === "constraint",
    );
    const ids = [...new Set([
      ...(selectedId ? [selectedId] : []),
      ...reviewableCandidates.map((node) => node.id),
      ...supportNodes.map((node) => node.id),
    ])].slice(0, MAX_ASSISTANT_REFERENCES);
    setPrompt(
      "请审阅当前画布中的服装方案：逐项检查设计要求、廓形与细节的一致性，区分已确认事实、可观察问题和需要人工确认的推测；给出依据、风险和下一步建议，暂不生成图片。",
    );
    setReferencedIds(ids);
    setReferenceInstances({});
    setAdjustment(null);
    setDraftNotice(
      ids.length < reviewableCandidates.length
        ? `已准备设计审阅草稿，并带入 ${ids.length} 项关键上下文；可在发送前继续调整引用。`
        : `已准备设计审阅草稿，并带入 ${reviewableCandidates.length} 个方案与关键约束。`,
    );
    onError(null);
    requestAnimationFrame(() => composerInput.current?.focus({ preventScroll: true }));
  }, [collaborationReadOnly, contextSaving, graph.nodes, onError, reviewableCandidates, selected, sending]);
  const previewReference = graph.nodes.find(node => node.id === previewReferenceId && node.type === "reference_image");
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

  // Draft keystrokes must not rebuild the loaded conversation tree.
  const previewOrLocate = useCallback((id: string) => {
    if (graph.nodes.some(node => node.id === id && node.type === "reference_image")) setPreviewReferenceId(id);
    else onLocate(id);
  }, [graph.nodes, onLocate]);
  const transcriptActions = useRef({ retryMessage, decide, addReference });
  useEffect(() => { transcriptActions.current = { retryMessage, decide, addReference }; });
  const openResultImage = useCallback((image: WorkflowResultImage) => {
    const node = resultImageNode(graph, image);
    if (node) onOpenResult(node.id);
    else setResultPreview({ images: [image], compare: false });
  }, [graph, onOpenResult]);
  const continueResultImage = useCallback((image: WorkflowResultImage) => {
    const node = resultImageNode(graph, image);
    if (node) transcriptActions.current.addReference(node.id);
    else onError("这张结果已移出当前画布，请从项目生成文件放回后继续修改。");
  }, [graph, onError]);
  const retryMessageSync = messageSync.retry;
  const refreshExecution = useCallback(() => { retryMessageSync(); window.dispatchEvent(new Event("fashion-workflow:refresh")); }, [retryMessageSync]);
  const revealExecutionResult = useCallback((executionId: string) => {
    const element = conversationView.current?.querySelector<HTMLElement>(`[data-execution-results="${CSS.escape(executionId)}"]`);
    if (element) { followMessages.current = false; element.scrollIntoView({ block: "start", behavior: "auto" }); element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }
  }, [conversationView, followMessages]);
  const resultReceipts = useMemo(() => new Set(messages.flatMap(message => {
    const result = message.origin === "execution_result" ? workflowExecutionResultSchema.safeParse(message.context?.executionResult) : null;
    return result?.success && result.data.executionId === message.executionId && result.data.images.length ? [result.data.executionId] : [];
  })), [messages]);
  const resultIndex = useMemo(() => messages.flatMap((message) => {
    if (message.origin !== "execution_result" || !message.executionId) return [];
    const parsed = workflowExecutionResultSchema.safeParse(message.context?.executionResult);
    if (!parsed.success || !parsed.data.images.length) return [];
    const status = parsed.data.status === "completed"
      ? "已完成"
      : parsed.data.status === "partial_failed"
        ? "部分完成"
        : parsed.data.status === "canceled"
          ? "已取消"
          : "未完成";
    return [{
      executionId: message.executionId,
      imageCount: parsed.data.images.length,
      status,
    }];
  }), [messages]);
  const transcript = useMemo(() => ([...messages.map((message) => ({ kind: "server" as const, message })),
          ...(localSubmission && localSubmission.conversationId === conversationId && !messages.some((message) => message.role === "user" && message.clientRequestId === localSubmission.clientRequestId)
            ? [{ kind: "local" as const, submission: localSubmission }] : []),
        ]).map((row) => {
          if (row.kind === "local") return <article className={styles.workflowMessage} data-role="user" data-new="true" key={`request:${conversationId}:${row.submission.clientRequestId}`}>
            <div className={styles.userExample}>{row.submission.content}</div>
            <small role="status">{row.submission.phase === "sending" ? "正在发送…" : "发送结果尚未确认，可用下方发送按钮重试。"}</small>
          </article>;
          const message = row.message;
          const parsedResult = message.origin === "execution_result" ? workflowExecutionResultSchema.safeParse(message.context?.executionResult) : null;
          const parsedProgress = message.origin !== "execution_result" && !message.proposal ? workflowExecutionProgressSchema.safeParse(message.context?.executionProgress) : null;
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
              <span className={styles.messageKind}>结果分析 可继续输入</span>
            ) : null}
            <div
              data-revealed={message.role === "assistant" && message.status !== "pending" && freshMessages.current.has(message.id) && !streaming.drafts[message.id]}
              className={
                message.role === "user"
                  ? styles.userExample
                  : `${styles.assistantReply} ${prose.prose}`
              }
            >
              {message.role === "assistant" ? (
                <StreamingReply content={message.content} draft={streaming.drafts[message.id]} />
              ) : (
                message.content
              )}
            </div>
            {message.status === "pending" ? (
              <small role="status" className={styles.thinking}>{assistantPhaseLabel(streaming.drafts[message.id])}<span aria-hidden="true"><i /><i /><i /></span></small>
            ) : null}
            {message.status === "canceled" ? <small role="status">已停止回复，以上内容尚未完成校验。</small> : null}
            {message.error && message.status !== "canceled" ? (
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
                onClick={() => void transcriptActions.current.retryMessage(message)}
                type="button"
              >
                重试这条回复
              </button>
            ) : null}
            {message.role === "assistant" && message.status !== "pending" && message.origin !== "execution_result" && (!message.context?.executionReceipt && !message.proposal?.execution || Boolean(message.context?.referenceSummary)) ? (
              <MessageReferenceRecord
                context={message.context}
                graph={graph}
                onLocate={previewOrLocate}
              />
            ) : null}
            {parsedResult?.success && parsedResult.data.executionId === message.executionId ? <AssistantResultGallery result={parsedResult.data} graph={graph} disabled={sending || contextSaving || pendingReply || collaborationReadOnly} onOpen={openResultImage} onContinue={continueResultImage} onCompare={images => setResultPreview({ images, compare: true })} /> : null}
            {parsedProgress?.success && parsedProgress.data.executionId === message.executionId ? <AssistantExecutionStatus key={parsedProgress.data.executionId} progress={parsedProgress.data} projectId={projectId} onRefresh={refreshExecution} disabled={collaborationReadOnly} /> : null}
            {message.proposal ? (
              <ProposalReview
                proposal={message.proposal}
                projectId={projectId}
                onRefresh={refreshExecution}
                onOpenImage={openResultImage}
                onContinueImage={continueResultImage}
                onCompare={images => setResultPreview({ images, compare: true })}
                onRevealResult={message.proposal.execution?.progress && resultReceipts.has(message.proposal.execution.progress.executionId) ? () => revealExecutionResult(message.proposal?.execution?.progress?.executionId ?? "") : undefined}
                graph={graph}
                submitting={submittingProposal === message.proposal.id}
                disabled={sending || pendingReply || collaborationReadOnly}
                error={executionErrors[message.proposal.id]}
                onAccept={() => {
                  if (message.proposal) void transcriptActions.current.decide(message.proposal, "accept");
                }}
                onReject={() => {
                  if (message.proposal) void transcriptActions.current.decide(message.proposal, "reject");
                }}
                onAdjust={() => {
                  if (!message.proposal) return;
                  setAdjustment(message.proposal);
                  setReferencedIds(message.proposal.referencedNodeIds);
                  setReferenceInstances({});
                  composerInput.current?.focus({ preventScroll: true });
                }}
                onOpenResult={onOpenResult}
                onContinue={(id) => transcriptActions.current.addReference(id)}
              />
            ) : null}
          </article>
        ); }), [messages, localSubmission, conversationId, streaming.drafts, graph, legacy, sending, contextSaving, pendingReply, collaborationReadOnly, submittingProposal, executionErrors, previewOrLocate, onOpenResult, openResultImage, continueResultImage, projectId, refreshExecution, resultReceipts, revealExecutionResult]);

  return (
    <div className={styles.assistantBody}>
      <div className={ui.toolbar}>
        <strong className={ui.conversationTitle} title={active?.title || "新设计对话"}>
          {active?.title || "新设计对话"}
        </strong>
        <div className={ui.toolbarActions}>
          <Button
            size="small"
            variant="ghost"
            aria-label="新建对话"
            title="新建对话"
            disabled={loading || sending || contextSaving}
            onClick={newConversation}
          >
            <WorkspaceIcon name="new_chat" />
          </Button>
          {<Menu label="助手设置" trigger={<WorkspaceIcon name="settings" />}>
            <button type="button" onClick={() => setHistoryOpen((v) => !v)}>历史对话</button>
            {resultIndex.length ? <button type="button" onClick={() => { setResultIndexOpen((v) => !v); setHistoryOpen(false); setDelegationsOpen(false); }}>本轮结果 ({resultIndex.length})</button> : null}
            {!legacy ? <button type="button" onClick={() => setRequirementsOpen(true)}>设计要求</button> : null}
            {!legacy && BUILT_IN_ASSISTANT_SKILLS.length ? <>
              <p className={ui.menuHint} style={{marginBottom: 0}}>快速载入技能</p>
              {BUILT_IN_ASSISTANT_SKILLS.map((skill) => (
                <button key={`builtin:${skill.id}`} type="button" onClick={() => { applyAssistantSkill(skill); }}>
                  {skill.name}
                </button>
              ))}
              {personalSkills.map((skill) => (
                <button key={`personal:${skill.id}`} type="button" onClick={() => { applyAssistantSkill(skill); }}>
                  {skill.name}
                </button>
              ))}
            </> : null}
            {!legacy ? <button type="button" onClick={() => { setDelegationsOpen((v) => !v); }}>设计委托</button> : null}
            {!legacy && reviewableCandidates.length ? <button type="button" disabled={loading || sending || contextSaving} onClick={prepareDesignReview}>审阅当前方案</button> : null}
            {!legacy && conversationId ? <button type="button" disabled={loading || sending || contextSaving} onClick={() => setWorkflowPlannerOpen(true)}>分步计划</button> : null}
            {legacy ? <button onClick={() => setLegacyRunsOpen((v) => !v)} type="button">旧设计运行</button> : null}
            <button disabled={sending} onClick={toggleAgent} type="button">
              {agentVersion === 2 ? "暂停本项目设计助手" : "恢复设计助手"}
            </button>
            <p className={ui.menuHint}>设置作用于整个项目；暂停后，已有任务继续运行。</p>
          </Menu>}
        </div>
      </div>
      {historyOpen ? (
        <div className={ui.history}>
          <label htmlFor={`${inputId}-history`}>选择历史对话</label>
          <Select searchable
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
                {item.mode === "workflow" ? "" : " 只读历史"}
              </option>
            ))}
          </Select>
          <div className={ui.historyPages}>
            <small>{conversations.length ? `已载入 ${conversations.length} 条对话` : ""}</small>
            {conversationCursor ? <Button size="small" variant="ghost" disabled={conversationPageLoading} onClick={() => void loadConversations()}>
              {conversationPageLoading ? "正在读取…" : conversationPageError ? "重试读取对话" : "读取更早对话"}
            </Button> : null}
          </div>
          {conversationPageError ? <p role="alert">{conversationPageError}</p> : null}
          {!conversations.length && !loading ? (
            <small>还没有历史对话。发送第一条需求后会建立对话。</small>
          ) : null}
        </div>
      ) : null}
      {resultIndexOpen ? (
        <section className={ui.resultIndex} aria-label="本轮执行结果">
          <header className={ui.resultIndexHeader}>
            <div>
              <strong>本轮结果</strong>
              <span>直接跳到已生成的图片回执，不改变对话顺序。</span>
            </div>
            <button
              aria-label="关闭本轮结果"
              className={ui.skillsClose}
              onClick={() => setResultIndexOpen(false)}
              type="button"
            >
              <WorkspaceIcon name="close" />
            </button>
          </header>
          <div className={ui.resultIndexList}>
            {resultIndex.map((result, index) => (
              <button
                className={ui.resultIndexItem}
                key={result.executionId}
                onClick={() => {
                  setResultIndexOpen(false);
                  revealExecutionResult(result.executionId);
                }}
                type="button"
              >
                <span>
                  <strong>第 {index + 1} 次执行</strong>
                  <small>{result.status} · {result.imageCount} 张图片</small>
                </span>
                <span aria-hidden="true">跳转 ↗</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {delegationsOpen && !legacy ? (
        <AssistantDelegationsPanel
          canEdit={!collaborationReadOnly}
          conversationId={conversationId}
          onClose={() => setDelegationsOpen(false)}
          projectId={projectId}
        />
      ) : null}
      {workflowPlannerOpen && !legacy && conversationId ? (
        <details className={ui.planner} open aria-label="分步设计计划">
          <summary className={ui.plannerSummary}>
            <span>分步设计计划</span>
            <button
              className={ui.plannerClose}
              onClick={(e) => { e.preventDefault(); setWorkflowPlannerOpen(false); }}
              type="button"
            >
              返回讨论
            </button>
          </summary>
          <div className={ui.plannerBody}>
            <AgentWorkflowPanel
              conversationId={conversationId}
              contextReady={!conversationId || Boolean(context)}
              contextItems={
                <p className={ui.plannerContext}>
                  {discussionIds.length
                    ? `当前讨论引用 ${discussionIds.length} 项工作流素材。`
                    : "当前计划从整段设计目标开始，可在节点中继续补充素材。"}
                </p>
              }
              initialIntent={prompt.trim() || context?.currentObjective || "请把当前设计目标拆成可确认的执行步骤"}
              shapeIds={plannerShapeIds}
              onTaskCreated={plannerTaskCreated}
            />
          </div>
        </details>
      ) : null}
      <div className={styles.conversationViewport} hidden={workflowPlannerOpen}>
      <div
        ref={conversationView}
        {...viewportProps}
        aria-label="设计对话"
        aria-live="polite"
        tabIndex={0}
        className={styles.assistantConversation}
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
              <AssistantStarters
                disabled={collaborationReadOnly || loading || sending || contextSaving}
                hasDraft={Boolean(prompt)}
                hasReferences={draftReferences.ids.length > 0}
                hasCandidates={reviewableCandidates.length > 0}
                onChoose={value => {
                  setPrompt(value);
                  composerInput.current?.focus({ preventScroll: true });
                }}
                onReview={prepareDesignReview}
              />
            ) : null}
          </div>
        ) : null}
        {olderError ? <p role="alert">{olderError}</p> : null}
        {cursor ? (
          <button
            className={styles.historyAction}
            disabled={loading || olderLoading}
            onClick={() => void loadOlderMessages()}
            type="button"
          >
            {olderLoading ? "正在读取更早消息…" : olderError ? "重试读取消息" : "读取更早消息"}
          </button>
        ) : null}
        {transcript}
      </div>
      {newMessages || awayFromLatest ? (
        <button
          className={styles.newMessages}
          onClick={() => {
            followMessages.current = true;
            setNewMessages(false);
            if (conversationView.current) {
              scrollToLatest(conversationView.current);
              conversationView.current.focus({ preventScroll: true });
            }
          }}
          type="button"
        >
          {newMessages ? "有新消息 ↓" : "回到最新 ↓"}
        </button>
      ) : null}
      </div>
      {legacy && legacyRunsOpen ? renderLegacyRuns(conversationId) : null}
      <div
        ref={composerSurface}
        className={styles.composer}
        hidden={workflowPlannerOpen}
        data-guide="workspace-assistant"
        data-guide-variant={legacy ? "history" : agentVersion === 1 ? "paused" : "input"}
        data-assistant-image-drop
        onDragEnterCapture={event => { if (Array.from(event.dataTransfer.types).includes("Files") && uploadEnabled) setImagesDragging(true); }}
        onDragOverCapture={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = uploadEnabled ? "copy" : "none"; } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setImagesDragging(false); }}
        onDropCapture={event => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault(); event.stopPropagation(); setImagesDragging(false);
          void uploads.queue.add(Array.from(event.dataTransfer.files));
        }}
        onPasteCapture={event => {
          const files = Array.from(event.clipboardData.files); if (!files.length) return;
          event.preventDefault(); event.stopPropagation();
          const text = event.clipboardData.getData("text/plain"), input = composerInput.current;
          if (text && input && !input.disabled && event.target === input) {
            const start = input.selectionStart, end = input.selectionEnd;
            const next = prompt.slice(0, start) + text + prompt.slice(end);
            if (next.length <= MAX_AGENT_MESSAGE_LENGTH) { setPrompt(next); requestAnimationFrame(() => input.setSelectionRange(start + text.length, start + text.length)); }
            else onError("粘贴文字超出输入上限，原正文仍保留。");
          }
          void uploads.queue.add(files);
        }}
      >
        {legacy ? (
          <div className={styles.legacyReadOnly}>
            <p>
              这是只读历史。使用顶部“新建对话”继续设计，项目目标和有效偏好仍会沿用。
            </p>
          </div>
        ) : agentVersion === 1 ? (
          <div className={styles.legacyReadOnly}>
            <p>本项目设计助手已暂停。已有任务继续运行，历史消息仍可查看。</p>
          </div>
        ) : (
          <>
            <div className={styles.composerReferences} data-composer-references>
            {imagesDragging && uploadEnabled ? <p className={uploadStyles.dropHint}>松开添加参考图片</p> : null}
            <AssistantImageUploadTray ready={uploads.ready} items={uploads.items} error={uploads.error} queue={uploads.queue} disabled={!uploadEnabled} />
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
            <div className={ui.discussion} aria-label="正在讨论" data-has-references={discussionIds.length > 0}>
              {discussionIds.length > 0 ? (
                <>
                  <div className={ui.discussionReferences} data-discussion-references>
                    {discussionIds.map((id) => {
                      const node = graph.nodes.find(item => item.id === id);
                      const label = node ? referenceLabel(node, graph.nodes) : "已移除节点";
                      return (
                      <span
                        className={ui.referenceChip}
                        data-assistant-reference-id={id}
                        key={id}
                      >
                        <button
                          className={ui.referenceLocate}
                          data-reference-preview={id}
                          title={node?.type === "reference_image" ? `预览：${label}` : `在画布中定位：${label}`}
                          aria-label={label}
                          disabled={!node}
                          onClick={() => node?.type === "reference_image" ? setPreviewReferenceId(id) : onLocate(id)}
                          type="button"
                        >
            {node && node.type !== "media" ? <AssistantReferencePreview node={node} /> : null}
                          <span className={ui.referenceCaption}>
                            <span>{label}</span>
                            {node ? <small>{referenceTypeLabel(node)}</small> : null}
                          </span>
                        </button>
                        {draftReferences.ids.length ? (
                          <button
                            className={ui.removeReference}
                            disabled={sending || contextSaving}
                            aria-label={`移除引用 ${node ? label : id}`}
                            onClick={() => {
                              setReferencedIds((current) =>
                                current.filter((item) => item !== id),
                              );
                              setPrompt((value) =>
                                removeReferenceMentions(value, assistantReferenceNodes, [id]),
                              );
                            }}
                            type="button"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                      );
                    })}
                  </div>
                </>
              ) : null}
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
            </div>
            <label className={ui.fieldLabel} htmlFor={inputId}>
              描述设计需求
            </label>
            <AssistantMentionInput
              id={inputId}
              ref={composerInput}
              contextKey={`${projectId}:${conversationId}`}
              nodes={graph.nodes.filter(node => node.type !== "media")}
              referencedIds={referencedIds}
              onAddReference={addReference}
              skillChoices={[...BUILT_IN_ASSISTANT_SKILLS, ...personalSkills]}
              onApplySkill={(skill) => {
                setPrompt(skill.prompt);
                setReferencedIds([]);
                setReferenceInstances({});
                setDraftNotice(`已载入"${skill.name}"，发送前可以继续修改。`);
                requestAnimationFrame(() => composerInput.current?.focus({ preventScroll: true }));
              }}
              disabled={loading || !localDraft.ready || sending || contextSaving}
              maxLength={MAX_AGENT_MESSAGE_LENGTH}
              onValueChange={setPrompt}
              onSend={() => void send()}
              placeholder={
                adjustment
                  ? "例如：保留版型，将面料改为亚麻，生成 2 张。"
                  : "例如：设计一件秋冬通勤风衣，藏蓝色，宽松廓形。"
              }
              rows={3}
              value={prompt}
            />
          </>
        )}
        <div className={styles.composerActions}>
          {canUploadReferences && !collaborationReadOnly ? <>
            <input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-label="选择助手参考图片" onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void uploads.queue.add(files);
            }} />
            <Button size="small" disabled={!uploadEnabled || !uploads.ready} onClick={() => imageInput.current?.click()}>上传图片</Button>
          </> : null}
          {pendingReply ? <Button loading={stopping} onClick={() => void stopReply()}>停止回复</Button> : null}
          {!collaborationReadOnly ? (
            <Button
              size="small"
              data-assistant-reference-trigger
              data-guide="workspace-reference"
              disabled={loading || !localDraft.ready || sending || contextSaving}
              onClick={() => setPickerOpen(true)}
            >
              添加引用
            </Button>
          ) : null}
          {!collaborationReadOnly ? (
            <button
              className={styles.actionPrimary}
              disabled={
                loading ||
                sending ||
                referencesPreparing ||
                imagesPending ||
                !localDraft.ready ||
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
            Enter 发送 Shift + Enter 换行
          </small>
        ) : null}
      </div>
        {resultPreview ? <AssistantResultViewer images={resultPreview.images} compare={resultPreview.compare} graph={graph} disabled={sending || contextSaving || pendingReply || collaborationReadOnly} onClose={() => setResultPreview(null)} onOpen={openResultImage} onContinue={continueResultImage} onOpenFiles={onOpenGeneratedFiles} /> : null}
        {previewReference ? <AssistantReferenceViewer
          key={previewReference.id}
          node={previewReference}
          projectId={projectId}
          actions={referencePlacement}
          onClose={() => setPreviewReferenceId(null)}
        /> : null}
        <AssistantReferencePicker
          open={pickerOpen}
          graph={graph}
          selectedIds={draftReferences.ids}
          onApply={(ids) => {
            if (resolveDraftReferences(graph.nodes.filter(node => node.type !== "media"), prompt, ids.filter(id => graph.nodes.some(node => node.id === id && node.type !== "media"))).ids.length + uploads.items.length > MAX_ASSISTANT_REFERENCES) { onError("待添加图片和所选引用合并后超过 16 项，请先减少部分内容。"); return; }
            setReferencedIds(ids);
            setPrompt((value) =>
              removeReferenceMentions(
                value,
                assistantReferenceNodes,
                draftReferences.ids.filter((id) => !ids.includes(id)),
              ),
            );
            setPickerOpen(false);
          }}
          onAddMaterial={() => {
            setAddingMaterial(true);
            setPickerOpen(false);
          }}
          onAfterClose={() => { if (addingMaterial) { setAddingMaterial(false); requestAnimationFrame(onAddMaterial); } }}
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
