import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";

export interface StoredObjectHead {
  readonly contentLength: number;
  readonly contentType: string | undefined;
}

export interface FileStorage {
  createUploadUrl(objectKey: string, mimeType: string): Promise<string>;
  head(objectKey: string): Promise<StoredObjectHead>;
  publicUrl(objectKey: string): string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少对象存储配置 ${name}`);
  }
  return value;
}

@Injectable()
export class S3FileStorage implements FileStorage {
  private client: S3Client | undefined;

  async createUploadUrl(objectKey: string, mimeType: string): Promise<string> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    return getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        ContentType: mimeType,
        Key: objectKey,
      }),
      { expiresIn: 10 * 60 },
    );
  }

  async head(objectKey: string): Promise<StoredObjectHead> {
    const response = await this.getClient().send(
      new HeadObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        Key: objectKey,
      }),
    );
    return {
      contentLength: response.ContentLength ?? -1,
      contentType: response.ContentType,
    };
  }

  publicUrl(objectKey: string): string {
    const origin = requiredEnvironment("ASSET_CDN_ORIGIN").replace(/\/+$/, "");
    return `${origin}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  }

  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = process.env.S3_ENDPOINT?.trim();
      this.client = new S3Client({
        credentials: {
          accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
        },
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        region: process.env.S3_REGION?.trim() || "auto",
      });
    }
    return this.client;
  }
}
