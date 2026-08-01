import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";

export interface StoredObjectHead {
  readonly checksumSha256: string | undefined;
  readonly contentLength: number;
  readonly contentType: string | undefined;
}

export interface FileStorage {
  createUploadUrl(
    objectKey: string,
    mimeType: string,
    checksumSha256?: string,
  ): Promise<string>;
  createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number,
    fileName?: string,
  ): Promise<string>;
  delete(objectKey: string): Promise<void>;
  head(objectKey: string): Promise<StoredObjectHead>;
  publicUrl(objectKey: string): string;
  readPrefix(objectKey: string, maxBytes: number): Promise<Uint8Array>;
}

const FILE_STORAGE_OPERATION_TIMEOUT_MS = 10_000;

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

  async createUploadUrl(
    objectKey: string,
    mimeType: string,
    checksumSha256?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        ...(checksumSha256 ? { ChecksumSHA256: checksumSha256 } : {}),
        ContentType: mimeType,
        Key: objectKey,
      }),
      { expiresIn: 10 * 60 },
    );
  }

  async createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number,
    fileName?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        Key: objectKey,
        ...(fileName
          ? {
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            }
          : {}),
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async head(objectKey: string): Promise<StoredObjectHead> {
    const response = await this.getClient().send(
      new HeadObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        ChecksumMode: "ENABLED",
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(FILE_STORAGE_OPERATION_TIMEOUT_MS) },
    );
    return {
      checksumSha256: response.ChecksumSHA256,
      contentLength: response.ContentLength ?? -1,
      contentType: response.ContentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(FILE_STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }

  async readPrefix(objectKey: string, maxBytes: number): Promise<Uint8Array> {
    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: requiredEnvironment("S3_BUCKET"),
        Key: objectKey,
        Range: `bytes=0-${Math.max(maxBytes - 1, 0)}`,
      }),
      { abortSignal: AbortSignal.timeout(FILE_STORAGE_OPERATION_TIMEOUT_MS) },
    );
    if (!response.Body) {
      throw new Error("对象存储未返回文件内容");
    }
    return response.Body.transformToByteArray();
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
