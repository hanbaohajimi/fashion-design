"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { isRejectedCanvasCommand, runCanvasCommand } from "./canvas-api";

/** Persist the exact admitted request before sending; reload only offers a retry. */
export function useCanvasCommand(projectId: string, objectKey: string) {
  const scope = useDraftScope();
  const key = scope
    ? JSON.stringify([scope.accountId, projectId, scope.editor, objectKey])
    : "";
  const [pending, setPending] = useState<CanvasCommand | null>(null);
  const current = useRef<CanvasCommand | null>(null);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const flight = useRef<ReturnType<typeof runCanvasCommand> | null>(null);
  useEffect(() => {
    let active = true;
    current.current = null;
    ready.current = (async () => {
      const record = key ? await draftRepository.read<CanvasCommand>(key) : await Promise.resolve(undefined);
      if (!active) return;
      const parsed = canvasCommandSchema.safeParse(record?.value);
      current.current = parsed.success ? parsed.data : null;
      setPending(current.current);
    })();
    return () => {
      active = false;
    };
  }, [key]);
  const execute = useCallback(
    async (command?: CanvasCommand) => {
      await ready.current;
      if (flight.current) return flight.current;
      if (
        current.current &&
        command &&
        JSON.stringify(command) !== JSON.stringify(current.current)
      )
        throw new Error("上一项操作尚未确认，请先重试原操作");
      const request = current.current ?? command;
      if (!request) throw new Error("没有可恢复的操作");
      current.current = request;
      setPending(request);
      const work = (async () => {
        let revision: number | undefined;
        if (key && scope) {
          const record = await draftRepository.read<CanvasCommand>(key);
          if (record && record.value.mutationId !== request.mutationId)
            throw new Error("另一窗口有尚未确认的操作，请恢复原操作后继续");
          const saved = await draftRepository.write(
            {
              key,
              accountId: scope.accountId,
              baseline: "null",
              value: request,
            },
            record?.revision ?? 0,
          );
          revision = saved.revision;
        }
        let result;
        try { result = await runCanvasCommand(projectId, request); }
        catch (error) {
          // A definite validation/permission rejection can be corrected; an uncertain
          // network or server result must retain the original idempotency key.
          if (isRejectedCanvasCommand(error)) {
            if (key && revision !== undefined) await draftRepository.remove(key, revision);
            current.current = null; setPending(null);
          }
          throw error;
        }
        if (key && revision !== undefined)
          await draftRepository.remove(key, revision);
        current.current = null;
        setPending(null);
        return result;
      })();
      flight.current = work;
      try {
        return await work;
      } finally {
        flight.current = null;
      }
    },
    [key, projectId, scope],
  );
  return { pending, execute };
}
