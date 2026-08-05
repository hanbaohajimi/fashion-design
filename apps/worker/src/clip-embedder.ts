import {
  pipeline,
  RawImage,
  type ImageFeatureExtractionPipelineType,
} from "@huggingface/transformers";
import sharp from "sharp";
import type { ThumbnailStorage } from "./storage";

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

  constructor(private readonly storage?: Pick<ThumbnailStorage, "get">) {}

  async embed(imageUrl: string): Promise<readonly number[]> {
    const extractor = await this.getExtractor();
    const tensor = await extractor(await this.resolveImage(imageUrl));
    const values = Array.from(tensor.data, (value) => Number(value));
    const magnitude = Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0),
    );
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      throw new Error("CLIP 返回了无效的图像特征");
    }
    return values.map((value) => value / magnitude);
  }

  private async resolveImage(imageUrl: string): Promise<string | RawImage> {
    if (!imageUrl.startsWith("s3://")) return imageUrl;
    if (!this.storage) {
      throw new Error("私有系列资产缺少对象存储读取器");
    }
    const body = await this.storage.get(imageUrl.slice("s3://".length));
    const metadata = await sharp(body, { failOn: "error" }).metadata();
    if (!metadata.format) {
      throw new Error("无法识别私有系列资产的图片格式");
    }
    const normalized = await sharp(body, { failOn: "error" })
      .rotate()
      .resize({
        fit: "inside",
        height: 512,
        width: 512,
        withoutEnlargement: true,
      })
      .removeAlpha()
      .png()
      .toBuffer();
    return RawImage.fromBlob(
      new Blob([Uint8Array.from(normalized).buffer], { type: "image/png" }),
    );
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
