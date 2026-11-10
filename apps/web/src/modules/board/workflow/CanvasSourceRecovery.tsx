"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Editor } from "tldraw";
import type { StudioStyleRevisionView } from "@fashion/shared";
import { Button, ImagePreview } from "../../../components/ui";
import { fetchStudio } from "../../studio/studio-api";
import { findStyleRevision } from "../../studio/style-revisions";
import { useCanvasCommand } from "./use-canvas-command";
import type { WorkflowGraph } from "./workflow-api";
import styles from "./workflow-canvas.module.css";

/** A missing linked source is a recoverable entry point, not a silent jump to an empty canvas. */
export function CanvasSourceRecovery({
  projectId,
  graph,
  canPlace,
  onPlaced,
  editor,
}: {
  projectId: string;
  graph: WorkflowGraph;
  canPlace: boolean;
  onPlaced: (graph: WorkflowGraph, nodeId: string) => Promise<void>;
  editor: Editor | null;
}) {
  const query = useSearchParams();
  const assetId = query.get("assetId");
  const revisionId = query.get("styleRevisionId");
  if (!assetId) return null;
  return (
    <SourceRecovery
      key={`${projectId}:${assetId}:${revisionId}`}
      projectId={projectId}
      graph={graph}
      canPlace={canPlace}
      onPlaced={onPlaced}
      assetId={assetId}
      revisionId={revisionId}
      editor={editor}
    />
  );
}

function SourceRecovery({
  projectId,
  graph,
  canPlace,
  onPlaced,
  assetId,
  revisionId,
  editor,
}: {
  projectId: string;
  graph: WorkflowGraph;
  canPlace: boolean;
  onPlaced: (graph: WorkflowGraph, nodeId: string) => Promise<void>;
  assetId: string;
  revisionId: string | null;
  editor: Editor | null;
}) {
  const subscribe = useCallback(
    (changed: () => void) =>
      editor ? editor.store.listen(changed, { scope: "document" }) : () => {},
    [editor],
  );
  const snapshot = useCallback(
    () =>
      editor
        ? editor
            .getCurrentPageShapes()
            .some(
              (shape) =>
                "assetId" in shape.props && shape.props.assetId === assetId,
            )
        : undefined,
    [assetId, editor],
  );
  const placed = useSyncExternalStore(subscribe, snapshot, () => undefined);
  const missing =
    !graph.nodes.some((node) => node.payload.assetId === assetId) ||
    placed === false;
  const command = useCanvasCommand(
    projectId,
    `style-source:${assetId ?? "none"}`,
  );
  const [source, setSource] = useState<{
    revision: StudioStyleRevisionView;
    canEdit: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const requestKey = `${projectId}:${assetId}:${revisionId}`;
  const visible =
    (missing || Boolean(command.pending)) && dismissed !== requestKey;
  const loading = visible && Boolean(revisionId) && !source && !error;
  useEffect(() => {
    active.current = true;
    if (!visible || !revisionId)
      return () => {
        active.current = false;
      };
    const controller = new AbortController();
    void fetchStudio(projectId, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        const selected = findStyleRevision(data.styles, revisionId);
        if (!selected || selected.revision.payload.sourceAssetId !== assetId) {
          setError("这份款式修订或主图已无法访问，请返回款式核对。");
          return;
        }
        setSource({
          revision: selected.revision,
          canEdit: data.capabilities.edit,
        });
      },
      () => {
        if (!controller.signal.aborted)
          setError("暂时无法读取款式主图，请重试或返回款式。");
      },
    );
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [assetId, projectId, revisionId, visible, attempt]);

  const place = async () => {
    if (!source || busy || !canPlace || !source.canEdit || !assetId) return;
    setBusy(true);
    setError(null);
    try {
      const pending = await command.getPending();
      const result = await command.execute(
        pending
          ? undefined
          : {
              type: "create_material",
              mutationId: crypto.randomUUID(),
              clientMaterialId: crypto.randomUUID(),
              materialType: "candidate",
              title: source.revision.payload.name,
              payload: {
                assetId,
                imageUrl: `/api/design-assets/${encodeURIComponent(assetId)}/content`,
              },
            },
      );
      if (active.current) await onPlaced(result.graph, result.nodeId);
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "主图尚未放入白板，请重试原操作。",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (!visible || !assetId) return null;
  return (
    <aside aria-label="白板来源图片" className={styles.sourceRecovery}>
      <strong>
        {command.pending ? "主图放置结果待确认" : "这张主图还不在当前白板中"}
      </strong>
      {source ? (
        <div className={styles.sourcePreview}>
          <ImagePreview
            src={`/api/design-assets/${encodeURIComponent(assetId)}/content`}
            alt={source.revision.payload.name}
          />
          <span>
            {source.revision.payload.name}
            <small>款式修订 r{source.revision.revision}</small>
          </span>
        </div>
      ) : null}
      <p>
        {loading
          ? "正在读取款式主图…"
          : source?.canEdit && canPlace
            ? "放入白板后可以继续编辑，原款式与图片仍然保留。"
            : "可以返回原款式查看主图和修订资料。"}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.sourceActions}>
        {source?.canEdit && canPlace ? (
          <Button loading={busy} onClick={() => void place()}>
            {command.pending ? "继续确认放置" : "放入白板继续编辑"}
          </Button>
        ) : null}
        {error && !source ? (
          <Button
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            重新读取
          </Button>
        ) : null}
        {revisionId ? (
          <a
            href={`/${encodeURIComponent(projectId)}/studio?tab=styles&styleRevisionId=${encodeURIComponent(revisionId)}`}
          >
            返回对应款式
          </a>
        ) : (
          <a href={`/${encodeURIComponent(projectId)}/studio?tab=styles`}>
            查看款式档案
          </a>
        )}
        <Button disabled={busy} onClick={() => setDismissed(requestKey)}>
          暂时收起
        </Button>
      </div>
    </aside>
  );
}
