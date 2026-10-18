import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredUploads } from "./uploads-cleanup.service";

describe("expired uploads", () => {
  it("only claims stale PENDING/FAILED rows and deletes while holding the transaction", async () => {
    let locked = false;
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      fileAsset: { findMany: vi.fn().mockResolvedValue([{ id: "old", objectKey: "original", updatedAt: new Date(0), status: "PENDING", thumbnail256Key: null, thumbnail1024Key: null }]) },
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<boolean>) => { locked = true; try { return await work({ fileAsset: { updateMany } }); } finally { locked = false; } }),
    };
    const storage = { delete: vi.fn(async () => { expect(locked).toBe(true); }) };
    expect(await cleanupExpiredUploads(database as never, storage)).toBe(1);
    expect(database.fileAsset.findMany.mock.calls[0]?.[0].where.status.in).toEqual(["PENDING", "FAILED"]);
    expect(storage.delete).toHaveBeenCalledWith("original");
  });
  it("does not delete a concurrently refreshed or processing upload", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = {
      fileAsset: { findMany: vi.fn().mockResolvedValue([{ id: "old", updatedAt: new Date(0), status: "PENDING" }]) },
      $transaction: async (work: (tx: unknown) => Promise<boolean>) => work({ fileAsset: { updateMany } }),
    };
    const storage = { delete: vi.fn() };
    expect(await cleanupExpiredUploads(database as never, storage)).toBe(0);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
