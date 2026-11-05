// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecartClientOptions, RealTimeClient, RealTimeClientConnectOptions, RealTimeEvents } from "@decartai/sdk";
import { DecartRealtimeAdapter } from "./decart-realtime-adapter";
import type { TryOnAdapter } from "./realtime-tryon-types";

const sdk = vi.hoisted(() => ({
  create: vi.fn(), connect: vi.fn(), model: vi.fn((name: string) => ({ name })),
  noopLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@decartai/sdk", () => ({
  createDecartClient: sdk.create,
  models: { realtime: sdk.model },
  noopLogger: sdk.noopLogger,
}));

let clientOptions: DecartClientOptions;
let connectOptions: RealTimeClientConnectOptions;
let realtime: RealTimeClient;
let eventHandlers: { [K in keyof RealTimeEvents]?: (data: RealTimeEvents[K]) => void };
const options = (): Parameters<TryOnAdapter["connect"]>[0] => ({
  token: "fake-client-token", modelId: "lucy-vton-3.6", signal: new AbortController().signal,
  stream: { getTracks: () => [] } as unknown as MediaStream,
  initialState: { image: new File(["garment"], "top.png", { type: "image/png" }), prompt: "Keep the reference garment", enhance: false },
  onRemoteStream: vi.fn(), onError: vi.fn(), onEnded: vi.fn(), onGeneration: vi.fn(),
});

beforeEach(() => {
  eventHandlers = {};
  realtime = {
    set: vi.fn(async () => {}), disconnect: vi.fn(),
    on: vi.fn(<K extends keyof RealTimeEvents>(event: K, handler: (data: RealTimeEvents[K]) => void) => {
      Object.assign(eventHandlers, { [event]: handler });
    }),
    off: vi.fn(),
  } as unknown as RealTimeClient;
  sdk.create.mockImplementation((input: DecartClientOptions) => { clientOptions = input; return { realtime: { connect: sdk.connect } }; });
  sdk.connect.mockImplementation(async (_stream: MediaStream, input: RealTimeClientConnectOptions) => {
    connectOptions = input;
    await clientOptions.apiKeyProvider?.();
    return realtime;
  });
});
afterEach(() => vi.clearAllMocks());

it("loads the exact supported model, supplies full initial state and disables telemetry and initial retries", async () => {
  const input = options();
  const connection = await new DecartRealtimeAdapter().connect(input);
  expect(sdk.model).toHaveBeenCalledWith("lucy-vton-3.6");
  expect(clientOptions).toMatchObject({ telemetry: false, logger: sdk.noopLogger });
  expect(clientOptions).not.toHaveProperty("apiKey");
  expect(connectOptions).toMatchObject({ retries: 0, capacityRetryBudgetMs: 0, mirror: false,
    initialState: { image: input.initialState.image, prompt: { text: input.initialState.prompt, enhance: false } } });
  expect(connectOptions).not.toHaveProperty("speed");
  await connection.set(input.initialState);
  expect(realtime.set).toHaveBeenCalledWith({ image: input.initialState.image, prompt: input.initialState.prompt, enhance: false });
  connection.disconnect();
});

it("rejects credential reuse without calling any backend or minting a fresh token", async () => {
  const connection = await new DecartRealtimeAdapter().connect(options());
  expect(() => clientOptions.apiKeyProvider?.()).toThrow("连接已结束");
  expect(sdk.connect).toHaveBeenCalledOnce();
  connection.disconnect();
});

it("disconnects synchronously when the established SDK tries automatic reconnect", async () => {
  const input = options();
  const connection = await new DecartRealtimeAdapter().connect(input);
  connectOptions.onConnectionChange?.("reconnecting");
  expect(realtime.disconnect).toHaveBeenCalledOnce();
  expect(input.onError).toHaveBeenCalledWith("RECONNECT_DISABLED");
  expect(() => clientOptions.apiKeyProvider?.()).toThrow();
  await expect(connection.set(input.initialState)).rejects.toMatchObject({ code: "CONNECTION_CANCELLED" });
  connection.disconnect();
  expect(realtime.disconnect).toHaveBeenCalledOnce();
});

it("aborts a pending connect, ignores late media and disconnects the late handle", async () => {
  const abort = new AbortController();
  const input = { ...options(), signal: abort.signal };
  let complete!: (client: RealTimeClient) => void;
  const pending = new Promise<RealTimeClient>((resolve) => { complete = resolve; });
  sdk.connect.mockImplementation(async (_stream: MediaStream, config: RealTimeClientConnectOptions) => {
    connectOptions = config;
    return pending;
  });
  const connecting = new DecartRealtimeAdapter().connect(input);
  await vi.waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
  abort.abort();
  const stop = vi.fn();
  connectOptions.onRemoteStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  expect(stop).toHaveBeenCalledOnce();
  expect(input.onRemoteStream).not.toHaveBeenCalled();
  complete(realtime);
  await expect(connecting).rejects.toMatchObject({ code: "CONNECTION_CANCELLED" });
  expect(realtime.disconnect).toHaveBeenCalledOnce();
});

it("passes only safe error codes and cumulative ticks to the owner", async () => {
  const input = options();
  const connection = await new DecartRealtimeAdapter().connect(input);
  eventHandlers.generationTick?.({ seconds: 10 });
  eventHandlers.error?.({ code: "INVALID_API_KEY", message: "never display this credential-bearing URL" });
  expect(input.onGeneration).toHaveBeenCalledWith(10);
  expect(input.onError).toHaveBeenCalledWith("INVALID_API_KEY");
  expect(input.onError).not.toHaveBeenCalledWith(expect.stringContaining("URL"));
  eventHandlers.sessionEnded?.({ reason: "insufficient_credits" });
  expect(input.onError).toHaveBeenCalledWith("insufficient_credits");
  connection.disconnect();
});

it("rejects unverified models before opening a connection", async () => {
  await expect(new DecartRealtimeAdapter().connect({ ...options(), modelId: "lucy-vton-latest" })).rejects.toMatchObject({ code: "MODEL_UNSUPPORTED" });
  expect(sdk.connect).not.toHaveBeenCalled();
});

it("never starts when cancellation already happened", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(new DecartRealtimeAdapter().connect({ ...options(), signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(sdk.connect).not.toHaveBeenCalled();
});
