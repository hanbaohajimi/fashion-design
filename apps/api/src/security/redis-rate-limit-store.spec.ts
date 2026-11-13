import { afterEach, describe, expect, it, vi } from "vitest";

const { RedisMock } = vi.hoisted(() => ({ RedisMock: vi.fn() }));
vi.mock("ioredis", () => ({ default: RedisMock }));

import { RedisRateLimitStore } from "./rate-limit.guard";

describe("RedisRateLimitStore", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("在 Redis 首次连接或脚本请求瞬时失败时只重试一次", async () => {
    let status: string = "wait";
    const redis = {
      get status() {
        return status;
      },
      connect: vi.fn(async () => {
        status = "ready";
      }),
      disconnect: vi.fn(() => {
        status = "end";
      }),
      eval: vi.fn()
        .mockRejectedValueOnce(new Error("连接刚刚恢复"))
        .mockResolvedValueOnce([2, 58]),
      off: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    };
    RedisMock.mockImplementation(function MockRedis() {
      return redis;
    });
    const store = new RedisRateLimitStore();

    await expect(store.consume("rate-limit:test", 60)).resolves.toEqual({
      count: 2,
      retryAfterSeconds: 58,
    });
    expect(redis.connect).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });
});
