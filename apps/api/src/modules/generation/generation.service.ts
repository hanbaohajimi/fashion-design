import { Inject, Injectable } from "@nestjs/common";

import { AiService } from "../ai/ai.service";
import type {
  AiGenerationRequest,
  AiProviderJob,
  AiProviderJobStatus,
  AiProviderResult,
} from "../ai/interfaces/provider.interface";
import { GenerationLimitExceededException } from "../billing/billing.errors";
import { BillingService } from "../billing/billing.service";

@Injectable()
export class GenerationService {
  constructor(
    @Inject(AiService) private readonly aiService: AiService,
    @Inject(BillingService) private readonly billingService: BillingService,
  ) {}

  async submit(
    userId: string,
    request: AiGenerationRequest,
  ): Promise<AiProviderJob> {
    const quota = await this.billingService.canGenerate(userId);
    if (!quota.allowed) {
      throw new GenerationLimitExceededException();
    }

    return this.aiService.submit(request);
  }

  async getStatus(job: AiProviderJob): Promise<AiProviderJobStatus> {
    return this.aiService.getStatus(job);
  }

  async getResult(
    userId: string,
    job: AiProviderJob,
  ): Promise<AiProviderResult> {
    const result = await this.aiService.getResult(job);
    await this.billingService.incrementCount(userId);
    return result;
  }
}
