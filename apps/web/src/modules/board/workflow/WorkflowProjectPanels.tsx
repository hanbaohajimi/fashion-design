"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "../../../components/ui";
import {
  createCollection,
  importDesignAsset,
  listCollections,
} from "../generation/collection-api";
import type { CollectionDetail } from "../generation/collection-types";
import {
  fetchGenerationTasks,
  cancelGeneration,
} from "../generation/generation-api";
import type { GenerationTaskDetail } from "../generation/generation-types";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../file-upload-api";
import {
  executeWorkflowNode,
  fetchWorkflowNodeHistory,
  type WorkflowGraph,
} from "./workflow-api";

export function WorkflowProjectPanels({
  projectId,
  graph,
  onGraph,
  onLocate,
  onCollection,
}: {
  projectId: string;
  graph: WorkflowGraph;
  onGraph: (graph: WorkflowGraph) => void;
  onLocate: (id: string) => void;
  onCollection: (id: string) => void;
}) {
  const [panel, setPanel] = useState<"collections" | "tasks" | null>(null);
  const [collections, setCollections] = useState<readonly CollectionDetail[]>(
    [],
  );
  const [tasks, setTasks] = useState<readonly GenerationTaskDetail[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (panel === "collections")
      setCollections(await listCollections(projectId));
    if (panel === "tasks") {
      const result = await fetchGenerationTasks(projectId);
      setTasks(result.items);
      setCursor(result.nextCursor);
      const entries = await Promise.all(
        graph.nodes
          .filter((n) => n.kind === "tool")
          .map(async (node) =>
            (await fetchWorkflowNodeHistory(projectId, node.id)).items.flatMap(
              (attempt) =>
                attempt.generationTaskId
                  ? [[attempt.generationTaskId, node.id]]
                  : [],
            ),
          ),
      );
      setBindings(Object.fromEntries(entries.flat()));
    }
  }, [panel, projectId, graph.nodes]);
  useEffect(() => {
    if (!panel) return;
    let active = true;
    const refresh = () => {
      if (active)
        void load().catch((cause) => {
          if (active) setError(String(cause));
        });
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, panel]);
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => setPanel("collections")}>系列</Button>
      <Button onClick={() => setPanel("tasks")}>任务</Button>
      {panel ? (
        <Dialog
          label={panel === "collections" ? "系列工作台" : "项目任务"}
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          <h2>{panel === "collections" ? "系列工作台" : "项目任务"}</h2>
          <Button disabled={busy} onClick={() => setPanel(null)}>
            关闭
          </Button>
          {error ? (
            <p role="alert">
              {error}
              <Button onClick={() => void action(load)}>重试</Button>
            </p>
          ) : null}
          {panel === "collections" ? (
            <>
              <label>
                上传主推款
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void action(async () => {
                      const invalid = validateImage(file);
                      if (invalid) throw new Error(invalid);
                      const signed = await signImageUpload(projectId, file);
                      const processing = signed.upload
                        ? await putOriginal(signed.upload, file).then(() =>
                            completeUpload(signed.file.id),
                          )
                        : signed.file;
                      const ready = await waitForThumbnail(
                        signed.file.id,
                        processing,
                      );
                      const asset = await importDesignAsset(
                        projectId,
                        ready.id,
                      );
                      const collection = await createCollection(asset.id);
                      onCollection(collection.id);
                      setPanel(null);
                    });
                    event.target.value = "";
                  }}
                />
              </label>
              {collections.map((collection) => (
                <p key={collection.id}>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      onCollection(collection.id);
                      setPanel(null);
                    }}
                  >
                    {collection.name}
                  </Button>
                </p>
              ))}
              {!collections.length ? (
                <p>暂无系列，可上传主推款或从候选方案建立系列。</p>
              ) : null}
            </>
          ) : (
            <>
              {tasks.map((task) => {
                const nodeId = bindings[task.id];
                return (
                  <section key={task.id}>
                    <strong>{task.request?.prompt ?? task.taskType}</strong>
                    <p>
                      {
                        {
                          queued: "排队中",
                          running: "运行中",
                          succeeded: "已完成",
                          failed: "失败",
                          canceled: "已取消",
                          moderation_failed: "审核未通过",
                        }[task.status]
                      }
                    </p>
                    {task.error ? <p>{task.error.message}</p> : null}
                    {nodeId ? (
                      <Button
                        onClick={() => {
                          onLocate(nodeId);
                          setPanel(null);
                        }}
                      >
                        定位节点
                      </Button>
                    ) : null}
                    {["queued", "running"].includes(task.status) ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void action(() => cancelGeneration(task.id))
                        }
                      >
                        取消任务
                      </Button>
                    ) : null}
                    {nodeId && ["failed", "canceled"].includes(task.status) ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void action(async () =>
                            onGraph(
                              await executeWorkflowNode(projectId, nodeId),
                            ),
                          )
                        }
                      >
                        重试执行
                      </Button>
                    ) : null}
                  </section>
                );
              })}
              {!tasks.length ? <p>暂无任务。</p> : null}
              {cursor ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void fetchGenerationTasks(projectId, cursor)
                      .then((result) => {
                        setTasks((current) => [
                          ...current,
                          ...result.items.filter(
                            (item) =>
                              !current.some((old) => old.id === item.id),
                          ),
                        ]);
                        setCursor(result.nextCursor);
                      })
                      .catch((cause) => setError(String(cause)))
                      .finally(() => setBusy(false));
                  }}
                >
                  加载更多
                </Button>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
