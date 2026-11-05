import type { RealTimeClient, RealTimeEvents } from "@decartai/sdk";
import { stopMediaStream } from "./camera-controller";
import { TryOnError, type TryOnAdapter, type TryOnConnection } from "./realtime-tryon-types";
import { providerErrorMessage } from "./realtime-tryon-machine";

/** Only this boundary knows the official SDK; no permanent credential enters this module. */
export class DecartRealtimeAdapter implements TryOnAdapter {
  async connect(options: Parameters<TryOnAdapter["connect"]>[0]): Promise<TryOnConnection> {
    const { signal, modelId, stream, initialState, onRemoteStream, onError, onEnded, onGeneration } = options;
    signal.throwIfAborted();
    const sdk = await import("@decartai/sdk");
    signal.throwIfAborted();
    const model = modelId === "lucy-vton-3.6"
      ? sdk.models.realtime("lucy-vton-3.6")
      : modelId === "lucy-vton-3.5"
        ? sdk.models.realtime("lucy-vton-3.5")
        : null;
    if (!model) throw new TryOnError("实时试穿模型未受当前版本支持，请联系管理员。", "MODEL_UNSUPPORTED");

    let realtime: RealTimeClient | null = null;
    let terminated = false;
    let token: string | null = options.token;
    const listeners: Array<() => void> = [];
    const disconnect = () => {
      terminated = true;
      token = null;
      signal.removeEventListener("abort", disconnect);
      listeners.splice(0).forEach((off) => off());
      // Keep no reusable SDK handle after an explicit stop.
      const current = realtime;
      realtime = null;
      current?.disconnect();
    };
    signal.addEventListener("abort", disconnect, { once: true });
    const client = sdk.createDecartClient({
      // 0.2.14 retries:0 does NOT disable reconnects after an established session.
      // A one-read provider rejects every redial without minting or reusing a token.
      apiKeyProvider: () => {
        if (terminated || signal.aborted || token === null) throw new TryOnError("连接已结束，请重新确认后开始。", "RECONNECT_DISABLED");
        const credential = token;
        token = null;
        return credential;
      },
      logger: sdk.noopLogger,
      telemetry: false,
    });
    try {
      const connected = await client.realtime.connect(stream, {
        model,
        retries: 0,
        capacityRetryBudgetMs: 0,
        mirror: false,
        initialState: {
          image: initialState.image,
          prompt: { text: initialState.prompt, enhance: false },
        },
        onRemoteStream: (stream) => {
          if (terminated || signal.aborted) { stopMediaStream(stream); return; }
          onRemoteStream(stream);
        },
        onConnectionChange: (state) => {
          if (terminated || signal.aborted) return;
          if (state === "reconnecting") {
            disconnect();
            onError("RECONNECT_DISABLED");
          }
        },
      });
      if (terminated || signal.aborted) {
        connected.disconnect();
        throw new TryOnError("连接已结束。", "CONNECTION_CANCELLED");
      }
      realtime = connected;
      function listen<K extends keyof RealTimeEvents>(event: K, listener: (payload: RealTimeEvents[K]) => void) {
        connected.on(event, listener);
        listeners.push(() => connected.off(event, listener));
      }
      listen("error", (error) => { if (!terminated) onError(error.code); });
      listen("generationTick", ({ seconds }) => { if (!terminated) onGeneration(seconds); });
      listen("generationEnded", ({ seconds, reason }) => {
        if (terminated) return;
        onGeneration(seconds);
        if (/moderation|credit|session_limit|policy/i.test(reason)) onError(reason);
        else onEnded();
      });
      listen("sessionEnded", ({ reason }) => {
        if (terminated) return;
        if (/moderation|credit|session_limit|policy/i.test(reason)) onError(reason);
        else onEnded();
      });
      return {
        set: async (state) => {
          if (terminated || signal.aborted || !realtime) throw new TryOnError("连接已结束。", "CONNECTION_CANCELLED");
          await realtime.set({ image: state.image, prompt: state.prompt, enhance: false });
        },
        disconnect,
      };
    } catch (error) {
      disconnect();
      if (error instanceof TryOnError) throw error;
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "CONNECTION_FAILED";
      throw new TryOnError(providerErrorMessage(code), code);
    }
  }
}
