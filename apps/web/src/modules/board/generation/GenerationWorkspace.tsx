"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "../../auth/AuthProvider";
import { BoardProjectContext } from "../board-context";
import {
  cancelGeneration,
  createGeneration,
  fetchGenerationTasks,
  GenerationApiError,
} from "./generation-api";
import type {
  GenerationCandidate,
  PersistedGenerationRequest,
  GenerationStartRequest,
  GenerationTaskDetail,
  GenerationTaskItem,
} from "./generation-types";
import { useGenerationSSE } from "./useGenerationSSE";
import { captureAnalytics } from "../../../observability/analytics";
import styles from "./generation.module.css";

type GenerationStartResult =
  | { readonly ok: true; readonly taskId: string }
  | { readonly error: string; readonly ok: false };

type GenerationBatchStartResult =
  | { readonly ok: true; readonly taskIds: readonly string[] }
  | {
      readonly errors: readonly string[];
      readonly ok: false;
      readonly taskIds: readonly string[];
    };

interface GenerationWorkspaceValue {
  readonly cancel: (taskId: string) => Promise<void>;
  readonly dismissCandidate: (candidateId: string) => void;
  readonly notice: string | null;
  readonly retry: (taskId: string) => Promise<void>;
  readonly start: (
    input: GenerationStartRequest,
  ) => Promise<GenerationStartResult>;
  readonly startBatch: (
    inputs: readonly GenerationStartRequest[],
  ) => Promise<GenerationBatchStartResult>;
  readonly tasks: readonly GenerationTaskItem[];
}

const GenerationWorkspaceContext =
  createContext<GenerationWorkspaceValue | null>(null);
const TERMINAL = new Set([
  "succeeded",
  "failed",
  "moderation_failed",
  "canceled",
]);
const MAX_HISTORY_PAGES = 5;

function candidatesFrom(
  task: GenerationTaskDetail,
  source: GenerationTaskItem,
): GenerationCandidate[] {
  if (!task.output || typeof task.output !== "object") return [];
  const output = task.output as {
    readonly images?: unknown;
    readonly seed?: unknown;
  };
  const images = output.images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((image, index) => {
    if (!image || typeof image !== "object") return [];
    const candidate = image as Record<string, unknown>;
    if (typeof candidate.url !== "string") return [];
    return [
      {
        assetId:
          typeof candidate.assetId === "string"
            ? candidate.assetId
            : `${task.id}:${index}`,
        id: `${task.id}:${index}`,
        taskId: task.id,
        taskType: source.taskType,
        url: candidate.url,
        ...(typeof output.seed === "number" ? { seed: output.seed } : {}),
        ...(source.referenceImageUrl
          ? { sourceUrl: source.referenceImageUrl }
          : {}),
        ...(typeof candidate.width === "number"
          ? { width: candidate.width }
          : {}),
        ...(typeof candidate.height === "number"
          ? { height: candidate.height }
          : {}),
      },
    ];
  });
}

function startRequestFrom(
  request: PersistedGenerationRequest,
  projectId: string,
): GenerationStartRequest | null {
  if (request.projectId !== projectId) return null;
  return {
    parameters: {
      ...(request.background ? { background: request.background } : {}),
      cfg: request.cfg,
      height: request.height,
      ...(request.outputCompression !== undefined
        ? { outputCompression: request.outputCompression }
        : {}),
      ...(request.outputFormat ? { outputFormat: request.outputFormat } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      steps: request.steps,
      width: request.width,
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    },
    projectId,
    prompt: request.prompt,
    shapeIds: request.shapeIds ?? [],
    taskType: request.taskType,
    ...(request.maskImageUrl ? { maskImageUrl: request.maskImageUrl } : {}),
    ...(request.parentAssetId ? { parentAssetId: request.parentAssetId } : {}),
    ...(request.referenceImageUrl
      ? { referenceImageUrl: request.referenceImageUrl }
      : {}),
    ...(request.strength !== undefined ? { strength: request.strength } : {}),
  };
}

function taskItemFrom(
  detail: GenerationTaskDetail,
  projectId: string,
): GenerationTaskItem | null {
  if (!detail.request) return null;
  const request = startRequestFrom(detail.request, projectId);
  if (!request) return null;
  const source: GenerationTaskItem = {
    candidates: [],
    connection: "sse",
    createdAt: detail.createdAt,
    error: detail.error?.message ?? null,
    id: detail.id,
    prompt: request.prompt,
    request,
    status: detail.status,
    taskType: request.taskType ?? detail.taskType,
    updatedAt: detail.updatedAt,
    ...(request.referenceImageUrl
      ? { referenceImageUrl: request.referenceImageUrl }
      : {}),
    ...(request.parameters.seed !== undefined
      ? { seed: request.parameters.seed }
      : {}),
  };
  return { ...source, candidates: candidatesFrom(detail, source) };
}

function TaskObserver({
  onTask,
  onTransport,
  taskId,
}: {
  readonly onTask: (task: GenerationTaskDetail) => void;
  readonly onTransport: (
    taskId: string,
    mode: GenerationTaskItem["connection"],
  ) => void;
  readonly taskId: string;
}) {
  const mode = useGenerationSSE(taskId, onTask);
  useEffect(() => {
    onTransport(taskId, mode);
  }, [mode, onTransport, taskId]);
  return <span data-generation-transport={mode} hidden />;
}

export function GenerationWorkspace({
  children,
}: {
  readonly children: ReactNode;
}) {
  const auth = useAuth();
  const projectId = useContext(BoardProjectContext);
  const [tasks, setTasks] = useState<readonly GenerationTaskItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const settledQuota = useRef(new Set<string>());
  const submissionInFlight = useRef(false);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;

    const hydrate = async (): Promise<void> => {
      try {
        const restored: GenerationTaskItem[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
          const response = await fetchGenerationTasks(projectId, cursor);
          restored.push(
            ...response.items.flatMap((detail) => {
              const task = taskItemFrom(detail, projectId);
              return task ? [task] : [];
            }),
          );
          if (!response.nextCursor || seenCursors.has(response.nextCursor)) {
            break;
          }
          seenCursors.add(response.nextCursor);
          cursor = response.nextCursor;
        }
        if (disposed) return;
        setTasks((current) => {
          const merged = new Map(
            restored.map((task) => [task.id, task] as const),
          );
          for (const task of current) {
            if (task.request.projectId === projectId) {
              merged.set(task.id, task);
            }
          }
          return [...merged.values()].sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          );
        });
      } catch (cause) {
        if (disposed) return;
        const message =
          cause instanceof Error ? cause.message : "生成任务历史读取失败";
        setNotice((current) => current ?? message);
      }
    };

    void hydrate();
    return () => {
      disposed = true;
    };
  }, [projectId]);

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.request.projectId === projectId),
    [projectId, tasks],
  );

  const updateTask = useCallback(
    (detail: GenerationTaskDetail): void => {
      setTasks((current) =>
        current.map((task) =>
          task.id === detail.id
            ? {
                ...task,
                candidates: candidatesFrom(detail, task),
                error: detail.error?.message ?? null,
                status: detail.status,
                updatedAt: detail.updatedAt,
              }
            : task,
        ),
      );
      if (
        detail.status === "succeeded" &&
        !settledQuota.current.has(detail.id)
      ) {
        settledQuota.current.add(detail.id);
        void auth.refresh();
      }
    },
    [auth],
  );

  const submit = useCallback(
    async (input: GenerationStartRequest): Promise<GenerationStartResult> => {
      if ((auth.session?.credits.remaining ?? 1) <= 0) {
        const message = "本月免费生成次数已用完，当前剩余 0 次";
        setNotice(message);
        return { error: message, ok: false };
      }
      try {
        const taskId = await createGeneration({
          ...input.parameters,
          projectId: input.projectId,
          prompt: input.prompt,
          ...(input.maskImageUrl ? { maskImageUrl: input.maskImageUrl } : {}),
          ...(input.parentAssetId
            ? { parentAssetId: input.parentAssetId }
            : {}),
          shapeIds: input.shapeIds,
          taskType: input.taskType ?? "t2i",
          ...(input.referenceImageUrl
            ? { referenceImageUrl: input.referenceImageUrl }
            : {}),
          ...(input.strength !== undefined ? { strength: input.strength } : {}),
        });
        const now = new Date().toISOString();
        captureAnalytics("generation_submitted", {
          has_reference: Boolean(input.referenceImageUrl),
          selected_element_count: input.shapeIds.length,
          task_type: input.taskType ?? "t2i",
        });
        setTasks((current) => [
          {
            candidates: [],
            connection: "sse",
            createdAt: now,
            error: null,
            id: taskId,
            prompt: input.prompt,
            request: input,
            ...(input.referenceImageUrl
              ? { referenceImageUrl: input.referenceImageUrl }
              : {}),
            status: "queued",
            taskType: input.taskType ?? "t2i",
            updatedAt: now,
          },
          ...current,
        ]);
        return { ok: true, taskId };
      } catch (cause) {
        const message =
          cause instanceof GenerationApiError &&
          cause.code === "GEN_LIMIT_EXCEEDED"
            ? `本月免费生成次数已用完，当前剩余 ${cause.remaining ?? 0} 次`
            : cause instanceof Error
              ? cause.message
              : "生成任务创建失败";
        setNotice(message);
        return { error: message, ok: false };
      }
    },
    [auth.session?.credits.remaining],
  );

  const start = useCallback(
    async (input: GenerationStartRequest): Promise<GenerationStartResult> => {
      if (submissionInFlight.current) {
        const message = "已有生成请求正在提交，请稍候";
        setNotice(message);
        return { error: message, ok: false };
      }
      submissionInFlight.current = true;
      try {
        if (projectTasks.some((task) => !TERMINAL.has(task.status))) {
          setNotice("已有生成任务进行中，新任务将进入队列");
        } else {
          setNotice(null);
        }
        return await submit(input);
      } finally {
        submissionInFlight.current = false;
      }
    },
    [projectTasks, submit],
  );

  const startBatch = useCallback(
    async (
      inputs: readonly GenerationStartRequest[],
    ): Promise<GenerationBatchStartResult> => {
      if (submissionInFlight.current) {
        const message = "已有生成请求正在提交，请稍候";
        setNotice(message);
        return { errors: [message], ok: false, taskIds: [] };
      }
      submissionInFlight.current = true;
      try {
        if (projectTasks.some((task) => !TERMINAL.has(task.status))) {
          setNotice("已有生成任务进行中，新任务将进入队列");
        } else {
          setNotice(null);
        }

        const taskIds: string[] = [];
        const errors: string[] = [];
        for (const input of inputs) {
          const result = await submit(input);
          if (result.ok) {
            taskIds.push(result.taskId);
          } else {
            errors.push(result.error);
          }
        }

        if (errors.length > 0) {
          setNotice(
            `已创建 ${taskIds.length}/${inputs.length} 个任务；${errors[0]}`,
          );
          return { errors, ok: false, taskIds };
        }
        if (inputs.length > 1) {
          setNotice(`已创建 ${taskIds.length} 个变体任务`);
        }
        return { ok: true, taskIds };
      } finally {
        submissionInFlight.current = false;
      }
    },
    [projectTasks, submit],
  );

  const cancel = useCallback(
    async (taskId: string): Promise<void> => {
      try {
        updateTask(await cancelGeneration(taskId));
        setNotice("任务已取消");
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "任务取消失败");
      }
    },
    [updateTask],
  );

  const retry = useCallback(
    async (taskId: string): Promise<void> => {
      const task = projectTasks.find((item) => item.id === taskId);
      if (!task || (task.status !== "failed" && task.status !== "canceled")) {
        return;
      }
      await start(task.request);
    },
    [projectTasks, start],
  );

  const updateTransport = useCallback(
    (taskId: string, connection: GenerationTaskItem["connection"]): void => {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId && task.connection !== connection
            ? { ...task, connection }
            : task,
        ),
      );
    },
    [],
  );

  const dismissCandidate = useCallback((candidateId: string): void => {
    setTasks((current) =>
      current.map((task) => ({
        ...task,
        candidates: task.candidates.filter(
          (candidate) => candidate.id !== candidateId,
        ),
      })),
    );
  }, []);

  const value = useMemo<GenerationWorkspaceValue>(
    () => ({
      cancel,
      dismissCandidate,
      notice,
      retry,
      start,
      startBatch,
      tasks: projectTasks,
    }),
    [cancel, dismissCandidate, notice, projectTasks, retry, start, startBatch],
  );
  const active = projectTasks.filter((task) => !TERMINAL.has(task.status));

  return (
    <GenerationWorkspaceContext.Provider value={value}>
      {children}
      {notice ? (
        <aside
          aria-live="polite"
          className={styles.generationNotice}
          role="status"
        >
          <span>{notice}</span>
          <button
            aria-label="关闭生成提示"
            onClick={() => setNotice(null)}
            type="button"
          >
            关闭
          </button>
        </aside>
      ) : null}
      {active.map((task) => (
        <TaskObserver
          key={task.id}
          onTask={updateTask}
          onTransport={updateTransport}
          taskId={task.id}
        />
      ))}
    </GenerationWorkspaceContext.Provider>
  );
}

export function useGenerationWorkspace(): GenerationWorkspaceValue {
  const context = useContext(GenerationWorkspaceContext);
  if (!context) {
    throw new Error("生成组件必须位于 GenerationWorkspace 内");
  }
  return context;
}
