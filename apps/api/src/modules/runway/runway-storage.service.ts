import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

/** Private media stays behind the project API, including range playback. */
@Injectable()
export class RunwayStorage {
  private client: S3Client | undefined;
  private configuration() {
    const required = (name: string) => {
      const value = process.env[name]?.trim();
      if (!value) throw new Error(`缺少对象存储配置 ${name}`);
      return value;
    };
    this.client ??= new S3Client({
      credentials: {
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      region: process.env.S3_REGION || "us-east-1",
    });
    return { client: this.client, bucket: required("S3_BUCKET") };
  }
  async copy(sourceKey: string, destinationKey: string, checksum = false) {
    const { client, bucket } = this.configuration();
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    let sha256: string | undefined;
    if (checksum) {
      const source = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: sourceKey }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (!source.Body) throw new Error("素材文件为空");
      sha256 = createHash("sha256")
        .update(await source.Body.transformToByteArray())
        .digest("hex");
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: destinationKey,
        CopySource: [bucket, ...sourceKey.split("/")]
          .map(encodeURIComponent)
          .join("/"),
        CacheControl: "private, no-store",
        MetadataDirective: "REPLACE",
        ContentType: head.ContentType ?? "image/png",
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    return {
      sizeBytes: head.ContentLength ?? 0,
      mimeType: head.ContentType ?? "image/png",
      sha256,
    };
  }
  async get(key: string, range?: string) {
    const { client, bucket } = this.configuration();
    return client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );
  }
  async delete(key: string) {
    const { client, bucket } = this.configuration();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
  }
}
