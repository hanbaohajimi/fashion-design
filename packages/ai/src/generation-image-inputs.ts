import type {
  AiGenerationRequest,
  AiReferenceImageRole,
} from "./provider.interface";

export const MAX_GENERATION_IMAGE_INPUTS = 16;

export interface GenerationImageInputs {
  readonly urls: readonly string[];
  readonly references: readonly {
    readonly order: number;
    readonly role: AiReferenceImageRole;
    readonly url: string;
    readonly weight: number;
    /** One-based position in the actual multipart image list. */
    readonly imageNumber: number;
  }[];
}

/** Resolve creation references and edit sources once for validation and transport. */
export function resolveGenerationImageInputs(
  request: AiGenerationRequest,
): GenerationImageInputs {
  const structured =
    "referenceImages" in request && request.referenceImages?.length
      ? [...request.referenceImages].sort(
          (left, right) => left.order - right.order,
        )
      : [];
  const explicitUrls = structured.length
    ? structured.map((reference) => reference.url)
    : (request.referenceImageUrls ?? []);
  // For creation the singular field is a legacy alias. For editing it is the source.
  const source =
    request.taskType !== "t2i" ? request.referenceImageUrl : undefined;
  const urls: string[] = source ? [source] : [];
  const references: GenerationImageInputs["references"][number][] = [];
  for (const [index, url] of explicitUrls.entries()) {
    const isSource = source && url === source;
    if (!isSource) urls.push(url);
    const reference = structured[index];
    // Retain each role, including different uses of the same source image.
    if (reference)
      references.push({
        ...reference,
        imageNumber: isSource ? 1 : urls.length,
      });
  }
  if (!urls.length && request.referenceImageUrl)
    urls.push(request.referenceImageUrl);
  return { urls, references };
}

export function generationImageInputLimitError(
  request: AiGenerationRequest,
  reservedImages = 0,
): string | undefined {
  return resolveGenerationImageInputs(request).urls.length + reservedImages >
    MAX_GENERATION_IMAGE_INPUTS
    ? `生成请求含原图最多${MAX_GENERATION_IMAGE_INPUTS}张图片，请减少参考图后重试`
    : undefined;
}
