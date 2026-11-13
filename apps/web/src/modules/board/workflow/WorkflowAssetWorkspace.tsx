"use client";
import { useSearchParams } from "next/navigation";
import { useDraftScope, usePersistentDraft } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";

import { Select } from "../../../components/ui";
/* Private images must use the authenticated content endpoint without image optimization. */
/* eslint-disable @next/next/no-img-element */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  imageAnnotationsSvg,
  imageOutpaintSchema,
  imageTransformSchema,
  hasImageAdjustments,
  imageAdjustmentsSchema,
  originalImageAdjustments,
  type ImageAdjustments,
  type ImageAnnotation,
  type ImageComment,
  type ImageFeedback,
  type CanvasCommand,
  canvasCommandSchema,
} from "@fashion/shared";
import { ImageViewer, type ImageSize } from "./ImageViewer";
import { ImageCommentsPanel, type ImageCommentDraft } from "./ImageCommentsPanel";
import { createImageFeedbackHandoff } from "./image-feedback-handoff";
import { ImageOrientationControls } from "./ImageOrientationControls";
import { ImageAdjustmentControls } from "./ImageAdjustmentControls";
import { ImageOutpaintControls } from "./ImageOutpaintControls";
import { ImageTextControls } from "./ImageTextControls";
import { ImageTextRegionOverlay } from "./ImageTextRegionOverlay";
import { useImageTextEditor } from "./use-image-text-editor";
import { changedImageText, imageTextEditProblem, imageTextMask } from "./image-text-editor";
import { signImageUpload, putOriginal, completeUpload, waitForThumbnail } from "../file-upload-api";
import { emptyOutpaintDraft, initialOutpaintFrame, outpaintBaseline, outpaintProblem, readOutpaintDraft, type OutpaintDraft } from "./image-outpaint";
import { ImageComparison } from "./ImageComparison";
import { imageToolEntryMode, type ImageToolEntryRequest } from "./image-tool-entry";
import type { AssetRestoreResult } from "./use-asset-restore";
import { hasOrientationChange, imageOrientationSchema, originalOrientation, type ImageOrientation } from "./image-orientation";
import { ImageZoomControl, type ImageZoomControlHandle } from "./ImageZoomControl";
import { CopyImageLinkButton } from "./CopyImageLinkButton";
import { Button, IconButton } from "../../../components/ui";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { LegacyAssetTools } from "./LegacyAssetTools";
import { ExportModal } from "../generation/ExportModal";
import { useWorkspaceDraft } from "./workspace-drafts";
import {
  executeWorkflowNode,
  fetchWorkflow,
  type WorkflowNode,
} from "./workflow-api";
import { useCanvasCommand } from "./use-canvas-command";
import { isRejectedCanvasCommand } from "./canvas-api";
import {
  imageRequest,
  imageBlob,
  saveBlob,
  ImageRequestError,
} from "./image-workspace-api";
import styles from "./image-workspace.module.css";

type Mode =
  | "view"
  | "annotate"
  | "comment"
  | "remove_background"
  | "erase"
  | "resize"
  | "orient"
  | "adjust"
  | "compare"
  | "text_edit"
  | "inpaint"
  | "variation"
  | "history"
  | "share"
  | "export"
  | "details";
export interface WorkflowAssetWorkspaceProps {
  embedded?: boolean;
  projectId: string;
  assetId: string;
  open: boolean;
  onClose: () => void;
  onGraphRefresh: () => void;
  onEnsureConversation?: () => Promise<string>;
  onPrepareAssistantFeedback?: (request: {
    assetId: string;
    title: string;
    revision: number;
    prompt: string;
    commentIds: readonly string[];
  }) => void | Promise<void>;
  tasks?: readonly WorkflowNode[];
  candidates?: readonly WorkflowNode[];
  onSelectAsset?: (id: string) => void;
  onRestoredAsset?: (result: AssetRestoreResult) => void;
  details?: ReactNode;
  entryRequest?: ImageToolEntryRequest | undefined;
  active?: boolean;
  canEdit?: boolean;
}
const tools = [
  { mode: "annotate", label: "标注" },
  { mode: "comment", label: "添加评论" },
  { mode: "remove_background", label: "移除背景" },
  { mode: "erase", label: "擦除" },
  { mode: "resize", label: "调整大小" },
  { mode: "orient", label: "旋转与翻转" },
  { mode: "adjust", label: "色彩与明暗" },
  { mode: "text_edit", label: "修改文字" },
  { mode: "inpaint", label: "局部重绘" },
  { mode: "variation", label: "生成变体" },
] as const;
const empty: ImageFeedback = { revision: 0, annotations: [], comments: [] };
interface ImageFeedbackDraft {
  feedback: ImageFeedback;
  comment: string;
  mode: Mode;
  point?: ImageCommentDraft["point"];
  editingComment?: string;
  selected?: string[];
  commentAnnotationIds?: string[];
}
interface Share {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function WorkflowAssetWorkspace(props: WorkflowAssetWorkspaceProps) {
  return props.open ? <ImageWorkspace key={props.assetId} {...props} /> : null;
}
function ImageWorkspace({
  assetId,
  projectId,
  onClose,
  onGraphRefresh,
  onEnsureConversation,
  onPrepareAssistantFeedback,
  candidates = [],
  tasks = [],
  onSelectAsset,
  onRestoredAsset,
  details,
  entryRequest,
  active = true,
  canEdit = true,
}: WorkflowAssetWorkspaceProps) {
  const query = useSearchParams();
  const draftScope = useDraftScope();
  const returnRevisionId = query.get("styleRevisionId");
  const styleHref = `/${encodeURIComponent(projectId)}/studio?tab=styles&assetId=${encodeURIComponent(assetId)}${returnRevisionId ? `&styleRevisionId=${encodeURIComponent(returnRevisionId)}` : ""}`;
  const [storedMode, setMode] = useState<Mode>("view");
  const mode = canEdit || ["view", "compare", "history", "details"].includes(storedMode) ? storedMode : "view";
  const [legacyTab, setLegacyTab] = useState<
    "inpaint" | "variation" | "erase" | "history" | null
  >(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const zoomControl = useRef<ImageZoomControlHandle>(null);
  const previewZoom = useCallback((percent: number | null) => zoomControl.current?.previewZoom(percent), []);
  const [size, setSize] = useState<ImageSize | null>(null);
  const textEditor = useImageTextEditor(assetId, size);
  const [feedback, setFeedback] = useState<ImageFeedback>(empty);
  const [baseline, setBaseline] = useState(JSON.stringify(empty));
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [feedbackEpoch, setFeedbackEpoch] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [undo, setUndo] = useState<ImageAnnotation[][]>([]);
  const [redo, setRedo] = useState<ImageAnnotation[][]>([]);
  const [pen, setPen] = useState<{
    kind: ImageAnnotation["kind"];
    color: string;
    width: number;
    text: string;
  }>({ kind: "pen", color: "#e74c3c", width: 5, text: "" });
  const [comment, setComment] = useState("");
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [commentAnnotationIds, setCommentAnnotationIds] = useState<string[]>([]);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const [actionBusy, setBusy] = useState(false);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const busy = actionBusy || legacyBusy || textEditor.scanning;
  const actionLock = useRef(false);
  const [preparingCommand, setHasPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [now] = useState(() => Date.now());
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [outpaintDraft, setOutpaintDraft] = useState<OutpaintDraft>(emptyOutpaintDraft);
  const resizeKind = outpaintDraft.kind;
  const setResizeKind = (kind: OutpaintDraft["kind"]) => setOutpaintDraft(value => ({ ...value, kind }));
  const [orientation, setOrientation] = useState<ImageOrientation>(originalOrientation);
  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>({ ...originalImageAdjustments });
  const adjustmentsDirty = hasImageAdjustments(adjustments);
  const adjustmentPersistence = usePersistentDraft({
    value: adjustments, baseline: JSON.stringify(originalImageAdjustments),
    objectKey: `image-adjustments:${assetId}`,
    restore: value => { const parsed = imageAdjustmentsSchema.safeParse(value); if (parsed.success) setAdjustments(parsed.data); },
  });
  const orientationDirty = hasOrientationChange(orientation);
  const orientationPersistence = usePersistentDraft({
    value: orientation,
    baseline: JSON.stringify(originalOrientation),
    objectKey: `image-orientation:${assetId}`,
    restore: value => {
      const parsed = imageOrientationSchema.safeParse(value);
      if (parsed.success) setOrientation(parsed.data);
    },
  });
  const [target, setTarget] = useState({ width: 1024, height: 1024 });
  const [lockRatio, setLockRatio] = useState(true);
  const [crop, setCrop] = useState({
    left: 0,
    top: 0,
    width: 1024,
    height: 1024,
  });
  const cropInitialized = useRef(false);
  const frame = outpaintDraft.frame ?? initialOutpaintFrame(size ?? { width: 768, height: 1024 });
  const setFrame = (value: typeof frame) => setOutpaintDraft(draft => ({ ...draft, frame: value }));
  const expandPrompt = outpaintDraft.prompt;
  const outpaintPersistence = usePersistentDraft({
    value: outpaintDraft, baseline: outpaintBaseline, objectKey: `image-outpaint:${assetId}`,
    restore: value => { const draft = readOutpaintDraft(value); if (draft) setOutpaintDraft(draft); },
  });
  const outpaintDirty = outpaintDraft.frame !== null || outpaintDraft.prompt !== emptyOutpaintDraft.prompt;
  const root = useRef<HTMLElement>(null);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const pending = useRef<Extract<CanvasCommand, { type: "run_tool" }> | null>(null);
  const durableCommand = useCanvasCommand(projectId, `image-command:${assetId}`);
  const hasPending = preparingCommand || durableCommand.pending !== null;
  useEffect(() => { if (durableCommand.pending?.type === "run_tool") pending.current = durableCommand.pending; }, [durableCommand.pending]);
  const dirty = JSON.stringify(feedback) !== baseline || Boolean(comment || point || editingComment || commentAnnotationIds.length);
  const feedbackDraft = (value = feedback): ImageFeedbackDraft => ({ feedback: value, comment, mode, ...(point ? { point } : {}), ...(editingComment ? { editingComment } : {}), ...(selected.length ? { selected } : {}), ...(commentAnnotationIds.length ? { commentAnnotationIds } : {}) });
  const feedbackDraftBaseline = (value: ImageFeedback) => JSON.stringify({ feedback: value, comment: "", mode: "view" });
  // Omit empty optional fields so pre-marker drafts retain the same baseline.
  const feedbackPersistence = usePersistentDraft<ImageFeedbackDraft>({ value: feedbackDraft(), baseline: feedbackDraftBaseline(JSON.parse(baseline) as ImageFeedback), enabled: feedbackLoaded, objectKey: `image:${assetId}`, restore: draft => {
    setFeedback(draft.feedback); setComment(draft.comment); setMode(draft.mode);
    setPoint(draft.point ?? null);
    setEditingComment(draft.feedback.comments.some(c => c.id === draft.editingComment) ? draft.editingComment ?? null : null);
    setSelected((draft.selected ?? []).filter(id => draft.feedback.comments.some(c => c.id === id)));
    setCommentAnnotationIds((draft.commentAnnotationIds ?? []).filter(id => draft.feedback.annotations.some(a => a.id === id)));
    if (["inpaint", "variation", "erase", "history"].includes(draft.mode)) setLegacyTab(draft.mode as "inpaint" | "variation" | "erase" | "history");
  } });
  const consumedEntryRequest = useRef<number | undefined>(undefined);
  const entryReady = feedbackLoaded && feedbackPersistence.ready && orientationPersistence.ready && adjustmentPersistence.ready && outpaintPersistence.ready && textEditor.ready;
  const getPendingEntryCommand = durableCommand.getPending;
  const entryScopeKey = draftScope ? JSON.stringify([draftScope.accountId, draftScope.projectId, draftScope.editor]) : null;
  useEffect(() => {
    if (!entryRequest || entryRequest.assetId !== assetId || entryRequest.nonce === consumedEntryRequest.current) return;
    if (!active) { consumedEntryRequest.current = entryRequest.nonce; return; }
    if (!entryReady || busy || (entryRequest.action === "crop" && !size)) return;
    let canceled = false;
    void (async () => {
      const scope = entryScopeKey ? JSON.parse(entryScopeKey) as string[] : null;
      const [normal, masked, restore] = await Promise.all([
        getPendingEntryCommand(),
        scope ? draftRepository.read<CanvasCommand>(JSON.stringify([...scope, `masked-image-command:${assetId}`])) : undefined,
        scope ? draftRepository.read(JSON.stringify([...scope, `asset-restore:${assetId}`])) : undefined,
      ]);
      if (canceled) return;
      consumedEntryRequest.current = entryRequest.nonce;
      const parsed = masked ? canvasCommandSchema.safeParse(masked.value) : null;
      if (masked && !parsed?.success) { setError("上次图片操作记录暂时无法读取，请保留草稿后重新打开。"); return; }
      if (entryRequest.action !== "history" && (!canEdit || hasPending || normal || masked || restore)) {
        setError(null);
        setNotice(!canEdit ? "当前图片仅可查看。" : "上次操作尚未确认，请先继续原操作；编辑草稿仍保留。");
        if (canEdit && restore) { setMode("history"); setLegacyTab("history"); }
        else if (canEdit && parsed?.success && parsed.data.type === "run_tool") {
          const pendingMode = parsed.data.parameters.intent === "erase" ? "erase" : parsed.data.parameters.taskType === "inpaint" ? "inpaint" : "variation";
          setMode(pendingMode); setLegacyTab(pendingMode);
        }
        return;
      }
      const next = imageToolEntryMode(entryRequest.action);
      setMode(next); setMenu(false); setComparingOriginal(false); setError(null);
      if (["inpaint", "variation", "erase", "history"].includes(next)) setLegacyTab(next as "inpaint" | "variation" | "erase" | "history");
      if (entryRequest.action === "crop" || entryRequest.action === "outpaint") {
        setOutpaintDraft(value => ({ ...value, kind: entryRequest.action as "crop" | "outpaint" }));
        if (entryRequest.action === "crop" && size && !cropInitialized.current) {
          cropInitialized.current = true;
          setTarget(size); setCrop({ left: 0, top: 0, ...size });
        }
      }
      if (["orient", "adjust", "text_edit", "resize"].includes(next)) setZoom(null);
    })().catch(() => { if (!canceled) { consumedEntryRequest.current = entryRequest.nonce; setError("暂时无法核对上次操作，请保留草稿后重新打开工具。"); } });
    return () => { canceled = true; };
  }, [entryRequest, assetId, active, entryReady, busy, canEdit, hasPending, size, mode, getPendingEntryCommand, entryScopeKey]);
  useWorkspaceDraft(
    "image-workspace",
    { feedback, comment, mode, orientation, adjustments, point, editingComment, selected, commentAnnotationIds, outpaintDraft, text: textEditor.draft },
    dirty || orientationDirty || adjustmentsDirty || outpaintDirty || changedImageText(textEditor.draft.regions).length > 0,
    busy || hasPending,
  );
  const closeWorkspace = () => {
    void Promise.all([
      feedbackPersistence.checkpoint(feedbackDraft(), feedbackDraftBaseline(JSON.parse(baseline) as ImageFeedback)),
      orientationPersistence.checkpoint(orientation, JSON.stringify(originalOrientation)),
      adjustmentPersistence.checkpoint(adjustments, JSON.stringify(originalImageAdjustments)),
      outpaintPersistence.checkpoint(outpaintDraft, outpaintBaseline),
      textEditor.checkpoint(),
    ]).then(onClose);
  };
  const current = candidates.find((node) => node.payload.assetId === assetId);
  const groupId = current?.payload.executionId;
  const siblings = groupId
    ? candidates.filter((node) => node.payload.executionId === groupId)
    : current
      ? [current]
      : [];
  const derived = [...new Map(candidates.filter(node => node.payload.parentAssetId === assetId && typeof node.payload.assetId === "string" && node.payload.assetId !== assetId).map(node => [String(node.payload.assetId), node])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const parent = candidates.find(node => node.payload.assetId === current?.payload.parentAssetId);
  const latestDerived = derived[0];
  const comparisonChoices = [...new Map([...derived, ...siblings, ...(parent ? [parent] : [])]
    .filter(node => typeof node.payload.assetId === "string" && node.payload.assetId !== assetId)
    .map(node => [String(node.payload.assetId), { id: String(node.payload.assetId), title: node.title }])).values()];
  const title = current?.title ?? "生成图片";
  const siblingIndex = siblings.findIndex((node) => node.payload.assetId === assetId);
  const canSwipe = mode === "view" && !dirty && !orientationDirty && !adjustmentsDirty && !outpaintDirty && !changedImageText(textEditor.draft.regions).length && !busy && !menu && siblings.length >= 3;
  const siblingUrl = (index: number) => { const id = siblings[index]?.payload.assetId; return typeof id === "string" ? `/api/design-assets/${encodeURIComponent(id)}/content` : undefined; };
  const base = `/api/design-assets/${encodeURIComponent(assetId)}`;
  const setImageSize = useCallback((next: ImageSize) => {
    setSize((previous) => {
      if (previous?.width === next.width && previous.height === next.height)
        return previous;
      return next;
    });
  }, []);
  useEffect(() => {
    let active = true;
    void imageRequest<ImageFeedback>(`${base}/feedback`)
      .then((value) => {
        if (!active) return;
        setFeedback(value);
        setBaseline(JSON.stringify(value));
        setFeedbackLoaded(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "标注读取失败");
      });
    return () => {
      active = false;
    };
  }, [base, feedbackEpoch]);
  useEffect(() => {
    root.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuAnchor.current?.contains(event.target)) setMenu(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [menu]);
  const act = async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      if (cause instanceof ImageRequestError && cause.status === 409)
        setConflict(true);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (!canEdit) throw new Error("当前图片仅可查看，无法保存修改。");
    if (!feedbackLoaded) throw new Error("标注尚未加载，请先重试读取");
    const value = await imageRequest<ImageFeedback>(
      `${base}/feedback`,
      "PUT",
      feedback,
    );
    setFeedback(value);
    setBaseline(JSON.stringify(value));
    setConflict(false);
    await feedbackPersistence.checkpoint(feedbackDraft(value), feedbackDraftBaseline(value));
    return value;
  };
  const annotations = (next: ImageAnnotation[]) => {
    setUndo((history) => [...history.slice(-49), feedback.annotations]);
    setRedo([]);
    setFeedback((value) => ({ ...value, annotations: next }));
  };
  const changeMode = (next: Mode) => {
    if (busy || !canEdit && !["view", "compare", "history", "details"].includes(next)) return;
    setMode(next);
    setMenu(false);
    setError(null);
    setComparingOriginal(false);
    if (next === "orient" || next === "adjust" || next === "text_edit") setZoom(null);
    if (
      next === "inpaint" ||
      next === "variation" ||
      next === "erase" ||
      next === "history"
    )
      setLegacyTab(next);
    if (next === "resize" && size && mode !== "resize") {
      cropInitialized.current = true;
      setTarget(size);
      setCrop({ left: 0, top: 0, ...size });
    }
    if (next === "share")
      void act(async () =>
        setShares(await imageRequest<Share[]>(`${base}/shares`)),
      );
  };
  const submit = async (params: Record<string, unknown>, transform = false) => {
    if (!canEdit) throw new Error("当前图片仅可查看，无法提交修改。");
    if (!size) throw new Error("原图尚未加载");
    if (pending.current && Object.keys(params).length) throw new Error("上一次提交尚未确认，请使用“重试原操作”继续处理");
    const graph = await fetchWorkflow(projectId);
    if (!pending.current) {
      const source = graph.nodes.find(
        (node) => node.payload.assetId === assetId,
      );
      if (!source) throw new Error("图片来源节点不存在");
      const key = transform ? "transform_image" : "edit_design";
      const toolTitle = transform
        ? params.adjustments ? "调整图片色彩与明暗" : (params.rotate !== undefined || params.flipHorizontal !== undefined || params.flipVertical !== undefined ? "旋转与翻转图片" : "调整图片尺寸")
        : params.textEdits ? "修改图片文字" : params.intent === "outpaint"
          ? "AI 扩图"
          : params.intent === "feedback"
            ? "按意见修改"
            : "移除背景";
      setHasPending(true);
      pending.current = {
        type: "run_tool",
        mutationId: crypto.randomUUID(),
        toolKey: key,
        title: toolTitle,
        parameters: params,
        inputs: [
          { nodeId: source.id, port: "source" },
          ...graph.edges
            .filter(
              (edge) =>
                edge.targetNodeId ===
                  graph.edges.find((edge) => edge.targetNodeId === source.id)
                    ?.sourceNodeId &&
                edge.targetPort === "constraint" &&
                !transform,
            )
            .map((edge) => ({ nodeId: edge.sourceNodeId, port: "constraint" as const })),
        ],
      };
      const conversationId = await onEnsureConversation?.();
      if (conversationId) pending.current.conversationId = conversationId;
    }
    const request = pending.current;
    await durableCommand.execute(request).catch((error: unknown) => {
      if (isRejectedCanvasCommand(error)) { pending.current = null; setHasPending(false); }
      throw error;
    });
    pending.current = null;
    setHasPending(false);
    if (request.toolKey === "transform_image" && (request.parameters.rotate !== undefined || request.parameters.flipHorizontal !== undefined || request.parameters.flipVertical !== undefined)) {
      setOrientation(originalOrientation);
      setComparingOriginal(false);
      await orientationPersistence.checkpoint(originalOrientation, JSON.stringify(originalOrientation));
    }
    if (request.toolKey === "transform_image" && request.parameters.adjustments) {
      setAdjustments({ ...originalImageAdjustments });
      setComparingOriginal(false);
      await adjustmentPersistence.checkpoint({ ...originalImageAdjustments }, JSON.stringify(originalImageAdjustments));
    }
    setMode("view");
    setNotice("任务已提交，完成后会展示新版本");
    onGraphRefresh();
  };
  const generationParams = () => ({
    taskType: "i2i",
    count: 1,
    width: Math.min(
      2048,
      Math.max(256, Math.round((size?.width ?? 768) / 8) * 8),
    ),
    height: Math.min(
      2048,
      Math.max(256, Math.round((size?.height ?? 1024) / 8) * 8),
    ),
  });
  const download = async (annotated = false) => {
    const blob = await imageBlob(assetId);
    if (!annotated || !size) {
      saveBlob(
        blob,
        `${title}.${blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png"}`,
      );
      return;
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片合成");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const svg = new Image();
    svg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(imageAnnotationsSvg(feedback.annotations, canvas.width, canvas.height, feedback.comments.flatMap((c, i) => c.point ? [{ number: i + 1, point: c.point }] : [])))}`;
    await svg.decode();
    context.drawImage(svg, 0, 0);
    const result = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("标注图片导出失败")),
        "image/png",
      ),
    );
    saveBlob(result, `${title}-标注.png`);
  };
  const commentsLocked = !canEdit || busy || hasPending || !feedbackLoaded;
  const clearComment = () => {
    setComment(""); setPoint(null); setEditingComment(null); setCommentAnnotationIds([]);
  };
  const editComment = (id: string) => {
    if (commentsLocked || editingComment === id) return;
    const original = feedback.comments.find(c => c.id === editingComment);
    const changed = original
      ? comment !== original.text || JSON.stringify(point) !== JSON.stringify(original.point) || JSON.stringify(commentAnnotationIds) !== JSON.stringify(original.annotationIds)
      : Boolean(comment || point || commentAnnotationIds.length);
    if (changed) {
      setNotice("先添加、更新或取消当前评论，再编辑其他意见。");
      commentInput.current?.focus();
      return;
    }
    const value = feedback.comments.find(c => c.id === id);
    if (!value) return;
    setComment(value.text); setPoint(value.point); setEditingComment(id); setCommentAnnotationIds(value.annotationIds);
    setMode("comment");
    requestAnimationFrame(() => commentInput.current?.focus());
  };
  const addComment = () => {
    if (commentsLocked || !comment.trim() || (!editingComment && feedback.comments.length >= 100)) return;
    const value: ImageComment = {
      id: editingComment ?? crypto.randomUUID(),
      text: comment.trim(),
      point,
      annotationIds: commentAnnotationIds.filter(id => feedback.annotations.some(a => a.id === id)),
    };
    setFeedback((old) => ({
      ...old,
      comments: editingComment
        ? old.comments.map((c) => (c.id === editingComment ? value : c))
        : [...old.comments, value],
    }));
    setSelected((old) => [...new Set([...old, value.id])]);
    clearComment();
  };
  const prepareAssistantFeedback = async (saved: ImageFeedback) => {
    if (!onPrepareAssistantFeedback) return;
    const comments = saved.comments.filter((value) => selected.includes(value.id));
    const handoff = createImageFeedbackHandoff({
      title,
      revision: saved.revision,
      comments,
      annotations: saved.annotations,
    });
    await onPrepareAssistantFeedback({
      assetId,
      title,
      revision: saved.revision,
      prompt: handoff.prompt,
      commentIds: handoff.commentIds,
    });
  };
  const legacy =
    mode === "erase" ||
    mode === "inpaint" ||
    mode === "variation" ||
    mode === "history";
  const resizeMethodControl = <label>调整方式
    <Select value={resizeKind} disabled={busy || hasPending || !outpaintPersistence.ready}
      onChange={event => setResizeKind(event.target.value as typeof resizeKind)}>
      <option value="resize">缩放尺寸</option>
      <option value="crop">裁剪</option>
      <option value="outpaint">AI 扩图</option>
    </Select>
  </label>;
  return (
    <section
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="图片工作区"
      data-image-editing={mode !== "view" || busy}
      data-image-legacy={legacy && mode !== "history"}
      data-comparing={mode === "compare"}
      className={styles.workspace}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          if (menu) {
            event.preventDefault();
            setMenu(false);
            menuAnchor.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return;
          }
          if (!busy) {
            if (mode === "view") closeWorkspace();
            else setMode("view");
          }
        }
        if (event.key === "Tab") {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ),
          ].filter((element) => element.checkVisibility());
          const first = buttons[0];
          const last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        if (
          event.target instanceof HTMLElement &&
          /INPUT|TEXTAREA|SELECT/u.test(event.target.tagName)
        )
          return;
        if (
          mode === "view" &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          const index = siblings.findIndex(
            (n) => n.payload.assetId === assetId,
          );
          const next = siblings[index + (event.key === "ArrowRight" ? 1 : -1)];
          if (next && onSelectAsset) {
            event.preventDefault();
            onSelectAsset(String(next.payload.assetId));
          }
        }
      }}
    >
      <header className={styles.topbar}>
        <div className={styles.currentImage}><strong>{title}</strong><span>{size ? `${size.width} × ${size.height}` : "正在加载原图"}</span></div>
        {canEdit ? <a className={styles.saveStyle} href={styleHref} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>{returnRevisionId ? "更新款式修订" : "保存为款式"}</a> : <span className={styles.readOnly}>仅查看</span>}
        <div className={styles.menuAnchor} ref={menuAnchor}>
          <Button onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <WorkspaceIcon name="image" />图像<WorkspaceIcon name="chevron" />
          </Button>
          {menu ? (
            <div className={styles.menu}>
              <strong>{title}</strong>
              <span>
                {size ? `${size.width} × ${size.height}` : "正在加载原图"}
              </span>
              {canEdit ? <a className={styles.mobileAction} href={styleHref} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>{returnRevisionId ? "更新款式修订" : "保存为款式"}</a> : null}
              <button className={styles.mobileAction} disabled={busy} onClick={() => { setMenu(false); void act(() => download()); }}>下载原图</button>
              {canEdit ? <><button className={styles.mobileAction} onClick={() => changeMode("share")}>分享</button>
              <a href={`/${encodeURIComponent(projectId)}/studio?tab=presentation&mode=realtime&assetId=${encodeURIComponent(assetId)}`}>实时试穿</a>
              <a href={`/${encodeURIComponent(projectId)}/studio?tab=presentation&mode=wardrobe&assetId=${encodeURIComponent(assetId)}`}>加入衣架</a></> : null}
              <button onClick={() => changeMode("history")}>版本历史</button>
              {comparisonChoices.length > 0 && onSelectAsset ? <button disabled={busy} onClick={() => changeMode("compare")}>比较方案</button> : null}
              {canEdit ? <button onClick={() => changeMode("export")}>更多导出选项</button> : null}
              {details ? (
                <button onClick={() => changeMode("details")}>
                  来源与设计决策
                </button>
              ) : null}
              <button
                disabled={busy}
                onClick={() => void act(() => download(true))}
              >
                下载带标注图片
              </button>

            </div>
          ) : null}
        </div>
        <div className={styles.topActions}>
          <div className={styles.desktopActions}>
          <ImageZoomControl ref={zoomControl} zoom={zoom} onChange={setZoom} />
          <button
            disabled={busy}
            aria-label="下载原图"
            onClick={() => void act(() => download())}
          >
            <WorkspaceIcon name="download" /> <span>下载</span>
          </button>
          {canEdit ? <Button onClick={() => changeMode("share")}><WorkspaceIcon name="share" />分享</Button> : null}
          </div>
          <IconButton className={styles.closeWorkspace} disabled={busy} label="关闭图片工作区" onClick={closeWorkspace}>
            <WorkspaceIcon name="close" />
          </IconButton>
        </div>
      </header>
      {error || notice ? (
        <div className={styles.notice} role={error ? "alert" : "status"}>
          {error ?? notice}
          {!feedbackLoaded ? (
            <button
              onClick={() => {
                setError(null);
                setFeedbackEpoch((n) => n + 1);
              }}
            >
              重新读取标注
            </button>
          ) : null}
          <button
            aria-label="关闭图片提示"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      {hasPending && !busy ? (
        <div className={styles.notice} role="status">
          <span>上一次提交尚未确认，重试将继续原操作。</span>
          {canEdit ? <button onClick={() => void act(() => submit({}))}>重试原操作</button> : <span>当前只读，恢复编辑权限后可继续。</span>}
        </div>
      ) : null}
      {mode === "view" && onSelectAsset && (derived.length > 0 || parent) ? (
        <div className={styles.notice} role="group" aria-label="图片编辑版本">
          <span>{derived.length > 0 ? `这张图已有 ${derived.length} 个编辑版本` : "当前为编辑后的新版本"}</span>
          {latestDerived ? <button disabled={busy} onClick={() => onSelectAsset(String(latestDerived.payload.assetId))} type="button">查看编辑结果</button> : null}
          {parent ? <button disabled={busy} onClick={() => onSelectAsset(String(parent.payload.assetId))} type="button">返回来源图片</button> : null}
          <button data-compare-trigger disabled={busy} onClick={() => changeMode("compare")} type="button">{derived.length > 0 ? "对比编辑结果" : "对比来源图片"}</button>
        </div>
      ) : null}
      {conflict ? (
        <div className={styles.notice} role="alert">
          <span>远端标注已变化，本地草稿仍保留。</span>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const latest = await imageRequest<ImageFeedback>(
                  `${base}/feedback`,
                );
                setFeedback(latest);
                setBaseline(JSON.stringify(latest));
                setUndo([]);
                setRedo([]);
                setConflict(false);
              })
            }
          >
            载入最新并放弃本地标注
          </button>
        </div>
      ) : null}
      {tasks
        .filter((task) => ["queued", "running", "failed"].includes(task.status))
        .map((task) => (
          <div key={task.id} className={styles.notice} role="status">
            <span>
              {task.title} {" "}
              {task.status === "failed"
                ? "处理失败，输入已保留"
                : task.status === "queued"
                  ? "排队中"
                  : "正在处理"}
            </span>
            {canEdit && task.status === "failed" ? (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await executeWorkflowNode(
                      projectId,
                      task.id,
                      await onEnsureConversation?.(),
                    );
                    onGraphRefresh();
                  })
                }
              >
                重试处理
              </button>
            ) : null}
          </div>
        ))}
      <div className={styles.body} data-comparing={mode === "compare"}>
        <ImageViewer
          url={`${base}/content`}
          title={title}
          zoom={zoom}
          onZoom={setZoom}
          onZoomPreview={previewZoom}
          previousUrl={canSwipe ? siblingUrl(siblingIndex - 1) : undefined}
          nextUrl={canSwipe ? siblingUrl(siblingIndex + 1) : undefined}
          onNavigate={canSwipe ? (direction) => { const id = siblings[siblingIndex + direction]?.payload.assetId; if (typeof id === "string") onSelectAsset?.(id); } : undefined}
          onSize={setImageSize}
          onLoadError={() => setSize(null)}
          orientation={mode === "orient" ? comparingOriginal ? originalOrientation : orientation : undefined}
          adjustments={mode === "adjust" ? comparingOriginal ? { ...originalImageAdjustments } : adjustments : undefined}
          previewLabel={mode === "orient" || mode === "adjust" ? comparingOriginal ? "原图" : "调整预览" : undefined}
          annotations={feedback.annotations}
          comments={feedback.comments}
          selectedCommentIds={selected}
          editingCommentId={editingComment}
          commentDraft={mode === "comment" && point ? { point, number: editingComment ? feedback.comments.findIndex(c => c.id === editingComment) + 1 : feedback.comments.length + 1 } : undefined}
          commentsLocked={commentsLocked}
          onSelectComment={editComment}
          mode={feedbackLoaded || mode === "orient" || mode === "adjust" || mode === "text_edit" ? mode : "view"}
          pen={pen}
          onAnnotation={(a) => annotations([...feedback.annotations, a])}
          onPoint={value => { if (!commentsLocked && (editingComment || feedback.comments.length < 100)) setPoint(value); }}
          frame={
            mode === "resize" && resizeKind === "outpaint" ? frame : undefined
          }
          onFrame={setFrame}
          imageOverlay={mode === "text_edit" ? (imageSize, scale) => <ImageTextRegionOverlay
            regions={textEditor.draft.regions} selected={textEditor.draft.selected} size={imageSize} scale={scale}
            locked={busy || hasPending || !textEditor.ready} onSelect={textEditor.select}
            onRect={(id, rect) => textEditor.update(id, { rect })} /> : undefined}
          geometryLocked={busy || hasPending || !size || (resizeKind === "outpaint" && (!outpaintPersistence.ready || size.width > 2048 || size.height > 2048))}
          crop={mode === "resize" && resizeKind === "crop" ? crop : undefined}
          onCrop={(value) => {
            setCrop(value);
            setTarget({ width: value.width, height: value.height });
          }}
        />
        {mode !== "view" &&
        mode !== "compare" &&
        !legacy &&
        mode !== "export" &&
        mode !== "details" ? (
          <aside className={`${styles.panel} ${mode === "orient" || mode === "adjust" || mode === "text_edit" || (mode === "resize" && resizeKind === "outpaint") ? styles.orientationPanel : ""} ${mode === "text_edit" || (mode === "resize" && resizeKind === "outpaint") ? styles.outpaintPanel : ""}`} aria-label="图片工具参数">
            <div className={styles.panelHeading}>
              <h2>{mode === "resize" && resizeKind === "outpaint" ? "AI 扩图" : tools.find((t) => t.mode === mode)?.label ?? "分享图片"}</h2>
              <button
                disabled={busy}
                onClick={() => setMode("view")}
                aria-label="收起工具"
              >
                ×
              </button>
            </div>
            {mode === "orient" ? <ImageOrientationControls
              value={orientation}
              onChange={value => { setOrientation(value); setZoom(null); }}
              size={size}
              busy={busy}
              pending={hasPending}
              comparing={comparingOriginal}
              onCompare={value => { setComparingOriginal(value); setZoom(null); }}
              onSave={params => void act(() => submit(params, true))}
            /> : null}
            {mode === "adjust" ? <ImageAdjustmentControls
              value={adjustments} onChange={setAdjustments} size={size} locked={busy || hasPending}
              comparing={comparingOriginal} onCompare={setComparingOriginal}
              onSave={params => void act(() => submit(params, true))}
            /> : null}
            {mode === "text_edit" ? <ImageTextControls editor={textEditor} size={size} locked={busy || hasPending} busy={actionBusy}
              onSubmit={() => void act(async () => {
                const problem = imageTextEditProblem(textEditor.draft, size);
                if (problem || !size) throw new Error(problem ?? "原图尚未加载");
                const edits = changedImageText(textEditor.draft.regions);
                await textEditor.checkpoint();
                const blob = await imageTextMask(edits, size);
                const file = new File([blob], "文字修改选区.png", { type: "image/png" });
                const signed = await signImageUpload(projectId, file);
                const uploaded = signed.upload ? await putOriginal(signed.upload, file).then(() => completeUpload(signed.file.id)) : signed.file;
                const mask = await waitForThumbnail(signed.file.id, uploaded);
                await submit({ ...generationParams(), taskType: "inpaint", textEdits: edits, mask: { fileAssetId: mask.id },
                  prompt: "按确认的文字与区域修改图片，保留选区外原图。" });
              })} /> : null}
            {mode === "annotate" ? (
              <>
                <label>
                  标注工具
                  <Select
                    value={pen.kind}
                    onChange={(e) =>
                      setPen({
                        ...pen,
                        kind: e.target.value as ImageAnnotation["kind"],
                      })
                    }
                  >
                    <option value="pen">自由画笔</option>
                    <option value="rectangle">矩形</option>
                    <option value="arrow">箭头</option>
                    <option value="text">文字</option>
                  </Select>
                </label>
                <label>
                  颜色
                  <input
                    type="color"
                    value={pen.color}
                    onChange={(e) => setPen({ ...pen, color: e.target.value })}
                  />
                </label>
                <label>
                  粗细
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={pen.width}
                    onChange={(e) =>
                      setPen({ ...pen, width: Number(e.target.value) })
                    }
                  />
                </label>
                {pen.kind === "text" ? (
                  <label>
                    标注文字
                    <input
                      maxLength={500}
                      value={pen.text}
                      onChange={(e) => setPen({ ...pen, text: e.target.value })}
                      placeholder="输入后点击图片放置"
                    />
                  </label>
                ) : null}
                <div className={styles.row}>
                  <button
                    disabled={!undo.length}
                    onClick={() => {
                      setRedo([...redo, feedback.annotations]);
                      setFeedback({
                        ...feedback,
                        annotations: undo.at(-1) ?? feedback.annotations,
                      });
                      setUndo(undo.slice(0, -1));
                    }}
                  >
                    撤销
                  </button>
                  <button
                    disabled={!redo.length}
                    onClick={() => {
                      setUndo([...undo, feedback.annotations]);
                      setFeedback({
                        ...feedback,
                        annotations: redo.at(-1) ?? feedback.annotations,
                      });
                      setRedo(redo.slice(0, -1));
                    }}
                  >
                    重做
                  </button>
                </div>
                {feedback.annotations.map((a, i) => (
                  <div className={styles.row} key={a.id}>
                    <span>
                      标注 {i + 1} {a.text}
                    </span>
                    <button
                      aria-label={`删除标注 ${i + 1}`}
                      onClick={() =>
                        annotations(
                          feedback.annotations.filter((v) => v.id !== a.id),
                        )
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
                <button
                  className={styles.primary}
                  disabled={busy || !feedbackLoaded}
                  onClick={() =>
                    void act(async () => {
                      await save();
                      setNotice("标注已保存");
                    })
                  }
                >
                  保存标注
                </button>
                <button onClick={() => changeMode("comment")}>
                  添加修改意见
                </button>
              </>
            ) : null}
            {mode === "comment" ? (
              <ImageCommentsPanel feedback={feedback}
                draft={{ text: comment, point, editingId: editingComment, annotationIds: commentAnnotationIds }}
                selected={selected} locked={commentsLocked} inputRef={commentInput}
                onDraft={value => {
                  if (value.text !== undefined) setComment(value.text);
                  if (value.point !== undefined) setPoint(value.point);
                  if (value.annotationIds !== undefined) setCommentAnnotationIds(value.annotationIds);
                }}
                onSelect={setSelected} onEdit={editComment} onAdd={addComment} onClear={clearComment}
                onDelete={id => {
                  setFeedback(old => ({ ...old, comments: old.comments.filter(c => c.id !== id) }));
                  setSelected(old => old.filter(value => value !== id));
                  if (editingComment === id) clearComment();
                }}
                onSave={() => void act(async () => { await save(); setNotice("评论已保存"); })}
                onPrepareAssistant={onPrepareAssistantFeedback ? () => void act(async () => {
                  const saved = await save();
                  await prepareAssistantFeedback(saved);
                  closeWorkspace();
                }) : undefined}
                onSubmit={() => void act(async () => {
                  const saved = await save();
                  await submit({ ...generationParams(), intent: "feedback", prompt: "按照选定的修改意见调整服装，保留未要求修改的内容。", feedbackRevision: saved.revision, commentIds: selected });
                })}
              />
            ) : null}
            {mode === "remove_background" ? (
              <>
                <p>
                  由 AI 移除背景并输出透明
                  PNG，保留原图作为历史版本。主体细节可能变化。
                </p>
                <button
                  disabled={busy || !size}
                  className={styles.primary}
                  onClick={() =>
                    void act(() =>
                      submit({
                        ...generationParams(),
                        intent: "remove_background",
                        prompt:
                          "精确提取原图服装或人物主体，移除整个背景，输出真正透明背景。尽量保留服装纹理、色彩、轮廓和所有主体细节。",
                      }),
                    )
                  }
                >
                  {busy ? "正在提交…" : "移除背景并生成新版本"}
                </button>
              </>
            ) : null}
            {mode === "resize" ? (
              <>
                {resizeKind !== "outpaint" ? resizeMethodControl : null}
                {resizeKind === "outpaint" ? (
                  <ImageOutpaintControls frame={frame} size={size} prompt={expandPrompt}
                    methodControl={resizeMethodControl}
                    locked={busy || hasPending || !outpaintPersistence.ready} busy={busy}
                    onFrame={setFrame} onPrompt={prompt => setOutpaintDraft(value => ({ ...value, prompt }))}
                    onSubmit={() => void act(async () => {
                      const problem = outpaintProblem(frame, size);
                      if (problem) throw new Error(problem);
                      const parsed = imageOutpaintSchema.parse(frame);
                      await outpaintPersistence.checkpoint(outpaintDraft, outpaintBaseline);
                      await submit({ ...generationParams(), width: parsed.width, height: parsed.height,
                        intent: "outpaint", outpaint: parsed, prompt: expandPrompt.trim() || "自然扩展背景，保留原图主体" });
                    })} />
                ) : (
                  <>
                    {resizeKind === "crop" ? (
                      <>
                        <label>
                          裁剪比例
                          <Select
                            defaultValue="free"
                            onChange={(e) => {
                              if (!size || e.target.value === "free") return;
                              const ratio = Number(e.target.value);
                              const width = Math.min(
                                size.width,
                                size.height * ratio,
                              );
                              const height = width / ratio;
                              setCrop({
                                left: Math.floor((size.width - width) / 2),
                                top: Math.floor((size.height - height) / 2),
                                width: Math.floor(width),
                                height: Math.floor(height),
                              });
                              setTarget({
                                width: Math.floor(width),
                                height: Math.floor(height),
                              });
                            }}
                          >
                            <option value="free">自由比例</option>
                            <option value="1">1:1</option>
                            <option value={3 / 4}>3:4</option>
                            <option value={4 / 3}>4:3</option>
                            <option value={16 / 9}>16:9</option>
                          </Select>
                        </label>
                        {(["left", "top", "width", "height"] as const).map(
                          (key) => (
                            <label key={key}>
                              裁剪
                              {
                                {
                                  left: "左边距",
                                  top: "上边距",
                                  width: "宽度",
                                  height: "高度",
                                }[key]
                              }
                              <input
                                type="number"
                                min={0}
                                value={crop[key]}
                                onChange={(e) =>
                                  setCrop({
                                    ...crop,
                                    [key]: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          ),
                        )}
                      </>
                    ) : null}
                    <label>
                      <input
                        type="checkbox"
                        checked={lockRatio}
                        onChange={(e) => setLockRatio(e.target.checked)}
                      />
                      锁定比例
                    </label>
                    {(["width", "height"] as const).map((key) => (
                      <label key={key}>
                        输出{key === "width" ? "宽度" : "高度"}
                        <input
                          type="number"
                          min={16}
                          max={8192}
                          value={target[key]}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            const source = resizeKind === "crop" ? crop : size;
                            setTarget(
                              lockRatio && source
                                ? key === "width"
                                  ? {
                                      width: value,
                                      height: Math.round(
                                        (value * source.height) / source.width,
                                      ),
                                    }
                                  : {
                                      height: value,
                                      width: Math.round(
                                        (value * source.width) / source.height,
                                      ),
                                    }
                                : { ...target, [key]: value },
                            );
                          }}
                        />
                      </label>
                    ))}
                  </>
                )}
                {resizeKind !== "outpaint" ? (
                  <button
                    className={styles.primary}
                    disabled={busy || hasPending || !size}
                    onClick={() =>
                      void act(async () => {
                        const parsed = imageTransformSchema.safeParse({
                          ...target,
                          ...(resizeKind === "crop" ? { crop } : {}),
                        });
                        if (!parsed.success)
                          throw new Error(
                            parsed.error.issues[0]?.message ?? "图片尺寸不合法",
                          );
                        if (
                          resizeKind === "crop" &&
                          size &&
                          (crop.left + crop.width > size.width ||
                            crop.top + crop.height > size.height)
                        )
                          throw new Error("裁剪区域超出原图");
                        await submit(parsed.data, true);
                      })
                    }
                  >
                    {busy ? "正在提交…" : "保存为新版本"}
                  </button>
                ) : null}
              </>
            ) : null}
            {mode === "share" ? (
              <>
                <p>
                  链接有效期七天。获得链接的人可查看此图片，评论和项目内容不会公开。
                </p>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await imageRequest<{ path: string }>(
                        `${base}/shares`,
                        "POST",
                      );
                      setShareUrl(
                        new URL(result.path, window.location.origin).href,
                      );
                      setShares(await imageRequest<Share[]>(`${base}/shares`));
                    })
                  }
                >
                  创建只读链接
                </button>
                {shareUrl ? (
                  <>
                    <input aria-label="分享链接" value={shareUrl} readOnly />
                    <CopyImageLinkButton value={shareUrl} onError={setError} />
                  </>
                ) : null}
                {shares.map((share) => (
                  <div className={styles.comment} key={share.id}>
                    <span>
                      {share.revokedAt
                        ? "已撤销"
                        : new Date(share.expiresAt).getTime() < now
                          ? "已过期"
                          : `有效至 ${new Date(share.expiresAt).toLocaleDateString()}`}
                    </span>
                    <button
                      disabled={busy || Boolean(share.revokedAt)}
                      onClick={() =>
                        void act(async () => {
                          await imageRequest(
                            `${base}/shares/${share.id}`,
                            "DELETE",
                          );
                          setShareUrl(null);
                          setShares(
                            await imageRequest<Share[]>(`${base}/shares`),
                          );
                        })
                      }
                    >
                      撤销链接
                    </button>
                  </div>
                ))}
              </>
            ) : null}
            {dirty ? (
              <small>
                有未保存的标注或评论，关闭工作区后仍会保留本次草稿。
              </small>
            ) : null}
          </aside>
        ) : null}
        {legacyTab ? (
          <div className={styles.legacy} hidden={!legacy}>
            <button className={styles.back} disabled={busy} onClick={() => setMode("view")}>
              ← 返回图片
            </button>
            <LegacyAssetTools
              readOnly={!canEdit}
              styleHref={styleHref}
              initialTab={legacyTab}
              embedded
              open
              assetId={assetId}
              projectId={projectId}
              onClose={() => setMode("view")}
              onGraphRefresh={onGraphRefresh}
              {...(onRestoredAsset ? { onRestoredAsset } : {})}
              onBusyChange={setLegacyBusy}
              {...(onEnsureConversation ? { onEnsureConversation } : {})}
            />
          </div>
        ) : null}
        {mode === "compare" ? <div className={styles.comparisonLayer}>
          <ImageComparison
            current={{ id: assetId, title }}
            choices={comparisonChoices}
            onClose={() => { setMode("view"); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[data-compare-trigger]")?.focus()); }}
            {...(onSelectAsset ? { onOpen: onSelectAsset } : {})}
          />
        </div> : null}
        {mode === "export" ? (
          <div className={styles.legacy}>
            <ExportModal
              embedded
              onClose={() => setMode("view")}
              onBack={() => setMode("view")}
              source={{ type: "asset", assetId, previewUrl: `${base}/content` }}
            />
          </div>
        ) : null}
        {mode === "details" ? (
          <div className={styles.legacy}>
            <button onClick={() => setMode("view")}>← 返回图片</button>
            {details}
          </div>
        ) : null}
      </div>
      {siblings.length > 1 && mode !== "compare" && (!legacy || mode === "history") ? (
        <div className={styles.galleryFooter}>
        <nav className={styles.filmstrip} aria-label="本次生成结果">
          {siblings.map((node) => (
            <button
              key={node.id}
              aria-label={`查看${node.title}`}
              aria-current={
                node.payload.assetId === assetId ? "true" : undefined
              }
              disabled={busy}
              onClick={() => onSelectAsset?.(String(node.payload.assetId))}
            >
              <img
                src={`/api/design-assets/${encodeURIComponent(String(node.payload.assetId))}/thumbnail`}
                alt={node.title}
              />
            </button>
          ))}
        </nav>
        {onSelectAsset ? <button data-compare-trigger className={styles.compareTrigger} disabled={busy} onClick={() => changeMode("compare")} type="button">比较方案</button> : null}
        </div>
      ) : null}
      <nav className={styles.toolbar} data-surface="inverse" aria-label="图片工具" hidden={!canEdit || mode === "compare" || (legacy && mode !== "history")}>
        {tools.map((tool) => (
          <button
            key={tool.mode}
            disabled={busy}
            aria-pressed={mode === tool.mode}
            onClick={() => changeMode(mode === tool.mode ? "view" : tool.mode)}
          >
            <WorkspaceIcon name={tool.mode} />
            {tool.label}
          </button>
        ))}
      </nav>
    </section>
  );
}
