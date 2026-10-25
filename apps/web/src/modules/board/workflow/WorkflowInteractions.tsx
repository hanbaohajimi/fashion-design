"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useEditor, useValue, type Editor } from "tldraw";
import { workflowInputPorts } from "@fashion/shared";
import type { WorkflowGraph, WorkflowInputPort } from "./workflow-api";
import { planInputEdit, type InputEdit } from "./workflow-editing";
import { nodeSize } from "./workflow-graph";
import { curvePath } from "./workflow-curve";
import styles from "./workflow-connections.module.css";

type Side = "input" | "output";
interface Gesture {
  nodeId: string;
  side: Side;
  edgeId?: string;
  clientX: number;
  clientY: number;
}
interface InteractionContext {
  gesture: Gesture | null;
  hoveredNodeId: string | null;
  setNodeHovered: (nodeId: string, hovered: boolean) => void;
  selectedEdgeId: string | null;
  hint: (
    nodeId: string,
    side: Side,
  ) => { valid: boolean; label: string } | null;
  portDown: (nodeId: string, side: Side, event: ReactPointerEvent) => void;
  portUp: (event: ReactPointerEvent) => void;
  portClick: (nodeId: string, side: Side, keyboard?: boolean) => void;
  details: (nodeId: string) => void;
  selectEdge: (edgeId: string) => void;
  reconnect: (edgeId: string, event?: ReactPointerEvent) => void;
  disconnect: () => void;
  changePort: (port: WorkflowInputPort) => void;
  status: string;
}
const Context = createContext<InteractionContext | null>(null);
export const useWorkflowInteractions = () => useContext(Context);
const labels: Record<string, string> = {
  goal: "设计目标",
  reference: "参考素材",
  constraint: "设计约束",
  candidate: "候选方案",
  source: "原图",
};

export function WorkflowInteractionProvider({
  graph,
  editorRef,
  onEdit,
  onDetails,
  children,
}: {
  graph: WorkflowGraph;
  editorRef: RefObject<Editor | null>;
  onEdit: (edit: InputEdit) => Promise<void>;
  onDetails: (nodeId: string) => void;
  children: ReactNode;
}) {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const setNodeHovered = useCallback((nodeId: string, hovered: boolean) => {
    setHoveredNodeId((current) => hovered ? nodeId : current === nodeId ? null : current);
  }, []);
  useEffect(() => {
    const clear = () => setHoveredNodeId(null);
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreClick = useRef(false);
  useEffect(() => {
    const clear = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !editorRef.current?.getContainer().contains(target) ||
        target.closest(
          "[data-workflow-port],[data-workflow-edge],[aria-label='连接操作']",
        )
      )
        return;
      setSelectedEdgeId(null);
      setGesture(null);
      pointerStart.current = null;
    };
    window.addEventListener("pointerdown", clear, true);
    return () => window.removeEventListener("pointerdown", clear, true);
  }, [editorRef]);
  useEffect(() => {
    const details = (event: Event) => {
      const nodeId: unknown = (event as CustomEvent).detail;
      if (
        typeof nodeId === "string" &&
        graph.nodes.some((node) => node.id === nodeId)
      )
        onDetails(nodeId);
    };
    window.addEventListener("fashion-workflow:node-details", details);
    return () =>
      window.removeEventListener("fashion-workflow:node-details", details);
  }, [graph.nodes, onDetails]);
  const editFor = useCallback(
    (nodeId: string, side: Side): InputEdit | null => {
      if (!gesture || gesture.nodeId === nodeId || gesture.side === side)
        return null;
      return {
        targetId: side === "input" ? nodeId : gesture.nodeId,
        sourceId: side === "output" ? nodeId : gesture.nodeId,
        ...(gesture.edgeId ? { edgeId: gesture.edgeId } : {}),
      };
    },
    [gesture],
  );
  const hint = useCallback(
    (nodeId: string, side: Side) => {
      if (!gesture) return null;
      const edit = editFor(nodeId, side);
      if (!edit) return { valid: false, label: "请连接素材输出端与工具输入端" };
      try {
        const planned = planInputEdit(graph, edit);
        const port = planned.operations.findLast(
          (operation) => operation.type === "add_edge",
        );
        return {
          valid: true,
          label: `${port?.type === "add_edge" ? labels[port.edge.targetPort] : "输入"}${planned.branched ? " · 新分支" : ""}`,
        };
      } catch (cause) {
        return {
          valid: false,
          label: cause instanceof Error ? cause.message : "无法连接",
        };
      }
    },
    [editFor, gesture, graph],
  );
  const apply = useCallback(
    async (edit: InputEdit) => {
      if (submitting) return;
      setSubmitting(true);
      setGesture(null);
      try {
        await onEdit(edit);
        setSelectedEdgeId(null);
        setStatus("");
      } catch (cause) {
        setStatus(
          cause instanceof Error ? cause.message : "连接保存失败，请重试",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [onEdit, submitting],
  );
  const finish = useCallback(
    (nodeId: string, side: Side) => {
      const edit = editFor(nodeId, side);
      if (!edit) return;
      const result = hint(nodeId, side);
      if (!result?.valid) {
        setStatus(result?.label ?? "无法连接");
        setGesture(null);
        return;
      }
      void apply(edit);
    },
    [apply, editFor, hint],
  );
  const endPointer = useCallback(
    (event: { clientX: number; clientY: number }) => {
      if (!gesture) return;
      const start = pointerStart.current;
      pointerStart.current = null;
      const port = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-workflow-port]");
      const nodeId = port?.dataset.nodeId;
      const side = port?.dataset.workflowPort as Side | undefined;
      if (nodeId && side && nodeId !== gesture.nodeId) {
        ignoreClick.current = true;
        finish(nodeId, side);
      } else if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5
      ) {
        ignoreClick.current = true;
        setGesture(null);
        setStatus("");
      }
    },
    [finish, gesture],
  );
  useEffect(() => {
    if (!gesture) return;
    const move = (event: PointerEvent) =>
      setGesture((current) =>
        current
          ? { ...current, clientX: event.clientX, clientY: event.clientY }
          : null,
      );
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", endPointer);
    const cancel = () => {
      setGesture(null);
      pointerStart.current = null;
    };
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [endPointer, gesture]);
  const disconnect = useCallback(() => {
    const edge = graph.edges.find((item) => item.id === selectedEdgeId);
    if (edge) void apply({ targetId: edge.targetNodeId, edgeId: edge.id });
  }, [apply, graph.edges, selectedEdgeId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGesture(null);
        setSelectedEdgeId(null);
        setStatus("");
        pointerStart.current = null;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedEdgeId &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest("input,textarea,select,[contenteditable=true]")
        )
      ) {
        event.preventDefault();
        disconnect();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [disconnect, selectedEdgeId]);
  const value: InteractionContext = {
    gesture,
    hoveredNodeId: gesture ? null : hoveredNodeId,
    setNodeHovered,
    selectedEdgeId,
    hint,
    status: submitting ? "正在保存连接…" : status,
    details: onDetails,
    portUp: (event) => {
      event.stopPropagation();
      if (event.button === 0) endPointer(event);
    },
    portDown: (nodeId, side, event) => {
      event.stopPropagation();
      if (event.button !== 0 || submitting) return;
      ignoreClick.current = false;
      if (!gesture) {
        pointerStart.current = { x: event.clientX, y: event.clientY };
        setGesture({
          nodeId,
          side,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        setStatus("");
      }
    },
    portClick: (nodeId, side, keyboard) => {
      if (ignoreClick.current && !keyboard) {
        ignoreClick.current = false;
        return;
      }
      ignoreClick.current = false;
      if (gesture) finish(nodeId, side);
      else if (!submitting) {
        const shape = editorRef.current?.getShapePageBounds(
          `shape:workflow-node-${nodeId}` as Parameters<
            Editor["getShapePageBounds"]
          >[0],
        );
        const point = shape
          ? editorRef.current?.pageToScreen({
              x: side === "output" ? shape.maxX : shape.minX,
              y: shape.center.y,
            })
          : null;
        setGesture({
          nodeId,
          side,
          clientX: point?.x ?? 0,
          clientY: point?.y ?? 0,
        });
      }
    },
    selectEdge: (edgeId) => {
      setSelectedEdgeId(edgeId);
      setGesture(null);
      editorRef.current?.selectNone();
    },
    reconnect: (edgeId, event) => {
      event?.stopPropagation();
      const edge = graph.edges.find((item) => item.id === edgeId);
      if (!edge) return;
      const source = graph.nodes.find((node) => node.id === edge.sourceNodeId);
      if (source?.kind !== "asset") {
        setStatus("结果来源由工具执行维护");
        return;
      }
      if (event) pointerStart.current = { x: event.clientX, y: event.clientY };
      setGesture({
        nodeId: edge.targetNodeId,
        side: "input",
        edgeId,
        clientX: event?.clientX ?? 0,
        clientY: event?.clientY ?? 0,
      });
    },
    disconnect,
    changePort: (port) => {
      const edge = graph.edges.find((item) => item.id === selectedEdgeId);
      if (edge) void apply({ targetId: edge.targetNodeId, sourceId: edge.sourceNodeId, edgeId: edge.id, port });
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function WorkflowConnectionOverlay({ graph }: { graph: WorkflowGraph }) {
  const editor = useEditor();
  const interaction = useWorkflowInteractions();
  const gesture = interaction?.gesture;
  const preview = useValue(
    "workflow-wire-preview",
    () => {
      editor.getCamera();
      const viewport = editor.getViewportScreenBounds();
      if (!gesture) return null;
      const node = graph.nodes.find((item) => item.id === gesture.nodeId);
      if (!node) return null;
      const bounds = editor.getShapePageBounds(
        `shape:workflow-node-${node.id}` as Parameters<
          Editor["getShapePageBounds"]
        >[0],
      );
      const size = nodeSize(node);
      const anchor = editor.pageToScreen({
        x:
          gesture.side === "output"
            ? (bounds?.maxX ?? node.x + size.w)
            : (bounds?.minX ?? node.x),
        y: bounds?.center.y ?? node.y + size.h / 2,
      });
      const a =
        gesture.side === "output"
          ? { x: anchor.x, y: anchor.y }
          : { x: gesture.clientX, y: gesture.clientY };
      const b =
        gesture.side === "output"
          ? { x: gesture.clientX, y: gesture.clientY }
          : { x: anchor.x, y: anchor.y };
      return {
        x: a.x - viewport.x,
        y: a.y - viewport.y,
        d: curvePath(b.x - a.x, b.y - a.y).d,
      };
    },
    [editor, gesture, graph.nodes],
  );
  if (!interaction) return null;
  const edge = graph.edges.find(
    (item) => item.id === interaction.selectedEdgeId,
  );
  const editable =
    edge &&
    graph.nodes.find((node) => node.id === edge.sourceNodeId)?.kind ===
      "asset" &&
    graph.nodes.find((node) => node.id === edge.targetNodeId)?.type !==
      "restore_version";
  const source = graph.nodes.find((node) => node.id === edge?.sourceNodeId);
  const target = graph.nodes.find((node) => node.id === edge?.targetNodeId);
  const alternatePort = edge?.targetPort === "source" ? "reference" : edge?.targetPort === "reference" ? "source" : null;
  const canChangePort = editable && source && target?.type === "edit_design" && alternatePort && workflowInputPorts(source.type, target.type).includes(alternatePort);
  return (
    <>
      {preview ? (
        <svg aria-hidden="true" className={styles.preview}>
          <g transform={`translate(${preview.x} ${preview.y})`}>
            <path d={preview.d} />
          </g>
        </svg>
      ) : null}
      {gesture || interaction.status ? (
        <div className={styles.connectionHint} role="status">
          {interaction.status || "选择另一端的节点 · Esc 取消"}
        </div>
      ) : null}
      {edge && !gesture ? (
        <div
          aria-label="连接操作"
          className={styles.edgeToolbar}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>{editable ? labels[edge.targetPort] : "结果来源"}</span>
          {editable ? (
            <>
              {canChangePort && alternatePort ? <button onClick={() => interaction.changePort(alternatePort)} type="button">用作{labels[alternatePort]}</button> : null}
              <button
                onClick={() => interaction.reconnect(edge.id)}
                type="button"
              >
                更换输入
              </button>
              <button onClick={interaction.disconnect} type="button">
                断开连接
              </button>
            </>
          ) : (
            <small>由工具执行维护</small>
          )}
        </div>
      ) : null}
    </>
  );
}
