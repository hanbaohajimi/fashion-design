import {
  pipeline,
  type ImageFeatureExtractionPipelineType,
} from "@huggingface/transformers";

const DEFAULT_CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const createImageFeatureExtractor = pipeline as unknown as (
  task: "image-feature-extraction",
  model: string,
  options: { readonly dtype: "q8" },
) => Promise<ImageFeatureExtractionPipelineType>;

export interface ImageEmbedder {
  embed(imageUrl: string): Promise<readonly number[]>;
}

export class ClipImageEmbedder implements ImageEmbedder {
  private extractor: Promise<ImageFeatureExtractionPipelineType> | undefined;

  async embed(imageUrl: string): Promise<readonly number[]> {
    const extractor = await this.getExtractor();
    const tensor = await extractor(imageUrl);
    const values = Array.from(tensor.data, (value) => Number(value));
    const magnitude = Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0),
    );
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      throw new Error("CLIP 返回了无效的图像特征");
    }
    return values.map((value) => value / magnitude);
  }

  private getExtractor(): Promise<ImageFeatureExtractionPipelineType> {
    this.extractor ??= createImageFeatureExtractor(
      "image-feature-extraction",
      process.env.CLIP_MODEL_ID ?? DEFAULT_CLIP_MODEL,
      { dtype: "q8" },
    );
    return this.extractor;
  }
}
