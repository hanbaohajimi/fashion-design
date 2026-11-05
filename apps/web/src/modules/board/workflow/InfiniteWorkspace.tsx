"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  getSnapshot,
  loadSnapshot,
  toRichText,
  Tldraw,
  useEditor,
  useValue,
  type Editor,
  type TLAnyShapeUtilConstructor,
  type TLShape,
  type TLShapeId,
  type TLStoreSnapshot,
} from "tldraw";
import {
  readSwatchColors,
  type CanvasCommand,
  type CanvasDocumentView,
  type CanvasSave,
} from "@fashion/shared";
import { usePersistentDraft } from "../../../components/drafts/use-persistent-draft";
import { boardShapeUtils } from "../shapes";
import { createSwatchColor } from "../shapes/swatch-colors";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  waitForThumbnail,
} from "../file-upload-api";
import { CanvasInteractionContext } from "./canvas-interaction-context";
import {
  CanvasApiError,
  fetchCanvas,
  initializeCanvas,
  runCanvasCommand,
  saveCanvas,
} from "./canvas-api";
import {
  fetchWorkflow,
  type WorkflowGraph,
  type WorkflowNode,
} from "./workflow-api";
import { nodeImageUrl } from "./workflow-graph";
import styles from "./infinite-workspace.module.css";

export interface InfiniteWorkspaceHandle {
  flush: () => Promise<void>;
  flushLayout: () => Promise<void>;
  hasUnsaved: () => boolean;
  locate: (nodeId: string) => void;
  removePlacement: (nodeId: string) => void;
  refresh: () => Promise<void>;
  resolveReferences: (ids: readonly string[]) => string[];
}
interface Props {
  projectId: string;
  graph: WorkflowGraph;
  active: boolean;
  onGraph: (graph: WorkflowGraph) => void;
  onEditor: (editor: Editor | null) => void;
  onReady: (handle: InfiniteWorkspaceHandle | null) => void;
  onSelection: (nodeIds: string[]) => void;
  onOpen: (nodeId: string) => void;
  onError: (error: string | null) => void;
  onSaveStatus: (status: string) => void;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const utils = [
  ...defaultShapeUtils,
  ...boardShapeUtils,
] as TLAnyShapeUtilConstructor[];
export function InfiniteWorkspace(props: Props) {
  const store = useMemo(
    () =>
      createTLStore({ shapeUtils: utils, bindingUtils: defaultBindingUtils }),
    [],
  );
  const licenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
  return (
    <CanvasInteractionContext.Provider
      value={{
        open: (shapeId) => {
          const shape = store.get(shapeId);
          const nodeId =
            shape?.typeName === "shape" ? shape.meta.canvasNodeId : null;
          if (typeof nodeId === "string") props.onOpen(nodeId);
        },
      }}
    >
      <div
        className={styles.workspace}
        aria-label="无限白板"
        hidden={!props.active}
      >
        <Tldraw
          store={store}
          shapeUtils={[...boardShapeUtils]}
          hideUi
          locale="zh-cn"
          options={{ createTextOnCanvasDoubleClick: false }}
          {...(licenseKey ? { licenseKey } : {})}
        >
          <WorkspaceDocument {...props} />
        </Tldraw>
      </div>
    </CanvasInteractionContext.Provider>
  );
}

/** A frame/group is expanded only for explicit selection. It never creates graph edges. */
export function selectedMaterialShapes(editor: Editor): TLShape[] {
  const result = new Map<TLShapeId, TLShape>();
  const visit = (id: TLShapeId) => {
    const shape = editor.getShape(id);
    if (!shape) return;
    if (
      shape.type === "group" ||
      shape.type === "frame" ||
      shape.type === "fashion-frame"
    ) {
      for (const child of editor.getSortedChildIdsForParent(id)) visit(child);
    } else result.set(id, shape);
  };
  editor.getSelectedShapeIds().forEach(visit);
  return [...result.values()];
}

function projection(node: WorkflowNode) {
  const payload = node.payload;
  const url = nodeImageUrl(node);
  if (url || ["candidate", "reference_image", "sketch"].includes(node.type))
    return {
      type: "fashion-image" as const,
      props: {
        w: 320,
        h: 380,
        role: node.type === "candidate" ? "garment_ref" : "style_ref",
        title: node.title,
        url,
        ...(typeof payload.assetId === "string"
          ? { assetId: payload.assetId }
          : {}),
        ...(typeof payload.fileAssetId === "string"
          ? { fileId: payload.fileAssetId }
          : {}),
      },
    };
  if (node.type === "swatch") {
    const colors = readSwatchColors(payload, node.title).map((color) =>
      createSwatchColor(color.hex, color.name),
    );
    return {
      type: "fashion-swatch" as const,
      props: {
        w: Math.max(160, colors.length * 90),
        h: 180,
        color: colors[0]?.color ?? "#c8ab84",
        label: colors[0]?.label ?? node.title,
        role: "palette",
        colors,
      },
    };
  }
  return {
    type: "fashion-note" as const,
    props: {
      w: 280,
      h: 220,
      role: "note",
      text: String(payload.text ?? payload.summary ?? node.title),
      tone: "#f2d978",
    },
  };
}
function materialContent(
  shape: TLShape,
  editor?: Editor,
): {
  materialType: "reference_text" | "swatch";
  title: string;
  payload: Record<string, unknown>;
} | null {
  if (shape.type === "text" && editor) {
    const text = editor.getShapeUtil(shape).getText(shape) ?? "";
    return {
      materialType: "reference_text",
      title: text.slice(0, 40) || "文字素材",
      payload: { text },
    };
  }
  if (shape.type === "fashion-note")
    return {
      materialType: "reference_text",
      title: shape.props.text.slice(0, 40) || "文字素材",
      payload: { text: shape.props.text },
    };
  if (shape.type === "fashion-swatch")
    return {
      materialType: "swatch",
      title: shape.props.label || "色卡",
      payload: {
        color: shape.props.color,
        colors: (shape.props.colors ?? []).map((color) => ({
          hex: color.color,
          name: color.label,
        })),
      },
    };
  return null;
}
// Position, rotation, parent and scale are presentation, never design input changes.
function strokeContent(shape: TLShape) {
  if (shape.type !== "draw") return null;
  const { segments, color, fill, dash, size, isPen, isClosed } = shape.props;
  return { version: 1, segments, color, fill, dash, size, isPen, isClosed };
}
function WorkspaceDocument(props: Props) {
  const editor = useEditor();
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  }, [props]);
  const { active, onEditor } = props;
  const document = useRef<CanvasDocumentView | null>(null);
  const bindings = useRef(new Map<string, string>());
  const pendingLocation = useRef<string | null>(null);
  const referenceInstances = useRef(new Map<string, string[]>());
  const materialBaselines = useRef(new Map<string, string>());
  const pendingMaterials = useRef(
    new Map<string, { signature: string; command: CanvasCommand }>(),
  );
  const captureTargets = useRef(new Set<string>());
  const selectionWork = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef(Promise.resolve());
  const savingPacket = useRef<CanvasSave | null>(null);
  const sequence = useRef(0);
  const persisted = useRef(0);
  const [ready, setReady] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState("正在载入白板…");
  useEffect(() => live.current.onSaveStatus(status), [status]);
  const [draftValue, setDraftValue] = useState<Record<string, unknown>>({});
  const [baseline, setBaseline] = useState("{}");
  const restore = useCallback(
    (snapshot: Record<string, unknown>) => {
      loadSnapshot(editor.store, snapshot as unknown as TLStoreSnapshot);
      for (const shape of editor.getCurrentPageShapes())
        if (typeof shape.meta.canvasNodeId === "string")
          bindings.current.set(shape.id, shape.meta.canvasNodeId);
      sequence.current++;
      setDraftValue(snapshot);
    },
    [editor],
  );
  const draft = usePersistentDraft({
    value: draftValue,
    restore,
    baseline,
    objectKey: "infinite-canvas",
    enabled: ready,
  });
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const project = useCallback(
    (data: CanvasDocumentView, graph: WorkflowGraph, load = false) => {
      const remoteChanged =
        document.current &&
        JSON.stringify(data.snapshot.document ?? data.snapshot.store) !==
          JSON.stringify(
            document.current.snapshot.document ??
              document.current.snapshot.store,
          );
      if (!load && remoteChanged && sequence.current !== persisted.current)
        throw new Error("其他窗口已修改白板，本机草稿已保留，请核对后重新载入");
      if (!load && remoteChanged)
        loadSnapshot(editor.store, {
          document: data.snapshot.document,
        } as unknown as TLStoreSnapshot);
      if (load && (data.snapshot.document || data.snapshot.store))
        loadSnapshot(editor.store, data.snapshot as unknown as TLStoreSnapshot);
      if (load && Array.isArray(data.snapshot.legacyRecords)) {
        const records = data.snapshot.legacyRecords.map(object);
        const ids = new Set(records.map((record) => record.id));
        editor.createShapes(
          records.map((record) => ({
            ...record,
            parentId: ids.has(record.parentId)
              ? record.parentId
              : editor.getCurrentPageId(),
          })) as Parameters<Editor["createShapes"]>[0],
        );
      }
      document.current = data;
      setCanEdit(data.canEdit);
      editor.updateInstanceState({ isReadonly: false });
      editor.store.mergeRemoteChanges(() => {
        for (const binding of data.bindings) {
          if (binding.removed) continue;
          const node = graph.nodes.find((item) => item.id === binding.nodeId);
          if (!node) continue;
          const id = binding.shapeId as TLShapeId;
          const known = bindings.current.has(id);
          bindings.current.set(id, node.id);
          const existing = editor.getShape(id);
          const material = projection(node);
          if (!existing && (load || !known || remoteChanged)) {
            const count = editor.getCurrentPageShapes().length;
            const hint = object(object(data.snapshot.placementHints)[id]);
            editor.createShape({
              id,
              ...material,
              x: typeof hint.x === "number" ? hint.x : (count % 4) * 380,
              y:
                typeof hint.y === "number"
                  ? hint.y
                  : Math.floor(count / 4) * 460,
              meta: { canvasNodeId: node.id },
            });
          } else if (existing) {
            const current = strokeContent(existing) ?? materialContent(existing, editor);
            const unchanged =
              !current ||
              !materialBaselines.current.has(id) ||
              JSON.stringify(current) === materialBaselines.current.get(id);
            if (unchanged && existing.type === material.type) {
              editor.updateShape({
                id,
                type: material.type,
                props: {
                  ...material.props,
                  w: object(existing.props).w,
                  h: object(existing.props).h,
                },
                meta: { ...existing.meta, canvasNodeId: node.id },
              } as Parameters<Editor["updateShape"]>[0]);
              const updated = editor.getShape(id);
              if (updated)
                materialBaselines.current.set(
                  id,
                  JSON.stringify(materialContent(updated, editor)),
                );
            } else if (
              unchanged &&
              existing.type === "text" &&
              material.type === "fashion-note"
            ) {
              editor.updateShape({
                id,
                type: "text",
                props: { richText: toRichText(material.props.text) },
                meta: { ...existing.meta, canvasNodeId: node.id },
              });
              materialBaselines.current.set(
                id,
                JSON.stringify(materialContent(editor.getShape(id) ?? existing, editor)),
              );
            } else if (unchanged && existing.type === "draw" && material.type === "fashion-image" && existing.meta.canvasFileAssetId && existing.meta.canvasFileAssetId !== node.payload.fileAssetId) {
              // A subsequent edit in the sketch panel produces a new image version.
              // Keep the original editable stroke record alongside its displayed projection.
              const bounds = editor.getShapeGeometry(existing).bounds;
              const selected = editor.getSelectedShapeIds().includes(id);
              editor.deleteShape(id);
              editor.createShape({ id, ...material, x: existing.x, y: existing.y, rotation: existing.rotation, parentId: existing.parentId, index: existing.index, props: { ...material.props, w: Math.max(1, bounds.w), h: Math.max(1, bounds.h) }, meta: { ...existing.meta, originalCanvasStroke: JSON.parse(JSON.stringify(existing)), canvasNodeId: node.id, canvasFileAssetId: String(node.payload.fileAssetId ?? "") } });
              if (selected) editor.select(id);
              materialBaselines.current.set(id, JSON.stringify(materialContent(editor.getShape(id) ?? existing, editor)));
            } else if (existing.meta.canvasNodeId !== node.id || existing.type === "draw" && !existing.meta.canvasFileAssetId)
              editor.updateShape({
                id,
                type: existing.type,
                meta: { ...existing.meta, canvasNodeId: node.id, ...(existing.type === "draw" ? { canvasFileAssetId: String(node.payload.fileAssetId ?? "") } : {}) },
              });
          }
          const shape = editor.getShape(id);
          if (shape && !materialBaselines.current.has(id))
            materialBaselines.current.set(
              id,
              JSON.stringify(
                strokeContent(shape) ?? materialContent(shape, editor),
              ),
            );
        }
      });
      editor.updateInstanceState({ isReadonly: !data.canEdit });
      if (pendingLocation.current) {
        const placed = editor
          .getCurrentPageShapes()
          .find(
            (shape) =>
              bindings.current.get(shape.id) === pendingLocation.current,
          );
        if (placed) {
          pendingLocation.current = null;
          editor.select(placed.id);
          editor.zoomToSelection();
        }
      }
      if (load) {
        const snapshot = object(getSnapshot(editor.store));
        setBaseline(JSON.stringify(snapshot));
        setDraftValue(snapshot);
      }
    },
    [editor],
  );

  const flush = useCallback(async () => {
    const work = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (!document.current?.canEdit) return;
        for (const shape of editor.getCurrentPageShapes()) {
          const content = materialContent(shape, editor);
          const stroke = strokeContent(shape);
          if (!content && !stroke) continue;
          let nodeId = bindings.current.get(shape.id);
          if (
            !nodeId &&
            typeof shape.meta.canvasNodeId === "string" &&
            live.current.graph.nodes.some(
              (node) => node.id === shape.meta.canvasNodeId,
            )
          ) {
            nodeId = shape.meta.canvasNodeId;
            bindings.current.set(shape.id, nodeId);
          }
          const signature = JSON.stringify(stroke ?? content);
          if (nodeId && !materialBaselines.current.has(shape.id)) {
            const sibling = [...bindings.current].find(
              ([id, bound]) =>
                id !== shape.id &&
                bound === nodeId &&
                materialBaselines.current.get(id) === signature,
            );
            if (sibling) materialBaselines.current.set(shape.id, signature);
          }
          if (
            nodeId &&
            materialBaselines.current.get(shape.id) === signature &&
            !pendingMaterials.current.has(shape.id)
          )
            continue;
          if (stroke && !nodeId && !captureTargets.current.has(shape.id))
            continue;
          const node = live.current.graph.nodes.find(
            (item) => item.id === nodeId,
          );
          let pending = pendingMaterials.current.get(shape.id);
          if (!pending) {
            let material: {
              materialType: "reference_text" | "swatch" | "sketch";
              title: string;
              payload: Record<string, unknown>;
            } | null = content;
            if (stroke) {
              const { blob, width, height } = await editor.toImage([shape.id], {
                format: "png",
                background: true,
                scale: 1,
              });
              const file = new File([blob], "白板草图.png", {
                type: "image/png",
              });
              const signed = await signImageUpload(
                live.current.projectId,
                file,
              );
              const processing = signed.upload
                ? await putOriginal(signed.upload, file).then(() =>
                    completeUpload(signed.file.id),
                  )
                : signed.file;
              const uploaded = await waitForThumbnail(
                signed.file.id,
                processing,
              );
              material = {
                materialType: "sketch",
                title: "白板草图",
                payload: {
                  fileAssetId: uploaded.id,
                  imageUrl:
                    uploaded.thumbnail1024Url ?? uploaded.thumbnail256Url,
                  canvasStrokeVersion: stroke,
                  sketchDocument: {
                    version: 1,
                    width: Math.min(4096, Math.max(1, Math.round(width))),
                    height: Math.min(4096, Math.max(1, Math.round(height))),
                    baseFileAssetId: uploaded.id,
                    strokes: [],
                  },
                },
              };
            }
            if (!material) continue;
            pending = {
              signature,
              command: nodeId
                ? {
                    type: "update_material",
                    mutationId: crypto.randomUUID(),
                    nodeId,
                    shapeId: shape.id,
                    payload: { ...node?.payload, ...material.payload },
                    title: material.title,
                  }
                : {
                    type: "create_material",
                    mutationId: crypto.randomUUID(),
                    shapeId: shape.id,
                    ...material,
                  },
            };
            pendingMaterials.current.set(shape.id, pending);
          }
          const response = await runCanvasCommand(
            live.current.projectId,
            pending.command,
          );
          bindings.current.set(shape.id, response.nodeId);
          materialBaselines.current.set(shape.id, pending.signature);
          pendingMaterials.current.delete(shape.id);
          captureTargets.current.delete(shape.id);
          editor.store.mergeRemoteChanges(() =>
            editor.updateShape({
              id: shape.id,
              type: shape.type,
              meta: { ...shape.meta, canvasNodeId: response.nodeId, ...(shape.type === "draw" ? { canvasFileAssetId: String(response.graph.nodes.find(node => node.id === response.nodeId)?.payload.fileAssetId ?? "") } : {}) },
            }),
          );
          document.current = response.canvas;
          live.current.onGraph(response.graph);
        }
        const capturedSequence = sequence.current;
        const snapshot = object(getSnapshot(editor.store));
        if (
          sequence.current === persisted.current &&
          !savingPacket.current &&
          JSON.stringify(snapshot.document) ===
            JSON.stringify(document.current.snapshot.document)
        )
          return;
        const acknowledge =
          await draftRef.current.captureAcknowledgement(snapshot);
        const packet = savingPacket.current ?? {
          mutationId: crypto.randomUUID(),
          baseRevision: document.current.revision,
          snapshot,
          bindings: editor.getCurrentPageShapes().flatMap((shape) => {
            const nodeId =
              bindings.current.get(shape.id) ??
              (typeof shape.meta.canvasNodeId === "string"
                ? shape.meta.canvasNodeId
                : null);
            return nodeId ? [{ shapeId: shape.id, nodeId }] : [];
          }),
        };
        savingPacket.current = packet;
        setStatus("正在保存…");
        try {
          const saved = await saveCanvas(live.current.projectId, packet);
          document.current = saved;
          savingPacket.current = null;
          // A replay may contain an older snapshot; only acknowledge that exact capture.
          if (JSON.stringify(packet.snapshot) === JSON.stringify(snapshot)) {
            persisted.current = capturedSequence;
            await acknowledge();
          }
          setBaseline(JSON.stringify(saved.snapshot));
          setStatus("已保存");
        } catch (error) {
          setStatus(
            error instanceof CanvasApiError && error.status === 409
              ? "存在保存冲突，草稿已保留"
              : "保存未完成，草稿已保留",
          );
          throw error;
        }
      });
    queue.current = work;
    await work;
  }, [editor]);

  useEffect(() => {
    let active = true;
    void initializeCanvas(props.projectId)
      .then(async (data) => {
        const graph =
          data.initializedFrom === "legacy"
            ? await fetchWorkflow(props.projectId)
            : live.current.graph;
        if (!active) return;
        project(data, graph, true);
        live.current.onGraph(graph);
        setReady(true);
        setStatus(data.canEdit ? "已保存" : "只读");
        if (editor.getCurrentPageShapes().length) {
          editor.zoomToFit();
          if (editor.getZoomLevel() > 1) {
            const center = editor.getViewportPageBounds().center;
            const viewport = editor.getViewportScreenBounds();
            editor.setCamera({
              x: viewport.w / 2 - center.x,
              y: viewport.h / 2 - center.y,
              z: 1,
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (active)
          live.current.onError(
            error instanceof Error ? error.message : "白板载入失败",
          );
      });
    return () => {
      active = false;
    };
  }, [editor, project, props.projectId]);

  useEffect(() => {
    if (!ready) return;
    const refresh = async () => {
      const data = await fetchCanvas(live.current.projectId);
      project(data, live.current.graph);
    };
    const locate = (nodeId: string) => {
      const shape = editor
        .getCurrentPageShapes()
        .find((item) => bindings.current.get(item.id) === nodeId);
      if (shape) {
        editor.select(shape.id);
        editor.zoomToSelection();
      } else if (
        document.current?.bindings.some(
          (binding) => binding.nodeId === nodeId && binding.removed,
        )
      )
        live.current.onOpen(nodeId);
      else pendingLocation.current = nodeId;
    };
    live.current.onReady({
      flushLayout: flush,
      hasUnsaved: () =>
        sequence.current !== persisted.current || savingPacket.current !== null,
      flush: async () => {
        await selectionWork.current;
        await flush();
      },
      refresh,
      locate,
      resolveReferences: (ids) => [
        ...new Set(
          ids.flatMap((id) => {
            const instances = referenceInstances.current.get(id);
            return instances?.length
              ? instances.map((shapeId) => bindings.current.get(shapeId) ?? id)
              : [id];
          }),
        ),
      ],
      removePlacement: (nodeId) => {
        const selected = editor
          .getSelectedShapes()
          .filter((shape) => bindings.current.get(shape.id) === nodeId);
        editor.deleteShapes(
          selected.length
            ? selected.map((shape) => shape.id)
            : editor
                .getCurrentPageShapes()
                .filter((shape) => bindings.current.get(shape.id) === nodeId)
                .slice(0, 1)
                .map((shape) => shape.id),
        );
      },
    });
    return () => live.current.onReady(null);
  }, [editor, flush, project, ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void fetchCanvas(props.projectId)
      .then((data) => {
        if (active) project(data, props.graph);
      })
      .catch((error: unknown) => live.current.onError(String(error)));
    return () => {
      active = false;
    };
  }, [project, props.graph, props.projectId, ready]);
  useEffect(() => {
    if (!ready || !active) return;
    onEditor(editor);
    editor.updateViewportScreenBounds(editor.getContainer());
    return () => onEditor(null);
  }, [editor, active, onEditor, ready]);
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout>;
    const unlisten = editor.store.listen(
      () => {
        sequence.current++;
        clearTimeout(timer);
        setStatus("尚未保存");
        timer = setTimeout(() => {
          setDraftValue(object(getSnapshot(editor.store)));
          void flush().catch((error: unknown) =>
            live.current.onError(String(error)),
          );
        }, 700);
      },
      { source: "user", scope: "document" },
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sequence.current !== persisted.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearTimeout(timer);
      unlisten();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [editor, flush, ready]);

  const selectionKey = useValue(
    "canvas-selection",
    () => editor.getSelectedShapeIds().slice().sort().join("|"),
    [editor],
  );
  const selectionIdle = useValue(
    "canvas-selection-idle",
    () => editor.isIn("select.idle"),
    [editor],
  );
  const selectionEpoch = useRef(0);
  useEffect(() => {
    if (!selectionKey || !ready || !props.active || !selectionIdle) return;
    const epoch = ++selectionEpoch.current;
    let canceled = false;
    let release: () => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    selectionWork.current = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    void selectionWork.current.catch(() => undefined);
    let started = false;
    const timer = setTimeout(() => {
      started = true;
      const work = (async () => {
        const shapes = selectedMaterialShapes(editor);
        const distinct = new Set(
          shapes
            .filter((shape) => bindings.current.has(shape.id))
            .map((shape) => bindings.current.get(shape.id)),
        );
        const unbound = shapes.filter(
          (shape) =>
            !bindings.current.has(shape.id) &&
            ["draw", "text", "fashion-note", "fashion-swatch"].includes(
              shape.type,
            ),
        );
        if (distinct.size + unbound.length > 16)
          throw new Error("每次最多引用 16 项，请减少选择后再发送。");
        for (const shape of shapes)
          if (shape.type === "draw") captureTargets.current.add(shape.id);
        await flush();
        const ids = new Set<string>();
        for (const shape of shapes) {
          const nodeId = bindings.current.get(shape.id);
          if (nodeId) ids.add(nodeId);
        }
        if (!canceled && epoch === selectionEpoch.current && ids.size) {
          referenceInstances.current = new Map(
            [...ids].map((id) => [
              id,
              shapes
                .filter((shape) => bindings.current.get(shape.id) === id)
                .map((shape) => shape.id),
            ]),
          );
          live.current.onSelection([...ids]);
        }
      })();
      void work.then(release, (error: unknown) => {
        fail(error);
        live.current.onError(
          error instanceof Error ? error.message : "所选素材尚未保存",
        );
      });
    }, 160);
    return () => {
      clearTimeout(timer);
      canceled = true;
      if (!started) release();
    };
  }, [editor, flush, props.active, ready, selectionIdle, selectionKey]);

  const open = useCallback((shapeId: TLShapeId) => {
    const nodeId = bindings.current.get(shapeId);
    if (nodeId) live.current.onOpen(nodeId);
  }, []);
  // Shape utilities render in the editor's React tree; expose the current detail handler.
  useEffect(() => {
    const onDouble = (event: MouseEvent) => {
      if ((event.target as Element).closest("button,textarea,input")) return;
      const id = editor.getOnlySelectedShapeId();
      if (id && bindings.current.has(id)) open(id);
    };
    const container = editor.getContainer();
    container.addEventListener("dblclick", onDouble);
    return () => container.removeEventListener("dblclick", onDouble);
  }, [editor, open]);
  return (
    <>
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label="白板工具"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {(
          [
            ["select", "选择"],
            ["hand", "平移"],
            ["draw", "手绘"],
            ["text", "文字"],
            ["frame", "画框"],
          ] as const
        ).map(([tool, label]) => (
          <button
            key={tool}
            type="button"
            disabled={
              !ready || (!canEdit && tool !== "hand" && tool !== "select")
            }
            onClick={() => editor.setCurrentTool(tool)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => {
            const id = createShapeId();
            const center = editor.getViewportPageBounds().center;
            editor.createShape({
              id,
              type: "fashion-note",
              x: center.x,
              y: center.y,
            });
            editor.select(id);
          }}
        >
          便签
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => editor.groupShapes(editor.getSelectedShapeIds())}
        >
          分组
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => editor.ungroupShapes(editor.getSelectedShapeIds())}
        >
          解除分组
        </button>
        <button type="button" disabled={!canEdit} onClick={() => editor.undo()}>
          撤销
        </button>
        <button type="button" disabled={!canEdit} onClick={() => editor.redo()}>
          重做
        </button>
        <button type="button" onClick={() => editor.zoomToFit()}>
          查看全部
        </button>
      </div>
      <div className={styles.status} role="status">
        {status}
        {status.includes("未完成") ? (
          <button
            type="button"
            onClick={() =>
              void flush().catch((error: unknown) =>
                live.current.onError(String(error)),
              )
            }
          >
            重试保存
          </button>
        ) : null}
        {status.includes("冲突") ? (
          <button
            type="button"
            onClick={() =>
              void (async () => {
                await queue.current.catch(() => undefined);
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(getSnapshot(editor.store))], {
                    type: "application/json",
                  }),
                );
                const link = window.document.createElement("a");
                link.href = url;
                link.download = `白板草稿-${props.projectId}.json`;
                link.click();
                URL.revokeObjectURL(url);
                const data = await fetchCanvas(props.projectId);
                const graph = await fetchWorkflow(props.projectId);
                bindings.current.clear();
                materialBaselines.current.clear();
                pendingMaterials.current.clear();
                savingPacket.current = null;
                project(data, graph, true);
                persisted.current = sequence.current;
                setStatus("已载入最新版本");
                live.current.onGraph(graph);
              })().catch((error: unknown) =>
                live.current.onError(String(error)),
              )
            }
          >
            导出草稿并载入最新
          </button>
        ) : null}
      </div>
    </>
  );
}
