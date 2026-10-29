import { setTimeout as delay } from "node:timers/promises";

// Retry registry throttling only. Invalid images, auth/configuration errors and
// application failures must still stop the isolated acceptance run immediately.
export async function retryImagePull(operation, {
  sleep = delay,
  report = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const delays = [15_000, 30_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const imagePull = /failed to pull docker image|error pulling image configuration/iu.test(message);
      const throttled = /toomanyrequests|too many requests|\b429\b/iu.test(message);
      if (!imagePull || !throttled || attempt >= delays.length) throw error;
      report(`镜像仓库限流，${delays[attempt] / 1000} 秒后重试 Supabase 启动（${attempt + 2}/3）。详见 output/trial-runtime/supabase-start.log`);
      await sleep(delays[attempt]);
    }
  }
}
