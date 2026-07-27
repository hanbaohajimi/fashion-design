import { Inject, Injectable } from "@nestjs/common";

import { AiProviderError, normalizeProviderError } from "./ai.errors";
import {
  AI_PROVIDERS,
  AI_SERVICE_OPTIONS,
  type AiProviderRegistry,
  type AiServiceOptions,
} from "./ai.tokens";
import {
  aiGenerationRequestSchema,
  type AiGenerationRequest,
  type AiProvider,
  type AiProviderJob,
  type AiProviderJobStatus,
  type AiProviderResult,
} from "./interfaces/provider.interface";

@Injectable()
export class AiService {
  private readonly providers: Map<string, AiProvider>;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    @Inject(AI_PROVIDERS) providerRegistry: AiProviderRegistry,
    @Inject(AI_SERVICE_OPTIONS) private readonly options: AiServiceOptions,
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

  /**
   * 只提交 Provider 的远端队列并立即返回 job，不在 API 请求内等待生成完成。
   */
  async submit(request: AiGenerationRequest): Promise<AiProviderJob> {
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
      return await this.invoke(primary, (signal) =>
        primary.submit(parsed.data, signal),
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
      return this.invoke(fallback, (signal) =>
        fallback.submit(parsed.data, signal),
      );
    }
  }

  async getStatus(job: AiProviderJob): Promise<AiProviderJobStatus> {
    const provider = this.getProvider(job.provider);
    return this.invoke(provider, (signal) =>
      provider.getStatus(job, signal),
    );
  }

  async getResult(job: AiProviderJob): Promise<AiProviderResult> {
    const provider = this.getProvider(job.provider);
    return this.invoke(provider, (signal) =>
      provider.getResult(job, signal),
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
  ): Promise<T> {
    for (let retry = 0; retry <= this.options.maxRetries; retry += 1) {
      try {
        return await this.withTimeout(provider.name, operation);
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
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
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
    }
  }
}
