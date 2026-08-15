import { AiProviderError } from "../ai.errors";
import type {
  AiGenerationRequest,
  AiProvider,
  AiProviderJob,
  AiProviderJobStatus,
  AiProviderResult,
} from "../provider.interface";

export interface MockAdapterOptions {
  name?: string;
  latencyMs?: number;
  imageUrl?: string;
  rawCost?: number;
  credits?: number;
  submitError?: AiProviderError;
  statusError?: AiProviderError;
  resultError?: AiProviderError;
}

export class MockAdapter implements AiProvider {
  readonly name: string;
  readonly submittedRequests: AiGenerationRequest[] = [];

  private readonly jobs = new Map<string, AiProviderJob>();
  private sequence = 0;

  constructor(private readonly options: MockAdapterOptions = {}) {
    this.name = options.name ?? "mock";
  }

  supports(taskType: AiGenerationRequest["taskType"]): boolean {
    return taskType === "t2i" || taskType === "i2i" || taskType === "inpaint";
  }

  async cancel(job: AiProviderJob, signal: AbortSignal): Promise<void> {
    await this.wait(signal);
    this.jobs.delete(job.providerJobId);
  }

  async submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob> {
    await this.wait(signal);
    if (this.options.submitError) {
      throw this.options.submitError;
    }

    this.submittedRequests.push(request);
    const providerJobId = `${this.name}-${++this.sequence}`;
    const job: AiProviderJob = {
      provider: this.name,
      providerJobId,
      model: "mock/image-generator",
      taskType: request.taskType,
      submittedAt: new Date().toISOString(),
      cost: {
        rawCost: this.options.rawCost ?? 0,
        credits: this.options.credits ?? 0,
        currency: "USD",
        billableMegapixels: Math.max(
          1,
          Math.ceil((request.width * request.height) / 1_000_000),
        ),
        estimated: true,
      },
    };
    this.jobs.set(providerJobId, job);
    return job;
  }

  async getStatus(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderJobStatus> {
    await this.wait(signal);
    if (this.options.statusError) {
      throw this.options.statusError;
    }
    this.assertJob(job);
    return { status: "completed" };
  }

  async getResult(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    await this.wait(signal);
    if (this.options.resultError) {
      throw this.options.resultError;
    }
    this.assertJob(job);
    return {
      job,
      images: [
        {
          url:
            this.options.imageUrl ??
            `https://example.test/generated/${job.providerJobId}.png`,
        },
      ],
      cost: job.cost,
    };
  }

  private assertJob(job: AiProviderJob): void {
    if (job.provider !== this.name || !this.jobs.has(job.providerJobId)) {
      throw new AiProviderError({
        code: "NOT_FOUND",
        provider: this.name,
        message: "Mock 任务不存在",
      });
    }
  }

  private async wait(signal: AbortSignal): Promise<void> {
    const latencyMs = this.options.latencyMs ?? 0;
    if (signal.aborted) {
      throw this.abortError();
    }
    if (latencyMs === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, latencyMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(this.abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private abortError(): Error {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
  }
}
