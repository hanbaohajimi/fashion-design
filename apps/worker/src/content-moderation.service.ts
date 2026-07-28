import OpenAI from "openai";

export type ContentModerationDecision =
  | {
      readonly status: "approved";
      readonly categories: readonly string[];
    }
  | {
      readonly status: "rejected";
      readonly categories: readonly string[];
    }
  | {
      readonly status: "review_required";
      readonly categories: readonly string[];
      readonly reason: "timeout" | "unavailable";
    };

export interface ContentModerationService {
  moderate(imageUrls: readonly string[]): Promise<ContentModerationDecision>;
}

export class OpenAiContentModerationService
  implements ContentModerationService
{
  constructor(
    private readonly injectedModerations?: Pick<
      OpenAI["moderations"],
      "create"
    >,
  ) {}

  async moderate(
    imageUrls: readonly string[],
  ): Promise<ContentModerationDecision> {
    if (imageUrls.length === 0) {
      return {
        categories: [],
        reason: "unavailable",
        status: "review_required",
      };
    }

    let moderations = this.injectedModerations;
    if (!moderations) {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        return {
          categories: [],
          reason: "unavailable",
          status: "review_required",
        };
      }
      moderations = new OpenAI({
        apiKey,
        maxRetries: 0,
        timeout: moderationTimeoutMs(),
      }).moderations;
    }

    try {
      const response = await moderations.create({
        input: imageUrls.map((url) => ({
          image_url: { url },
          type: "image_url" as const,
        })),
        model: "omni-moderation-latest",
      });
      const categories = [
        ...new Set(
          response.results.flatMap((result) =>
            Object.entries(result.categories)
              .filter(([, flagged]) => flagged)
              .map(([category]) => category),
          ),
        ),
      ];
      return response.results.some((result) => result.flagged)
        ? { categories, status: "rejected" }
        : { categories, status: "approved" };
    } catch (error) {
      return {
        categories: [],
        reason:
          error instanceof OpenAI.APIConnectionTimeoutError
            ? "timeout"
            : "unavailable",
        status: "review_required",
      };
    }
  }
}

function moderationTimeoutMs(): number {
  const configured = Number(process.env.CONTENT_MODERATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.min(configured, 60_000)
    : 12_000;
}
