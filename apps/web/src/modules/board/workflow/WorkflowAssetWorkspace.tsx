"use client";
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
  type ImageAnnotation,
  type ImageComment,
  type ImageFeedback,
} from "@fashion/shared";
import { ImageViewer, type ImageSize } from "./ImageViewer";
import { Button, IconButton } from "../../../components/ui";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { LegacyAssetTools } from "./LegacyAssetTools";
import { ExportModal } from "../generation/ExportModal";
import { useWorkspaceDraft } from "./workspace-drafts";
import {
  executeWorkflowNode,
  fetchWorkflow,
  patchWorkflow,
  type WorkflowNode,
  type WorkflowOperation,
} from "./workflow-api";
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
  tasks?: readonly WorkflowNode[];
  candidates?: readonly WorkflowNode[];
  onSelectAsset?: (id: string) => void;
  details?: ReactNode;
}
const tools = [
  { mode: "annotate", label: "标注" },
  { mode: "comment", label: "添加评论" },
  { mode: "remove_background", label: "移除背景" },
  { mode: "erase", label: "擦除" },
  { mode: "resize", label: "调整大小" },
  { mode: "inpaint", label: "局部重绘" },
  { mode: "variation", label: "生成变体" },
] as const;
const empty: ImageFeedback = { revision: 0, annotations: [], comments: [] };
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
  candidates = [],
  tasks = [],
  onSelectAsset,
  details,
}: WorkflowAssetWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [legacyTab, setLegacyTab] = useState<
    "inpaint" | "variation" | "erase" | "history" | null
  >(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [size, setSize] = useState<ImageSize | null>(null);
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
  const [busy, setBusy] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [now] = useState(() => Date.now());
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [resizeKind, setResizeKind] = useState<"resize" | "crop" | "outpaint">(
    "resize",
  );
  const [target, setTarget] = useState({ width: 1024, height: 1024 });
  const [lockRatio, setLockRatio] = useState(true);
  const [crop, setCrop] = useState({
    left: 0,
    top: 0,
    width: 1024,
    height: 1024,
  });
  const [frame, setFrame] = useState({
    left: 0,
    top: 0,
    width: 1024,
    height: 1024,
  });
  const [expandPrompt, setExpandPrompt] = useState(
    "自然延伸背景与光线，保持原图服装主体不变。",
  );
  const root = useRef<HTMLElement>(null);
  const pending = useRef<{
    toolId: string;
    mutationId: string;
    executionMutationId: string;
    operations: WorkflowOperation[];
  } | null>(null);
  const dirty = JSON.stringify(feedback) !== baseline || Boolean(comment);
  useWorkspaceDraft(
    "image-workspace",
    { feedback, comment, mode },
    dirty,
    busy,
  );
  const current = candidates.find((node) => node.payload.assetId === assetId);
  const groupId = current?.payload.executionId;
  const siblings = groupId
    ? candidates.filter((node) => node.payload.executionId === groupId)
    : current
      ? [current]
      : [];
  const title = current?.title ?? "生成图片";
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
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
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
      setBusy(false);
    }
  };
  const save = async () => {
    if (!feedbackLoaded) throw new Error("标注尚未加载，请先重试读取");
    const value = await imageRequest<ImageFeedback>(
      `${base}/feedback`,
      "PUT",
      feedback,
    );
    setFeedback(value);
    setBaseline(JSON.stringify(value));
    setConflict(false);
    return value;
  };
  const annotations = (next: ImageAnnotation[]) => {
    setUndo((history) => [...history.slice(-49), feedback.annotations]);
    setRedo([]);
    setFeedback((value) => ({ ...value, annotations: next }));
  };
  const changeMode = (next: Mode) => {
    if (busy) return;
    setMode(next);
    setMenu(false);
    setError(null);
    if (
      next === "inpaint" ||
      next === "variation" ||
      next === "erase" ||
      next === "history"
    )
      setLegacyTab(next);
    if (next === "resize" && size && mode !== "resize") {
      setTarget(size);
      setCrop({ left: 0, top: 0, ...size });
      setFrame({ left: 0, top: 0, ...size });
    }
    if (next === "share")
      void act(async () =>
        setShares(await imageRequest<Share[]>(`${base}/shares`)),
      );
  };
  const submit = async (params: Record<string, unknown>, transform = false) => {
    if (!size) throw new Error("原图尚未加载");
    if (pending.current && Object.keys(params).length) throw new Error("上一次提交尚未确认，请使用“重试原操作”继续处理");
    let graph = await fetchWorkflow(projectId);
    if (!pending.current) {
      const source = graph.nodes.find(
        (node) => node.payload.assetId === assetId,
      );
      if (!source) throw new Error("图片来源节点不存在");
      const toolId = crypto.randomUUID();
      const key = transform ? "transform_image" : "edit_design";
      const toolTitle = transform
        ? "调整图片尺寸"
        : params.intent === "outpaint"
          ? "AI 扩图"
          : params.intent === "feedback"
            ? "按意见修改"
            : "移除背景";
      setHasPending(true);
      pending.current = {
        toolId,
        mutationId: crypto.randomUUID(),
        executionMutationId: crypto.randomUUID(),
        operations: [
          {
            type: "add_node",
            node: {
              id: toolId,
              kind: "tool",
              type: key,
              title: toolTitle,
              payload: { toolKey: key, toolVersion: "1", params },
              x: source.x + 340,
              y: source.y + 160,
            },
          },
          {
            type: "add_edge",
            edge: {
              id: crypto.randomUUID(),
              sourceNodeId: source.id,
              targetNodeId: toolId,
              sourcePort: "out",
              targetPort: "source",
            },
          },
          ...graph.edges
            .filter(
              (edge) =>
                edge.targetNodeId ===
                  graph.edges.find((edge) => edge.targetNodeId === source.id)
                    ?.sourceNodeId &&
                edge.targetPort === "constraint" &&
                !transform,
            )
            .map((edge): WorkflowOperation => ({
              type: "add_edge",
              edge: {
                id: crypto.randomUUID(),
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: toolId,
                sourcePort: "out",
                targetPort: "constraint",
              },
            })),
        ],
      };
    }
    const request = pending.current;
    if (!graph.nodes.some((node) => node.id === request.toolId)) {
      graph = await patchWorkflow(projectId, {
        mode: "semantic",
        mutationId: request.mutationId,
        baseRevision: graph.revision,
        operations: request.operations,
      });
    }
    await executeWorkflowNode(
      projectId,
      request.toolId,
      await onEnsureConversation?.(),
      request.executionMutationId,
    );
    pending.current = null;
    setHasPending(false);
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
    svg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(imageAnnotationsSvg(feedback.annotations, canvas.width, canvas.height))}`;
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
  const addComment = () => {
    if (!comment.trim()) return;
    const value: ImageComment = {
      id: editingComment ?? crypto.randomUUID(),
      text: comment.trim(),
      point,
      annotationIds: feedback.annotations.map((a) => a.id),
    };
    setFeedback((old) => ({
      ...old,
      comments: editingComment
        ? old.comments.map((c) => (c.id === editingComment ? value : c))
        : [...old.comments, value],
    }));
    setSelected((old) => [...new Set([...old, value.id])]);
    setComment("");
    setPoint(null);
    setEditingComment(null);
  };
  const legacy =
    mode === "erase" ||
    mode === "inpaint" ||
    mode === "variation" ||
    mode === "history";
  return (
    <section
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="图片工作区"
      data-image-editing={mode !== "view" || busy}
      className={styles.workspace}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          if (!busy) {
            if (mode === "view") onClose();
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
        <a className={styles.saveStyle} href={`/${encodeURIComponent(projectId)}/studio?tab=styles&assetId=${encodeURIComponent(assetId)}`}>保存为款式</a>
        <div className={styles.menuAnchor}>
          <Button onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <WorkspaceIcon name="image" />图像<WorkspaceIcon name="chevron" />
          </Button>
          {menu ? (
            <div className={styles.menu}>
              <strong>{title}</strong>
              <span>
                {size ? `${size.width} × ${size.height}` : "正在加载原图"}
              </span>
              <button onClick={() => changeMode("history")}>版本历史</button>
              <button onClick={() => changeMode("export")}>更多导出选项</button>
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
          <select
            aria-label="缩放比例"
            value={zoom ?? "fit"}
            onChange={(e) =>
              setZoom(e.target.value === "fit" ? null : Number(e.target.value))
            }
          >
            <option value="fit">适合窗口</option>
            {[
              ...new Set([
                10,
                25,
                50,
                75,
                100,
                150,
                200,
                400,
                ...(zoom === null ? [] : [zoom]),
              ]),
            ]
              .sort((a, b) => a - b)
              .map((z) => (
                <option key={z} value={z}>
                  {Math.round(z)}%
                </option>
              ))}
          </select>
          <button
            disabled={busy}
            aria-label="下载原图"
            onClick={() => void act(() => download())}
          >
            <WorkspaceIcon name="download" /> <span>下载</span>
          </button>
          <Button onClick={() => changeMode("share")}><WorkspaceIcon name="share" />分享</Button>
          <IconButton disabled={busy} label="关闭图片工作区" onClick={onClose}>
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
          <button onClick={() => void act(() => submit({}))}>重试原操作</button>
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
              {task.title} ·{" "}
              {task.status === "failed"
                ? "处理失败，输入已保留"
                : task.status === "queued"
                  ? "排队中"
                  : "正在处理"}
            </span>
            {task.status === "failed" ? (
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
      <div className={styles.body}>
        <ImageViewer
          url={`${base}/content`}
          title={title}
          zoom={zoom}
          onZoom={setZoom}
          onSize={setImageSize}
          annotations={feedback.annotations}
          comments={feedback.comments}
          mode={feedbackLoaded ? mode : "view"}
          pen={pen}
          onAnnotation={(a) => annotations([...feedback.annotations, a])}
          onPoint={setPoint}
          frame={
            mode === "resize" && resizeKind === "outpaint" ? frame : undefined
          }
          onFrame={setFrame}
          crop={mode === "resize" && resizeKind === "crop" ? crop : undefined}
          onCrop={(value) => {
            setCrop(value);
            setTarget({ width: value.width, height: value.height });
          }}
        />
        {mode !== "view" &&
        !legacy &&
        mode !== "export" &&
        mode !== "details" ? (
          <aside className={styles.panel} aria-label="图片工具参数">
            <div className={styles.panelHeading}>
              <h2>{tools.find((t) => t.mode === mode)?.label ?? "分享图片"}</h2>
              <button
                disabled={busy}
                onClick={() => setMode("view")}
                aria-label="收起工具"
              >
                ×
              </button>
            </div>
            {mode === "annotate" ? (
              <>
                <label>
                  标注工具
                  <select
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
                  </select>
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
              <>
                <p>点击图片定位，或直接填写整图意见。</p>
                {point ? (
                  <div className={styles.row}>
                    <span>已选择图片位置</span>
                    <button onClick={() => setPoint(null)}>改为整图</button>
                  </div>
                ) : null}
                <textarea
                  aria-label="图片评论"
                  maxLength={2000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="例如：保留面料，将袖口收窄"
                />
                <button
                  disabled={!comment.trim() || !feedbackLoaded}
                  onClick={addComment}
                >
                  {editingComment ? "更新评论" : "添加评论"}
                </button>
                {feedback.comments.map((c, i) => (
                  <div className={styles.comment} key={c.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.id]
                              : selected.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {i + 1}. {c.text}
                    </label>
                    <div className={styles.row}>
                      <button
                        onClick={() => {
                          setComment(c.text);
                          setPoint(c.point);
                          setEditingComment(c.id);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          setFeedback({
                            ...feedback,
                            comments: feedback.comments.filter(
                              (v) => v.id !== c.id,
                            ),
                          });
                          setSelected(selected.filter((id) => id !== c.id));
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  disabled={busy || !feedbackLoaded || Boolean(comment)}
                  onClick={() =>
                    void act(async () => {
                      await save();
                      setNotice("评论已保存");
                    })
                  }
                >
                  保存评论
                </button>
                <button
                  className={styles.primary}
                  disabled={busy || !selected.length || Boolean(comment)}
                  onClick={() =>
                    void act(async () => {
                      const saved = await save();
                      await submit({
                        ...generationParams(),
                        intent: "feedback",
                        prompt:
                          "按照选定的修改意见调整服装，保留未要求修改的内容。",
                        feedbackRevision: saved.revision,
                        commentIds: selected,
                      });
                    })
                  }
                >
                  按选中意见修改
                </button>
              </>
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
                <label>
                  调整方式
                  <select
                    value={resizeKind}
                    onChange={(e) =>
                      setResizeKind(e.target.value as typeof resizeKind)
                    }
                  >
                    <option value="resize">缩放尺寸</option>
                    <option value="crop">裁剪并调整尺寸</option>
                    <option value="outpaint">AI 扩图</option>
                  </select>
                </label>
                {resizeKind === "outpaint" ? (
                  <>
                    <p>
                      拖动图片调整位置，拖动右下角扩展边界。原图区域会保留。
                    </p>
                    {(["width", "height", "left", "top"] as const).map(
                      (key) => (
                        <label key={key}>
                          {
                            {
                              width: "画布宽度",
                              height: "画布高度",
                              left: "原图左边距",
                              top: "原图上边距",
                            }[key]
                          }
                          <input
                            type="number"
                            min={0}
                            max={2048}
                            value={frame[key]}
                            onChange={(e) =>
                              setFrame({
                                ...frame,
                                [key]: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                    <p>
                      实际输出 {frame.width} × {frame.height}，边长为 16
                      的倍数；最长边 2048，至少 655360 像素。
                    </p>
                    <textarea
                      aria-label="扩图要求"
                      value={expandPrompt}
                      maxLength={1000}
                      onChange={(e) => setExpandPrompt(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    {resizeKind === "crop" ? (
                      <>
                        <label>
                          裁剪比例
                          <select
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
                          </select>
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
                <button
                  className={styles.primary}
                  disabled={busy || !size}
                  onClick={() =>
                    void act(async () => {
                      if (resizeKind === "outpaint") {
                        const parsed = imageOutpaintSchema.safeParse(frame);
                        if (!parsed.success)
                          throw new Error(
                            parsed.error.issues[0]?.message ?? "扩图尺寸不合法",
                          );
                        if (
                          !size ||
                          frame.left + size.width > frame.width ||
                          frame.top + size.height > frame.height
                        )
                          throw new Error("画布必须完整包含原图");
                        await submit({
                          ...generationParams(),
                          width: frame.width,
                          height: frame.height,
                          intent: "outpaint",
                          outpaint: frame,
                          prompt:
                            expandPrompt.trim() || "自然扩展背景，保留原图主体",
                        });
                      } else {
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
                      }
                    })
                  }
                >
                  {busy
                    ? "正在提交…"
                    : resizeKind === "outpaint"
                      ? "生成扩图版本"
                      : "保存为新版本"}
                </button>
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
                    <button
                      onClick={() =>
                        void act(async () => {
                          await navigator.clipboard.writeText(shareUrl);
                          setNotice("链接已复制");
                        })
                      }
                    >
                      复制链接
                    </button>
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
            <button className={styles.back} onClick={() => setMode("view")}>
              ← 返回图片
            </button>
            <LegacyAssetTools
              initialTab={legacyTab}
              embedded
              open
              assetId={assetId}
              projectId={projectId}
              onClose={() => setMode("view")}
              onGraphRefresh={onGraphRefresh}
              {...(onEnsureConversation ? { onEnsureConversation } : {})}
            />
          </div>
        ) : null}
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
      {siblings.length > 1 ? (
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
      ) : null}
      <nav className={styles.toolbar} data-surface="inverse" aria-label="图片工具">
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
