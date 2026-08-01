import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const STORAGE_OPERATION_TIMEOUT_MS = 15_000;

export interface ThumbnailStorage {
  delete(objectKey: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
}

export interface ExportStorage {
  delete(objectKey: string): Promise<void>;
  putTemporary(
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少对象存储配置 ${name}`);
  }
  return value;
}

export class S3ThumbnailStorage implements ThumbnailStorage {
  private readonly bucket = requiredEnvironment("S3_BUCKET");
  private readonly client = new S3Client({
    credentials: {
      accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
    },
    ...(process.env.S3_ENDPOINT?.trim()
      ? { endpoint: process.env.S3_ENDPOINT.trim() }
      : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    region: process.env.S3_REGION?.trim() || "auto",
  });

  async get(objectKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
    if (!response.Body) {
      throw new Error(`对象 ${objectKey} 没有可读取的内容`);
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async put(
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        CacheControl: "private, max-age=31536000, immutable",
        ContentType: contentType,
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }

  async putTemporary(
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        CacheControl: "private, no-store, max-age=0",
        ContentType: contentType,
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }
}
