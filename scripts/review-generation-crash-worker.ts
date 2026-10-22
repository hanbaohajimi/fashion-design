/** Controlled integration fixture: persist a remote job, then let the test kill this process. */
import { prisma } from "@fashion/db";
import { BillingService } from "@fashion/billing";
import type { GenerationJobData } from "@fashion/shared";
import { Worker } from "../apps/api/node_modules/bullmq";
import { createGenerationProcessor } from "../apps/worker/src/processors/generation.processor";
import { S3ThumbnailStorage } from "../apps/worker/src/storage";

const queueName = process.argv[2];
if (!queueName?.startsWith("review-generation-")) throw new Error("Only isolated review queues are allowed");
const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const processor = createGenerationProcessor({ database: prisma, billing: new BillingService(prisma), storage: new S3ThumbnailStorage(),
  moderator: { moderate: async () => ({ status: "approved", categories: [] }) },
  ai: {
    submit: async () => ({ provider: "mock", providerJobId: queueName, model: "mock/review", taskType: "t2i", submittedAt: new Date().toISOString(),
      cost: { credits: 1, rawCost: 0, currency: "USD", billableMegapixels: 1, estimated: true } }),
    getStatus: async () => {
      process.send?.({ type: "provider-persisted", pid: process.pid });
      return new Promise<never>(() => undefined);
    },
    getResult: async () => { throw new Error("Crash fixture must never produce a result"); },
  },
});
new Worker<GenerationJobData>(queueName, (job) => processor(job), { connection: { host: redis.hostname, port: Number(redis.port || 6379),
  ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}), maxRetriesPerRequest: null },
  lockDuration: 500, stalledInterval: 100, maxStalledCount: 1 });
