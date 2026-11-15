import type {
  AiGenerationRequest,
  AiReferenceImageRole,
} from "./provider.interface";

export const MAX_GENERATION_IMAGE_INPUTS = 16;

export interface GenerationImageInputs {
  readonly urls: readonly string[];
  readonly references: readonly {
    readonly order: number;
    readonly role?: AiReferenceImageRole | undefined;
    readonly url: string;
    readonly weight?: number | undefined;
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
  if (request.referencePolicy === "instruction" && request.taskType !== "inpaint" && !request.imageEdit && structured.length) {
    const ordered = structured.map((reference) => reference.url);
    const urls = source && !ordered.includes(source) ? [source, ...ordered] : ordered;
    return { urls, references: structured.map((reference) => ({ ...reference, imageNumber: urls.indexOf(reference.url) + 1 })) };
  }
  // Feedback adds one server-rendered marker image after the source. It is not
  // a user reference and must not renumber the user's explicit inputs.
  const marker = request.referencePolicy === "instruction" && request.imageEdit?.intent === "feedback" && structured.length
    ? request.referenceImageUrls?.find((url) => url !== source && !structured.some((reference) => reference.url === url)) : undefined;
  const urls: string[] = [...(source ? [source] : []), ...(marker ? [marker] : [])];
  const references: GenerationImageInputs["references"][number][] = [];
  for (const [index, url] of explicitUrls.entries()) {
    const isSource = source && url === source;
    if (!isSource) urls.push(url);
    const reference = structured[index];
    // Keep visible reference numbering even when a reference is the edit source.
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
