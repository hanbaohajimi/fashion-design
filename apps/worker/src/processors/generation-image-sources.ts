import {
  AiProviderError,
  resolveGenerationImageInputs,
  type AiGenerationRequest,
} from "@fashion/ai";
import { generationImageSourcesSchema } from "@fashion/shared";
import type { ThumbnailStorage } from "../storage";

/** Refresh verified private URLs per attempt without changing reference order or roles. */
export async function refreshGenerationImageSources(
  request: AiGenerationRequest,
  compiledPrompt: unknown,
  storage: ThumbnailStorage | undefined,
): Promise<{ request: AiGenerationRequest; sourceObjectKey?: string }> {
  const snapshot =
    compiledPrompt &&
    typeof compiledPrompt === "object" &&
    "imageSources" in compiledPrompt
      ? compiledPrompt.imageSources
      : undefined;
  if (snapshot === undefined) return { request }; // Legacy tasks never acquire new signing authority.
  const parsed = generationImageSourcesSchema.safeParse(snapshot);
  const activeUrls = new Set(resolveGenerationImageInputs(request).urls);
  if (
    !parsed.success ||
    new Set(parsed.data.entries.map((entry) => entry.url)).size !==
      parsed.data.entries.length ||
    parsed.data.entries.some((entry) => !activeUrls.has(entry.url))
  ) {
    throw new AiProviderError({
      provider: "input",
      code: "INVALID_REQUEST",
      message: "生成参考记录与任务不一致，请重新选择素材后提交",
    });
  }
  if (!storage?.downloadUrl) {
    throw new AiProviderError({
      provider: "input",
      code: "PROVIDER_UNAVAILABLE",
      message: "参考图片存储暂不可用，请稍后重试",
      retryable: true,
    });
  }
  const urls = new Map<string, string>();
  const signedKeys = new Map<string, string>();
  for (const entry of parsed.data.entries) {
    const url =
      signedKeys.get(entry.objectKey) ??
      (await storage.downloadUrl(entry.objectKey));
    signedKeys.set(entry.objectKey, url);
    urls.set(entry.url, url);
  }
  const sourceObjectKey =
    request.taskType !== "t2i"
      ? parsed.data.entries.find(
          (entry) => entry.url === request.referenceImageUrl,
        )?.objectKey
      : undefined;
  return {
    ...(sourceObjectKey ? { sourceObjectKey } : {}),
    request: {
      ...request,
      ...(request.referenceImageUrl
        ? {
            referenceImageUrl:
              urls.get(request.referenceImageUrl) ?? request.referenceImageUrl,
          }
        : {}),
      ...(request.referenceImageUrls
        ? {
            referenceImageUrls: request.referenceImageUrls.map(
              (url) => urls.get(url) ?? url,
            ),
          }
        : {}),
      ...("referenceImages" in request && request.referenceImages
        ? {
            referenceImages: request.referenceImages.map((reference) => ({
              ...reference,
              url: urls.get(reference.url) ?? reference.url,
            })),
          }
        : {}),
    },
  };
}
