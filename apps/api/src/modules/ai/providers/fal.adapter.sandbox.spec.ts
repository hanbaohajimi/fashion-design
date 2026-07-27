import { describe, expect, it } from "vitest";

import { AiService } from "../ai.service";
import type { AiProviderJobStatus } from "../interfaces/provider.interface";
import { FalAdapter } from "./fal.adapter";

const canRunSandbox =
  process.env.RUN_FAL_SANDBOX_TEST === "true" &&
  Boolean(process.env.FAL_KEY?.trim());
const describeSandbox = canRunSandbox ? describe : describe.skip;

describeSandbox("FalAdapter sandbox", () => {
  it(
    "真实提交一次 t2i 并取得图片 URL",
    async () => {
      const adapter = new FalAdapter({
        credentials: () => process.env.FAL_KEY?.trim() || undefined,
        t2iModel: process.env.FAL_T2I_MODEL || "fal-ai/flux/dev",
        i2iModel:
          process.env.FAL_I2I_MODEL ||
          "fal-ai/flux/dev/image-to-image",
        inpaintModel:
          process.env.FAL_INPAINT_MODEL ||
          "fal-ai/flux-general/inpainting",
        t2iCostPerMegapixel: Number(
          process.env.FAL_T2I_COST_PER_MEGAPIXEL || 0,
        ),
        i2iCostPerMegapixel: Number(
          process.env.FAL_I2I_COST_PER_MEGAPIXEL || 0,
        ),
        inpaintCostPerMegapixel: Number(
          process.env.FAL_INPAINT_COST_PER_MEGAPIXEL || 0,
        ),
        creditsPerUsd: Number(process.env.AI_CREDITS_PER_USD || 100),
      });
      const service = new AiService([adapter], {
        primaryProvider: "fal",
        timeoutMs: 60_000,
        retryBaseMs: 250,
        maxRetries: 2,
      });

      const job = await service.submit({
        taskType: "t2i",
        prompt: "minimal black and white fashion editorial",
        width: 512,
        height: 512,
        steps: 20,
        cfg: 3.5,
        seed: 42,
      });

      let status: AiProviderJobStatus = { status: "queued" };
      const deadline = Date.now() + 90_000;
      while (status.status !== "completed" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        status = await service.getStatus(job);
      }

      expect(status.status).toBe("completed");
      const result = await service.getResult(job);
      expect(result.images[0]?.url).toMatch(/^https?:\/\//);
    },
    120_000,
  );
});
