"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "../../auth/AuthProvider";
import {
  createGeneration,
  GenerationApiError,
} from "./generation-api";
import type {
  GenerationCandidate,
  GenerationParameters,
  GenerationTaskDetail,
  GenerationTaskItem,
} from "./generation-types";
import { useGenerationSSE } from "./useGenerationSSE";

interface StartGenerationInput {
  readonly parameters: GenerationParameters;
  readonly projectId: string;
  readonly prompt: string;
  readonly maskImageUrl?: string;
  readonly parentAssetId?: string;
  readonly referenceImageUrl?: string;
  readonly shapeIds: readonly string[];
  readonly strength?: number;
  readonly taskType?: "t2i" | "i2i" | "inpaint";
}

interface GenerationWorkspaceValue {
  readonly dismissCandidate: (candidateId: string) => void;
  readonly notice: string | null;
  readonly start: (input: StartGenerationInput) => Promise<void>;
  readonly tasks: readonly GenerationTaskItem[];
}

const GenerationWorkspaceContext =
  createContext<GenerationWorkspaceValue | null>(null);
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

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

function TaskObserver({
  onTask,
  taskId,
}: {
  readonly onTask: (task: GenerationTaskDetail) => void;
  readonly taskId: string;
}) {
  const mode = useGenerationSSE(taskId, onTask);
  return <span data-generation-transport={mode} hidden />;
}

export function GenerationWorkspace({
  children,
}: {
  readonly children: ReactNode;
}) {
  const auth = useAuth();
  const [tasks, setTasks] = useState<readonly GenerationTaskItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const settledQuota = useRef(new Set<string>());

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

  const start = useCallback(
    async (input: StartGenerationInput): Promise<void> => {
      if ((auth.session?.credits.remaining ?? 1) <= 0) {
        setNotice("本月免费生成次数已用完，当前剩余 0 次");
        return;
      }
      if (tasks.some((task) => !TERMINAL.has(task.status))) {
        setNotice("已有生成任务进行中，新任务将进入队列");
      } else {
        setNotice(null);
      }
      try {
        const taskId = await createGeneration({
          ...input.parameters,
          projectId: input.projectId,
          prompt: input.prompt,
          ...(input.maskImageUrl
            ? { maskImageUrl: input.maskImageUrl }
            : {}),
          ...(input.parentAssetId
            ? { parentAssetId: input.parentAssetId }
            : {}),
          shapeIds: input.shapeIds,
          taskType: input.taskType ?? "t2i",
          ...(input.referenceImageUrl
            ? { referenceImageUrl: input.referenceImageUrl }
            : {}),
          ...(input.strength !== undefined
            ? { strength: input.strength }
            : {}),
        });
        const now = new Date().toISOString();
        setTasks((current) => [
          {
            candidates: [],
            connection: "sse",
            createdAt: now,
            error: null,
            id: taskId,
            prompt: input.prompt,
            ...(input.referenceImageUrl
              ? { referenceImageUrl: input.referenceImageUrl }
              : {}),
            status: "queued",
            taskType: input.taskType ?? "t2i",
            updatedAt: now,
          },
          ...current,
        ]);
      } catch (cause) {
        const message =
          cause instanceof GenerationApiError &&
          cause.code === "GEN_LIMIT_EXCEEDED"
            ? `本月免费生成次数已用完，当前剩余 ${cause.remaining ?? 0} 次`
            : cause instanceof Error
              ? cause.message
              : "生成任务创建失败";
        setNotice(message);
      }
    },
    [auth.session?.credits.remaining, tasks],
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
    () => ({ dismissCandidate, notice, start, tasks }),
    [dismissCandidate, notice, start, tasks],
  );
  const active = tasks.filter((task) => !TERMINAL.has(task.status));

  return (
    <GenerationWorkspaceContext.Provider value={value}>
      {children}
      {active.map((task) => (
        <TaskObserver key={task.id} onTask={updateTask} taskId={task.id} />
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
