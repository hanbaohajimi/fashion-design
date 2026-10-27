import type { AgentMessageView } from "./index";

export interface AssistantTurnView {
  readonly userMessage: AgentMessageView;
  readonly assistantMessage: AgentMessageView;
  readonly taskId?: string | null;
}
export type AssistantStreamPayload =
  | { type: "accepted"; turn: AssistantTurnView }
  | { type: "phase"; phase: "analyzing" | "reading" | "validating" }
  | { type: "message.delta"; text: string }
  | { type: "message.reset" }
  | { type: "message.completed" | "message.failed" | "message.canceled"; turn: AssistantTurnView }
  | { type: "snapshot"; turn: AssistantTurnView; text: string; terminal: boolean };
export type AssistantStreamEvent = AssistantStreamPayload & {
  readonly eventId: string;
  readonly attemptId: string;
  readonly messageId: string;
};
export interface AssistantStreamObserver {
  readonly signal?: AbortSignal;
  accepted(turn: AssistantTurnView): Promise<void>;
  delta(text: string): Promise<void>;
  reset(): Promise<void>;
  phase(phase: "analyzing" | "reading" | "validating"): Promise<void>;
}

export interface SseFrame { id: string; event: string; data: string; }
/** Incremental SSE framing shared by provider transport and authenticated browser fetch. */
export class SseDecoder {
  private buffer = "";
  private lines: string[] = [];
  private id = "";
  private event = "message";
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    if (this.buffer.length > 2_000_000) throw new Error("流式事件超过长度限制");
    const result: SseFrame[] = [];
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line) {
        if (this.lines.length) result.push({ id: this.id, event: this.event, data: this.lines.join("\n") });
        this.lines = []; this.event = "message";
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /u, "");
        if (field === "data") this.lines.push(value);
        else if (field === "id" && !value.includes("\0")) this.id = value;
        else if (field === "event") this.event = value;
      }
    }
    return result;
  }
}

/** Redis stream IDs are ordered numerically, including after snapshot recovery. */
export function compareAssistantEventIds(a: string, b: string): number {
  if (!/^\d+-\d+$/u.test(a) || !/^\d+-\d+$/u.test(b)) return 0;
  const [at = 0n, as = 0n] = a.split("-").map(BigInt);
  const [bt = 0n, bs = 0n] = b.split("-").map(BigInt);
  return at === bt ? as < bs ? -1 : as > bs ? 1 : 0 : at < bt ? -1 : 1;
}
