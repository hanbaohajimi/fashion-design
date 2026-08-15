import { describe, expect, it } from "vitest";

import type { AiGenerationRequest } from "../interfaces/provider.interface";
import { MockAdapter } from "./mock.adapter";

const t2iRequest: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "editorial fashion portrait",
  width: 1_024,
  height: 1_024,
};

describe("MockAdapter", () => {
  it("覆盖 t2i 的提交、状态和结果全路径", async () => {
    const adapter = new MockAdapter({
      imageUrl: "https://cdn.test/t2i.png",
      rawCost: 0.04,
      credits: 4,
    });
    const signal = new AbortController().signal;

    const job = await adapter.submit(t2iRequest, signal);
    const status = await adapter.getStatus(job, signal);
    const result = await adapter.getResult(job, signal);

    expect(job.taskType).toBe("t2i");
    expect(status.status).toBe("completed");
    expect(result.images[0]?.url).toBe("https://cdn.test/t2i.png");
    expect(result.cost).toEqual(
      expect.objectContaining({ rawCost: 0.04, credits: 4 }),
    );
  });

  it("覆盖 i2i 参数和两百万像素计费单元", async () => {
    const adapter = new MockAdapter();
    const request: AiGenerationRequest = {
      taskType: "i2i",
      prompt: "change material to silk",
      width: 1_536,
      height: 1_024,
      referenceImageUrl: "https://cdn.test/reference.png",
    };

    const job = await adapter.submit(request, new AbortController().signal);

    expect(adapter.submittedRequests).toEqual([request]);
    expect(job.taskType).toBe("i2i");
    expect(job.cost.billableMegapixels).toBe(2);
  });
});
