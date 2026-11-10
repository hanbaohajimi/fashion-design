/**
 * Project integration contract only. This is NOT a Cubism renderer implementation.
 * Every adapter method must be implemented and verified against the selected SDK.
 */
export type SpiritMotion =
  | "idle" | "hover_greet" | "drag_hold" | "put_down"
  | "task_ready" | "needs_attention";

export type SpiritPhase =
  | "loading" | "idle" | "hovering" | "pressing" | "dragArmed"
  | "dragging" | "settling" | "hiddenForChat" | "error" | "disposed";

export interface ConversationContext {
  projectId: string | null;
  conversationId: string;
}

export interface SpiritAnchor {
  /** Ratio of available movement span, not canvas-world coordinates. */
  xRatio: number;
  yRatio: number;
}

export interface SpiritRenderer {
  load(model3Url: string, signal: AbortSignal): Promise<void>;
  play(motion: SpiritMotion, options?: { interrupt?: boolean }): Promise<void>;
  pause(): void;
  resume(): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** Model-relative hit testing. DOM pass-through is a separate host concern. */
  hitTest(localX: number, localY: number): boolean;
  dispose(): void;
}

export interface SpiritBusinessBridge {
  getContext(): ConversationContext;
  isExistingChatOpen(): boolean;
  /** Open an existing conversation. Never create a new one just for the mascot. */
  openExistingChat(): void;
  subscribeChatVisibility(listener: (visible: boolean) => void): () => void;
  subscribeTaskEvents(listener: (event: TaskEvent) => void): () => void;
}

export interface TaskEvent extends ConversationContext {
  taskId: string;
  kind: "completed" | "failed";
  /** Reference an actual task result. Do not infer completion from an animation. */
  resultId?: string;
}

export interface SpiritHostOptions {
  renderer: SpiritRenderer;
  bridge: SpiritBusinessBridge;
  workspaceId: string;
  userId: string;
  reducedMotion: boolean;
  proactiveMessagesEnabled: boolean;
}
