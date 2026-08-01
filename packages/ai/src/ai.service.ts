import { AiProviderError, normalizeProviderError } from "./ai.errors";
import {
  aiGenerationRequestSchema,
  type AiGenerationRequest,
  type AiProvider,
  type AiProviderJob,
  type AiProviderJobStatus,
  type AiProviderResult,
} from "./provider.interface";

export interface AiServiceOptions {
  readonly primaryProvider: string;
  readonly fallbackProvider?: string;
  readonly timeoutMs: number;
  readonly retryBaseMs: number;
  readonly maxRetries: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class AiRuntimeService {
  private readonly providers: Map<string, AiProvider>;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    providerRegistry: AiProvider[],
    private readonly options: AiServiceOptions,
  ) {
    this.providers = new Map(
      providerRegistry.map((provider) => [provider.name, provider]),
    );
    if (this.providers.size !== providerRegistry.length) {
      throw new Error("AI Provider 名称必须唯一");
    }
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async submit(
    request: AiGenerationRequest,
    externalSignal?: AbortSignal,
  ): Promise<AiProviderJob> {
    const parsed = aiGenerationRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new AiProviderError({
        code: "INVALID_REQUEST",
        provider: "ai",
        message: "生成参数不合法",
        cause: parsed.error,
      });
    }

    const primary = this.getProvider(this.options.primaryProvider);
    this.assertSupport(primary, parsed.data.taskType);

    try {
      return await this.invoke(
        primary,
        (signal) => primary.submit(parsed.data, signal),
        externalSignal,
      );
    } catch (error) {
      const normalized = normalizeProviderError(primary.name, error);
      if (
        normalized.code !== "RATE_LIMITED" ||
        !this.options.fallbackProvider
      ) {
        throw normalized;
      }

      const fallback = this.getProvider(this.options.fallbackProvider);
      this.assertSupport(fallback, parsed.data.taskType);
      return this.invoke(
        fallback,
        (signal) => fallback.submit(parsed.data, signal),
        externalSignal,
      );
    }
  }

  async cancel(
    job: AiProviderJob,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const provider = this.getProvider(job.provider);
    if (!provider.cancel) {
      return;
    }
    await this.invoke(
      provider,
      (signal) => provider.cancel?.(job, signal) ?? Promise.resolve(),
      externalSignal,
    );
  }

  async getStatus(
    job: AiProviderJob,
    externalSignal?: AbortSignal,
  ): Promise<AiProviderJobStatus> {
    const provider = this.getProvider(job.provider);
    return this.invoke(
      provider,
      (signal) => provider.getStatus(job, signal),
      externalSignal,
    );
  }

  async getResult(
    job: AiProviderJob,
    externalSignal?: AbortSignal,
  ): Promise<AiProviderResult> {
    const provider = this.getProvider(job.provider);
    return this.invoke(
      provider,
      (signal) => provider.getResult(job, signal),
      externalSignal,
    );
  }

  private getProvider(name: string): AiProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new AiProviderError({
        code: "INVALID_REQUEST",
        provider: "ai",
        message: `未配置 AI Provider: ${name}`,
      });
    }
    return provider;
  }

  private assertSupport(
    provider: AiProvider,
    taskType: AiGenerationRequest["taskType"],
  ): void {
    if (!provider.supports(taskType)) {
      throw new AiProviderError({
        code: "INVALID_REQUEST",
        provider: provider.name,
        message: `${provider.name} 不支持 ${taskType} 任务`,
      });
    }
  }

  private async invoke<T>(
    provider: AiProvider,
    operation: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    for (let retry = 0; retry <= this.options.maxRetries; retry += 1) {
      try {
        return await this.withTimeout(provider.name, operation, externalSignal);
      } catch (error) {
        const normalized = normalizeProviderError(provider.name, error);
        const canRetry =
          normalized.retryable && retry < this.options.maxRetries;
        if (!canRetry) {
          throw normalized;
        }
        await this.sleep(this.options.retryBaseMs * 2 ** retry);
      }
    }

    throw new AiProviderError({
      code: "UNKNOWN",
      provider: provider.name,
      message: "AI Provider 请求失败",
    });
  }

  private async withTimeout<T>(
    provider: string,
    operation: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abortFromExternal, {
      once: true,
    });
    if (externalSignal?.aborted) {
      abortFromExternal();
    }

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new AiProviderError({
            code: "TIMEOUT",
            provider,
            message: "AI Provider 请求超时",
          }),
        );
      }, this.options.timeoutMs);
    });

    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }
}
