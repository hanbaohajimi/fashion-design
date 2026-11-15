import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { imageDisplayTitle } from "../image-display-title";
import {
  assistantShapeStamp,
  assistantCanvasEnvelopeSchema,
  assistantCanvasProofSchema,
  type AssistantCanvasEnvelope,
  type AssistantCanvasObservation,
  type AssistantCanvasProof,
  type CanvasDocumentView,
  type CanvasCreation,
  type CanvasCreationDraft,
} from "@fashion/shared";
import {
  AssistantCanvasApiError,
  claimCanvasAction,
  applyServerCanvasAction,
  finishCanvasAction,
} from "./assistant-canvas-api";
import type { WorkflowGraph } from "./workflow-api";

type Journal = { proof: AssistantCanvasProof; stage: "staged" | "applied" };
export class AssistantCanvasExecutor {
  readonly clientId: string;
  private sequence = 0;
  private active = true;
  private queue: Promise<void> = Promise.resolve();
  private flight = new Map<
    string,
    Promise<Awaited<ReturnType<typeof finishCanvasAction>>>
  >();
  private journal = new Map<string, Journal>();
  private readonly key: string;
  constructor(
    private readonly env: {
      editor: Editor;
      projectId: string;
      accountId: string;
      revision: () => number;
      flush: () => Promise<void>;
      applyResult: (canvas: CanvasDocumentView, graph: WorkflowGraph) => void;
      openPanel: (panel: string, actionId: string) => Promise<void>;
      checkConnection: (id: string, revision: number | undefined) => void;
      acceptCreation: (
        saved: CanvasCreation,
        baseline: CanvasCreationDraft,
      ) => Promise<void>;
    },
  ) {
    this.key = `fashion:assistant-canvas:${env.accountId}:${env.projectId}`;
    let saved: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(
        sessionStorage.getItem(this.key) ?? "{}",
      );
      if (value && typeof value === "object" && !Array.isArray(value))
        saved = value as Record<string, unknown>;
    } catch {
      /* Memory remains safe; a reload gets a new owner. */
    }
    const owner = assistantCanvasEnvelopeSchema.shape.clientId.safeParse(
      saved.clientId,
    );
    this.clientId = owner.success ? owner.data : crypto.randomUUID();
    if (owner.success && Array.isArray(saved.journal))
      for (const pair of saved.journal.slice(-50)) {
        if (
          !Array.isArray(pair) ||
          !assistantCanvasEnvelopeSchema.shape.id.safeParse(pair[0]).success ||
          !pair[1] ||
          typeof pair[1] !== "object"
        )
          continue;
        const value = pair[1] as Record<string, unknown>,
          proof = assistantCanvasProofSchema.safeParse(value.proof);
        if (
          proof.success &&
          (value.stage === "staged" || value.stage === "applied")
        )
          this.journal.set(String(pair[0]), {
            proof: proof.data,
            stage: value.stage,
          });
      }
    this.persist();
  }
  dispose() {
    this.active = false;
  }
  activate() {
    this.active = true;
  }
  private persist() {
    try {
      sessionStorage.setItem(
        this.key,
        JSON.stringify({
          clientId: this.clientId,
          journal: [...this.journal].slice(-50),
        }),
      );
    } catch {
      /* No automatic re-execution after an unowned reload. */
    }
  }
  observe(graph: WorkflowGraph): AssistantCanvasObservation {
    const editor = this.env.editor,
      selected = editor.getSelectedShapeIds();
    const viewport = editor.getViewportPageBounds();
    const visible = (id: TLShapeId) => {
      const box = editor.getShapePageBounds(id);
      return (
        box &&
        box.x < viewport.maxX &&
        box.maxX > viewport.x &&
        box.y < viewport.maxY &&
        box.maxY > viewport.y
      );
    };
    const shapes = [...editor.getCurrentPageShapes()].sort(
      (a, b) =>
        Number(selected.includes(b.id)) - Number(selected.includes(a.id)) ||
        Number(Boolean(visible(b.id))) - Number(Boolean(visible(a.id))),
    );
    const objects = shapes.slice(0, 200).flatMap((shape) => {
      const bounds = editor.getShapePageBounds(shape.id);
      if (!bounds) return [];
      const nodeId =
        typeof shape.meta.canvasNodeId === "string" && shape.meta.canvasNodeId
          ? shape.meta.canvasNodeId
          : null;
      const creationId =
        shape.type === "fashion-creation"
          ? String(shape.props.creationId)
          : null;
      const rawTitle = String("title" in shape.props ? shape.props.title : graph.nodes.find((node) => node.id === nodeId)?.title ?? ("label" in shape.props ? shape.props.label : shape.type));
      const picture = shape.type === "fashion-image" || shape.type === "image" || shape.type === "fashion-creation" && shape.props.module === "image";
      return [
        {
          id: shape.id,
          type: shape.type,
          title: (picture ? imageDisplayTitle(rawTitle) : rawTitle).slice(0, 200),
          nodeId,
          creationId,
          stamp: assistantShapeStamp(shape),
          locked: editor.isShapeOrAncestorLocked(shape),
          hidden: editor.isShapeHidden(shape),
          parentId: shape.parentId,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
        },
      ];
    });
    return {
      clientId: this.clientId,
      sequence: ++this.sequence,
      revision: this.env.revision(),
      selectedIds: selected.slice(0, 64),
      objects,
      omitted: shapes.length - objects.length,
      viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
    };
  }
  execute(envelope: AssistantCanvasEnvelope) {
    const existing = this.flight.get(envelope.id);
    if (existing) return existing;
    const work = this.queue.then(() => this.run(envelope));
    this.queue = work.then(
      () => undefined,
      () => undefined,
    );
    this.flight.set(envelope.id, work);
    void work
      .finally(() => this.flight.delete(envelope.id))
      .catch(() => undefined);
    return work;
  }
  private assertOwner(envelope: AssistantCanvasEnvelope) {
    if (
      !this.active ||
      envelope.projectId !== this.env.projectId ||
      envelope.clientId !== this.clientId
    )
      throw new Error("工作区已切换，请在原画布中继续核对。");
  }
  private proofMatches(proof: AssistantCanvasProof) {
    return (
      proof.shapes.every(
        (item) =>
          assistantShapeStamp(
            this.env.editor.getShape(item.id as TLShapeId),
          ) === item.stamp,
      ) &&
      proof.removedShapeIds.every(
        (id) => !this.env.editor.getShape(id as TLShapeId),
      )
    );
  }
  private refreshProof(proof: AssistantCanvasProof) {
    proof.shapes = proof.shapes.map((item) => ({
      id: item.id,
      stamp: assistantShapeStamp(
        this.env.editor.getShape(item.id as TLShapeId),
      ),
    }));
  }
  private async run(envelope: AssistantCanvasEnvelope) {
    this.assertOwner(envelope);
    const journal = this.journal.get(envelope.id);
    if (journal) {
      if (!this.proofMatches(journal.proof))
        throw new Error(
          "操作后的对象已有新修改，未重复应用旧操作。请重新发起请求。",
        );
      if (journal.stage === "staged") {
        await this.env.flush();
        this.refreshProof(journal.proof);
        journal.stage = "applied";
        this.persist();
      }
      return finishCanvasAction(envelope, "succeeded", journal.proof);
    }
    const claimed = await claimCanvasAction(envelope);
    const state = claimed.context?.canvasAction?.state;
    if (state === "succeeded" || state === "failed") return claimed;
    this.assertOwner(envelope);
    const editor = this.env.editor;
    const action = envelope.action;
    const proof: AssistantCanvasProof = { shapes: [], removedShapeIds: [] };
    let applied = false;
    let serverSubmitted = false;
    const container = editor.getContainer(),
      wasInert = container.inert;
    try {
      if (action.type === "open_panel") {
        await this.env.openPanel(action.panel, envelope.id);
        this.assertOwner(envelope);
        proof.panel = action.panel;
      } else {
        if (editor.getIsReadonly()) throw new Error("当前画布没有编辑权限。");
        if (editor.inputs.getIsPointing())
          throw new Error("画布正在交互，请结束拖动或绘制后继续。");
        editor.complete();
        editor.setCurrentTool("select");
        container.inert = true;
        await this.env.flush();
        this.assertOwner(envelope);
        if (
          "targetCreationId" in action &&
          !claimed.context?.canvasAction?.serverApplied
        )
          this.env.checkConnection(
            action.targetCreationId,
            envelope.targetRevision,
          );
        if (
          [
            "create_swatch",
            "update_swatch",
            "add_fabric",
            "connect_inputs",
            "disconnect_inputs",
          ].includes(action.type)
        ) {
          serverSubmitted = true;
          const result = await applyServerCanvasAction(envelope);
          this.assertOwner(envelope);
          if (result.canvas && result.graph)
            this.env.applyResult(result.canvas, result.graph);
          if (result.creation) {
            if (!envelope.targetDraft)
              throw new Error("缺少连接前的草稿快照，请重新读取目标。");
            await this.env.acceptCreation(
              result.creation,
              envelope.targetDraft,
            );
          }
          if (result.nodeId)
            proof.shapes = editor
              .getCurrentPageShapes()
              .filter((shape) => shape.meta.canvasNodeId === result.nodeId)
              .map((shape) => ({
                id: shape.id,
                stamp: assistantShapeStamp(shape),
              }));
          applied = true;
        } else {
          const ids =
            "shapeIds" in action ? (action.shapeIds as TLShapeId[]) : [];
          for (const id of ids) {
            const shape = editor.getShape(id),
              observed = envelope.observation.objects.find(
                (item) => item.id === id,
              );
            if (
              !shape ||
              !observed ||
              assistantShapeStamp(shape) !== observed.stamp ||
              editor.isShapeHidden(shape.id) ||
              editor.isShapeOrAncestorLocked(shape)
            )
              throw new Error("对象已变化、锁定或隐藏，未应用旧排版。");
          }
          const descendants = editor.getShapeAndDescendantIds(ids);
          if (descendants.size > 128)
            throw new Error("本次组合包含过多对象，请分批操作。");
          if (
            [...descendants].some((id) => {
              const shape = editor.getShape(id);
              return (
                !shape ||
                editor.isShapeHidden(id) ||
                editor.isShapeOrAncestorLocked(shape)
              );
            })
          )
            throw new Error("目标包含锁定或隐藏对象，未修改。");
          if (
            ids.some((id) => {
              const shape = editor.getShape(id);
              return shape && ids.includes(shape.parentId as TLShapeId);
            })
          )
            throw new Error("请只选择组合或其子对象，避免重复处理。");
          if (
            action.type === "resize_objects" &&
            ids.some((id) => {
              const bounds = editor.getShapePageBounds(id);
              return !bounds?.w || !bounds.h;
            })
          )
            throw new Error("对象没有可缩放范围。");
          const before = new Map(
            editor
              .getCurrentPageShapes()
              .map((shape) => [shape.id, assistantShapeStamp(shape)]),
          );
          if (
            editor
              .getCurrentPageShapes()
              .filter(
                (shape) =>
                  ids.includes(shape.id) ||
                  ids.includes(shape.parentId as TLShapeId),
              ).length > 128
          )
            throw new Error("本次组合包含过多对象，请分批操作。");
          const mark = editor.markHistoryStoppingPoint("助手画布操作");
          try {
            editor.run(() => {
              if (action.type === "move_objects")
                for (const id of ids) {
                  const shape = editor.getShape(id);
                  if (!shape) continue;
                  const zero = editor.getPointInParentSpace(shape, {
                      x: 0,
                      y: 0,
                    }),
                    delta = editor.getPointInParentSpace(shape, action.offset);
                  editor.updateShape({
                    id,
                    type: shape.type,
                    x: shape.x + delta.x - zero.x,
                    y: shape.y + delta.y - zero.y,
                  });
                }
              else if (action.type === "resize_objects")
                for (const id of ids) {
                  const bounds = editor.getShapePageBounds(id);
                  if (!bounds || !bounds.w || !bounds.h)
                    throw new Error("对象没有可缩放范围。");
                  const sx = action.width / bounds.w,
                    sy = action.height / bounds.h;
                  editor.resizeShape(id, {
                    x: action.keepAspectRatio ? Math.min(sx, sy) : sx,
                    y: action.keepAspectRatio ? Math.min(sx, sy) : sy,
                  });
                }
              else if (action.type === "align_objects")
                editor.alignShapes(ids, action.alignment);
              else if (action.type === "distribute_objects")
                editor.distributeShapes(ids, action.axis);
              else if (action.type === "group_objects") {
                if (
                  new Set(ids.map((id) => editor.getShape(id)?.parentId))
                    .size !== 1
                )
                  throw new Error("组合对象需处于同一层级。");
                editor.groupShapes(ids, {
                  groupId: createShapeId(`assistant-group-${envelope.id}`),
                  select: false,
                });
              } else if (action.type === "ungroup_objects") {
                if (ids.some((id) => editor.getShape(id)?.type !== "group"))
                  throw new Error("只能取消真实组合。");
                editor.ungroupShapes(ids, { select: false });
              } else if (action.type === "reorder_objects") {
                if (action.order === "front") editor.bringToFront(ids);
                else if (action.order === "back") editor.sendToBack(ids);
                else if (action.order === "forward") editor.bringForward(ids);
                else editor.sendBackward(ids);
              }
            });
          } catch (cause) {
            editor.bailToMark(mark);
            throw cause;
          }
          const after = editor.getCurrentPageShapes();
          proof.shapes = after
            .filter(
              (shape) =>
                ids.includes(shape.id) ||
                before.get(shape.id) !== assistantShapeStamp(shape),
            )
            .map((shape) => ({
              id: shape.id,
              stamp: assistantShapeStamp(shape),
            }));
          proof.removedShapeIds = [...before.keys()].filter(
            (id) => !editor.getShape(id),
          );
          applied = true;
        }
        this.journal.set(envelope.id, { proof, stage: "staged" });
        this.persist();
        await this.env.flush();
        this.assertOwner(envelope);
        this.refreshProof(proof);
      }
      this.journal.set(envelope.id, { proof, stage: "applied" });
      this.persist();
      return await finishCanvasAction(envelope, "succeeded", proof);
    } catch (cause) {
      if (applied && this.journal.get(envelope.id)?.stage === "staged") {
        this.refreshProof(proof);
        this.persist();
      }
      if (
        applied ||
        this.journal.has(envelope.id) ||
        !this.active ||
        (serverSubmitted &&
          !(
            cause instanceof AssistantCanvasApiError &&
            [400, 403, 404, 409, 422].includes(cause.status)
          ))
      )
        throw cause;
      return finishCanvasAction(
        envelope,
        "failed",
        { shapes: [], removedShapeIds: [] },
        cause instanceof Error ? cause.message : "操作未完成。",
      );
    } finally {
      container.inert = wasInert;
    }
  }
}

export function waitForCanvasPanel(selector: string, timeout = 5000) {
  return new Promise<void>((resolve, reject) => {
    const visible = () =>
      [...document.querySelectorAll<HTMLElement>(selector)].some(
        (item) =>
          item.getClientRects().length > 0 && !item.closest("[hidden],[inert]"),
      );
    if (visible()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (visible()) {
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("界面尚未确认打开，请稍后再试。"));
    }, timeout);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}
