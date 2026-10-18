import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowLayoutSave, type LayoutBatch } from "./workflow-layout-save";

afterEach(() => vi.useRealTimers());

describe("workflow layout persistence", () => {
  it("keeps failed batches and reuses the mutation id on retry", async () => {
    const save = vi.fn<(batch: LayoutBatch) => Promise<void>>()
      .mockRejectedValueOnce(new Error("503")).mockResolvedValue(undefined);
    const queue = new WorkflowLayoutSave(save);
    queue.stage([{ nodeId: "a", x: 1, y: 2 }]);
    await expect(queue.flush()).rejects.toThrow("503");
    expect(queue.getSnapshot()).toBe("error");
    expect(queue.hasUnsaved()).toBe(true);
    await queue.flush();
    expect(save.mock.calls[1]?.[0]).toBe(save.mock.calls[0]?.[0]);
    expect(queue.getSnapshot()).toBe("saved");
    expect(queue.hasUnsaved()).toBe(false);
  });

  it("does not discard a newer drag while the older batch is saving", async () => {
    let release!: () => void;
    const save = vi.fn<(batch: LayoutBatch) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockResolvedValue(undefined);
    const queue = new WorkflowLayoutSave(save);
    queue.stage([{ nodeId: "a", x: 1, y: 2 }]);
    const flight = queue.flush();
    await Promise.resolve();
    queue.stage([{ nodeId: "a", x: 3, y: 4 }]);
    expect(queue.getPositions()).toEqual([{ nodeId: "a", x: 3, y: 4 }]);
    release();
    await flight;
    expect(save.mock.calls.map(([batch]) => batch.positions[0]?.x)).toEqual([1, 3]);
    expect(queue.getSnapshot()).toBe("saved");
    queue.dispose();
  });

  it("coalesces drags for 500ms and flushes immediately before navigation", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new WorkflowLayoutSave(save);
    queue.stage([{ nodeId: "a", x: 1, y: 2 }]);
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    queue.stage([{ nodeId: "a", x: 5, y: 6 }]);
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].positions).toEqual([{ nodeId: "a", x: 5, y: 6 }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
