import { Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { ASSISTANT_STREAM_REDIS, AssistantStreamsService } from "./assistant-streams.service";
@Module({
  providers: [AssistantStreamsService, { provide: ASSISTANT_STREAM_REDIS, useFactory: () => {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500 });
    redis.on("error", () => undefined);
    return redis;
  } }],
  exports: [AssistantStreamsService],
})
export class AssistantStreamsModule {}
