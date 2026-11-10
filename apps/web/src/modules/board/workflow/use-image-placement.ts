"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import {
  draftRepository,
  type DraftRecord,
} from "../../../components/drafts/draft-repository";
import { isRejectedCanvasCommand, runCanvasCommand } from "./canvas-api";

type PlacementCommand = Extract<
  CanvasCommand,
  { type: "place_generated_asset" | "place_reference_image" }
>;
type PlacementKind = PlacementCommand["type"];
export type PlacementResult = Awaited<ReturnType<typeof runCanvasCommand>>;
export interface PendingImagePlacement<Kind extends PlacementKind> {
  title: string;
  command: Extract<PlacementCommand, { type: Kind }>;
}
interface State<Kind extends PlacementKind> {
  key: string;
  ready: boolean;
  busy: boolean;
  pending: PendingImagePlacement<Kind> | null;
  error: string | null;
}
const sourceId = (command: PlacementCommand) =>
  command.type === "place_generated_asset" ? command.assetId : command.nodeId;

/** One durable receipt for an explicit image placement, shared by project files and chat references. */
export function useImagePlacement<Kind extends PlacementKind>(
  projectId: string,
  objectKey: string,
  kind: Kind,
  onPlaced: (result: PlacementResult, signal: AbortSignal) => Promise<void>,
  expectedSource?: string,
) {
  const scope = useDraftScope();
  const key = scope
    ? JSON.stringify([scope.accountId, projectId, scope.editor, objectKey])
    : "";
  const empty: State<Kind> = {
    key: "",
    ready: false,
    busy: false,
    pending: null,
    error: null,
  };
  const [state, setState] = useState<State<Kind>>(empty);
  const owner = useRef<string | null>(null);
  const flight = useRef<Promise<string | undefined> | null>(null);
  const request = useRef<AbortController | null>(null);
  const placed = useRef(onPlaced);
  useLayoutEffect(() => {
    placed.current = onPlaced;
    owner.current = key;
  }, [onPlaced, key]);
  const read = useCallback(async () => {
    if (!key) throw new Error("账号尚未就绪，请稍后重试。");
    const record = await draftRepository.read<PendingImagePlacement<Kind>>(key);
    if (record) {
      const parsed = canvasCommandSchema.safeParse(record.value?.command);
      if (
        !parsed.success ||
        parsed.data.type !== kind ||
        typeof record.value?.title !== "string" ||
        (expectedSource &&
          sourceId(parsed.data as PlacementCommand) !== expectedSource)
      )
        throw new Error("上次放置记录无法读取，请保留当前页面并联系管理员。");
    }
    return record;
  }, [expectedSource, key, kind]);
  const reload = useCallback(async () => {
    try {
      const record = await read();
      if (owner.current === key && !flight.current)
        setState({
          key,
          ready: true,
          busy: false,
          pending: record?.value ?? null,
          error: null,
        });
    } catch (cause) {
      if (owner.current === key)
        setState({
          key,
          ready: false,
          busy: false,
          pending: null,
          error:
            cause instanceof Error
              ? cause.message
              : "上次放置记录暂时无法读取。",
        });
    }
  }, [key, read]);
  useEffect(() => {
    owner.current = key;
    void Promise.resolve().then(reload);
    return () => {
      if (owner.current === key) owner.current = null;
      request.current?.abort();
    };
  }, [key, reload]);
  const execute = useCallback(
    (input?: PendingImagePlacement<Kind>): Promise<string | undefined> => {
      if (flight.current) return flight.current;
      const controller = new AbortController();
      request.current = controller;
      const live = () => owner.current === key && !controller.signal.aborted;
      const work = (async () => {
        if (!scope || !key || !live())
          throw new Error("工作区已切换，请回到原项目继续。");
        setState((previous) => ({
          ...(previous.key === key
            ? previous
            : { key, ready: true, pending: null }),
          key,
          busy: true,
          error: null,
        }));
        let record: DraftRecord<PendingImagePlacement<Kind>> | undefined;
        try {
          record = await read();
          controller.signal.throwIfAborted();
          if (
            record &&
            input &&
            sourceId(record.value.command) !== sourceId(input.command)
          )
            throw new Error("上一张图片的放置尚未确认，请先继续原操作。");
          if (!record) {
            if (!input) throw new Error("没有待确认的放置，请重新选择图片。");
            record = await draftRepository.write(
              {
                key,
                accountId: scope.accountId,
                baseline: "null",
                value: input,
              },
              0,
              { preserveConflict: false },
            );
          }
          if (!live()) return;
          setState({
            key,
            ready: true,
            busy: true,
            pending: record.value,
            error: null,
          });
          let result: PlacementResult;
          try {
            result = await runCanvasCommand(
              projectId,
              record.value.command,
              controller.signal,
            );
          } catch (cause) {
            if (isRejectedCanvasCommand(cause)) {
              await draftRepository.remove(key, record.revision, record.value);
              record = undefined;
            }
            throw cause;
          }
          if (!live()) return;
          await placed.current(result, controller.signal);
          if (!live()) return;
          await draftRepository.remove(key, record.revision, record.value);
          const next = await read();
          if (live())
            setState({
              key,
              ready: true,
              busy: false,
              pending: next?.value ?? null,
              error: null,
            });
          return live() ? result.nodeId : undefined;
        } catch (cause) {
          const pending = await read().catch(() => record);
          if (live())
            setState({
              key,
              ready: true,
              busy: false,
              pending: pending?.value ?? null,
              error:
                cause instanceof Error
                  ? cause.message
                  : "放置尚未完成，请重试原操作。",
            });
          throw cause;
        } finally {
          if (request.current === controller) request.current = null;
        }
      })();
      flight.current = work;
      void work
        .finally(() => {
          if (flight.current === work) flight.current = null;
        })
        .catch(() => {});
      return work;
    },
    [key, projectId, read, scope],
  );
  return { ...(state.key === key ? state : empty), execute, reload };
}
