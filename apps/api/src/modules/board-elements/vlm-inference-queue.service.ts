import {
  VLM_INFERENCE_QUEUE_NAME,
  type VlmInferenceJobData,
} from "@fashion/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createHash } from "node:crypto";

export interface VlmInferenceJobs {
  enqueue(data: VlmInferenceJobData): Promise<void>;
}

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

@Injectable()
export class BullVlmInferenceJobs
  implements VlmInferenceJobs, OnModuleDestroy
{
  private queue: Queue<VlmInferenceJobData> | undefined;

  async enqueue(data: VlmInferenceJobData): Promise<void> {
    const jobId = `vlm-${createHash("sha256")
      .update(`${data.projectId}\0${data.shapeId}\0${data.fileId}`)
      .digest("hex")}`;
    await this.getQueue().add("classify-role", data, {
      attempts: 6,
      backoff: { delay: 1_000, type: "exponential" },
      delay: 1_500,
      jobId,
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<VlmInferenceJobData> {
    this.queue ??= new Queue<VlmInferenceJobData>(VLM_INFERENCE_QUEUE_NAME, {
      connection: redisConnection(),
    });
    return this.queue;
  }
}
