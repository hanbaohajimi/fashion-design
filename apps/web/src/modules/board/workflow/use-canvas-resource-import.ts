"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { CanvasApiError, runCanvasCommand } from "./canvas-api";
import type { WorkflowGraph } from "./workflow-api";

interface Packet { command: CanvasCommand; targetId?: string; nodeId?: string }
export function useCanvasResourceImport(projectId: string, callbacks: { onGraph: (graph: WorkflowGraph) => void; attach: (targetId: string, nodeId: string) => Promise<void>; placed: (nodeId: string) => void | Promise<void> }) {
  const scope = useDraftScope();
  const key = scope ? `fashion:resource-import:${scope.accountId}:${projectId}` : "";
  const [pending, setPending] = useState<Packet | null>(() => {
    try { const saved: unknown = key ? JSON.parse(sessionStorage.getItem(key) ?? "null") : null; if (!saved || typeof saved !== "object") return null; const record = saved as Packet; const command = canvasCommandSchema.safeParse(record.command); return command.success ? { command: command.data, ...(typeof record.targetId === "string" ? { targetId: record.targetId } : {}), ...(typeof record.nodeId === "string" ? { nodeId: record.nodeId } : {}) } : null; } catch { return null; }
  });
  const current = useRef(pending), active = useRef(true), handlers = useRef(callbacks), flight = useRef<Promise<string> | null>(null);
  useLayoutEffect(() => { handlers.current = callbacks; }, [callbacks]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const persist = useCallback((packet: Packet | null) => {
    if (key) { if (packet) sessionStorage.setItem(key, JSON.stringify(packet)); else sessionStorage.removeItem(key); }
    current.current = packet; if (active.current) setPending(packet);
  }, [key]);
  const execute = useCallback((command?: CanvasCommand, targetId?: string) => {
    if (flight.current) return flight.current;
    const work = (async () => {
      let packet = current.current;
      if (packet && command && JSON.stringify(command) !== JSON.stringify(packet.command)) throw new Error("请先确认上一次资源导入");
      if (!packet) { if (!command) throw new Error("没有待确认的导入"); packet = { command, ...(targetId ? { targetId } : {}) }; }
      persist(packet);
      try {
        if (!packet.nodeId) {
          const result = await runCanvasCommand(projectId, packet.command);
          if (!active.current) throw new DOMException("工作区已切换", "AbortError");
          handlers.current.onGraph(result.graph);
          packet = { ...packet, nodeId: result.nodeId }; persist(packet);
        }
        const nodeId = packet.nodeId;
        if (!nodeId) throw new Error("资源尚未就绪");
        if (packet.targetId) await handlers.current.attach(packet.targetId, nodeId);
        if (!active.current) throw new DOMException("工作区已切换", "AbortError");
        if (!packet.targetId) await handlers.current.placed(nodeId);
        persist(null); return nodeId;
      } catch (cause) {
        if (cause instanceof CanvasApiError && [400,403,404,422].includes(cause.status)) persist(null);
        throw cause;
      }
    })();
    flight.current = work; void work.finally(() => { if (flight.current === work) flight.current = null; }).catch(() => undefined); return work;
  }, [persist, projectId]);
  return { pending, execute };
}
