import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { IMAGE_TRANSFORM_QUEUE, type ImageTransformJob } from "@fashion/shared";
@Injectable()
export class ImageTransformQueue implements OnModuleDestroy {
  private queue?: Queue<ImageTransformJob>;
  async enqueue(attemptId: string) {
    const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    this.queue ??= new Queue<ImageTransformJob>(IMAGE_TRANSFORM_QUEUE, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        username: url.username || undefined,
        maxRetriesPerRequest: 1,
        commandTimeout: 5000,
      },
    }).on("error", () => Logger.warn("图片变换队列连接失败", "ImageTransform"));
    await this.queue.add(
      "transform",
      { attemptId },
      {
        jobId: attemptId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 604800 },
        removeOnFail: { age: 2592000 },
      },
    );
  }
  async onModuleDestroy() {
    await this.queue?.close();
  }
}
