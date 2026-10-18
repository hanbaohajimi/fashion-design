import { createHash, randomUUID } from "node:crypto";

const defaults: Readonly<Record<string, string>> = {
  ASSET_CDN_ORIGIN: "http://localhost:9000/fashion-assets",
  DATABASE_URL:
    "postgresql://fashion:fashion_dev@localhost:5432/fashion_design?schema=public",
  REDIS_URL: "redis://localhost:6379",
  S3_ACCESS_KEY_ID: "fashion_minio",
  S3_BUCKET: "fashion-assets",
  S3_ENDPOINT: "http://localhost:9000",
  S3_FORCE_PATH_STYLE: "true",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "fashion_minio_dev_secret",
};
for (const [name, value] of Object.entries(defaults)) {
  process.env[name] ??= value;
}

async function main(): Promise<void> {
  const [{ prisma, FileStatus }, { FilesService }, { S3FileStorage }, worker] =
    await Promise.all([
      import("../packages/db/src/client"),
      import("../apps/api/src/modules/files/files.service"),
      import("../apps/api/src/modules/files/storage.service"),
      import("../apps/worker/src/processors/thumbnail.processor"),
    ]);
  const { S3ThumbnailStorage } = await import("../apps/worker/src/storage");

  // 2×2 opaque PNG. The original bytes are uploaded unchanged and compared later.
  const original = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const sha256 = createHash("sha256").update(original).digest("hex");
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `file-pipeline-${suffix}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "File pipeline workspace",
          projects: { create: { name: "File pipeline project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) {
    throw new Error("无法创建文件管线验收项目");
  }

  const queued: string[] = [];
  const apiStorage = new S3FileStorage();
  const service = new FilesService(prisma, apiStorage, {
    enqueue(fileId) {
      queued.push(fileId);
      return Promise.resolve();
    },
  });

  try {
    const signed = await service.signUpload(user.id, {
      mimeType: "image/png",
      name: "pipeline.png",
      projectId: project.id,
      sha256,
      size: original.length,
    });
    if (!signed.upload) {
      throw new Error("新文件没有返回 PUT 直传签名");
    }
    const signedHeaders = new URL(signed.upload.url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    if (!signedHeaders.split(";").includes("content-length")) throw new Error("上传签名未约束 Content-Length");
    const oversized = Buffer.concat([original, Buffer.from([0])]);
    // A matching checksum isolates length verification from checksum rejection.
    const oversizedChecksum = createHash("sha256").update(oversized).digest("base64");
    const probeKey = `temporary/length-probe/${suffix}`;
    const lengthProbe = await apiStorage.createUploadUrl(probeKey, "image/png", original.length, oversizedChecksum);
    const rejected = await fetch(lengthProbe, { method: "PUT", body: oversized, headers: { "Content-Type": "image/png", "x-amz-checksum-sha256": oversizedChecksum } });
    if (rejected.ok) {
      await apiStorage.delete(probeKey);
      throw new Error("对象存储未拒绝超出签名长度的上传");
    }
    await rejected.body?.cancel();
    const putResponse = await fetch(signed.upload.url, {
      method: signed.upload.method,
      body: original,
      headers: signed.upload.headers,
    });
    if (!putResponse.ok) {
      throw new Error(`直传失败：HTTP ${putResponse.status}`);
    }

    await service.complete(user.id, signed.file.id);
    if (queued.length !== 1 || queued[0] !== signed.file.id) {
      throw new Error("缩略图任务没有正确入队");
    }

    const workerStorage = new S3ThumbnailStorage();
    const processThumbnail = worker.createThumbnailProcessor({
      database: prisma,
      storage: workerStorage,
    });
    await processThumbnail(signed.file.id);
    const ready = await service.get(user.id, signed.file.id);
    if (
      ready.status !== FileStatus.READY ||
      !ready.thumbnail256Url ||
      !ready.thumbnail1024Url
    ) {
      throw new Error("两档缩略图没有生成");
    }

    const originalKey = `originals/${user.id}/${signed.file.id}/source`;
    const thumbnailDownloadUrl = await service.thumbnailUrl(
      user.id,
      signed.file.id,
      "256",
    );
    const [
      persistedOriginal,
      publicOriginalResponse,
      publicThumbnailResponse,
      thumbnailResponse,
    ] =
      await Promise.all([
        workerStorage.get(originalKey),
        fetch(`${process.env.ASSET_CDN_ORIGIN}/${originalKey}`),
        fetch(
          `${process.env.ASSET_CDN_ORIGIN}/thumbnails/${user.id}/${signed.file.id}/256.webp`,
        ),
        fetch(thumbnailDownloadUrl),
      ]);
    if (
      createHash("sha256").update(persistedOriginal).digest("hex") !== sha256
    ) {
      throw new Error("对象存储中的原图与上传字节不一致");
    }
    if (publicOriginalResponse.ok) {
      throw new Error("原图不应通过公开 CDN 地址访问");
    }
    if (publicThumbnailResponse.ok) {
      throw new Error("缩略图不应通过匿名 CDN 地址访问");
    }
    if (
      !thumbnailResponse.ok ||
      thumbnailResponse.headers.get("content-type") !== "image/webp"
    ) {
      throw new Error("鉴权缩略图不可读取或类型错误");
    }

    const deduplicated = await service.signUpload(user.id, {
      mimeType: "image/png",
      name: "same-content.png",
      projectId: project.id,
      sha256,
      size: original.length,
    });
    const rowCount = await prisma.fileAsset.count({
      where: { ownerId: user.id, sha256 },
    });
    if (!deduplicated.deduplicated || deduplicated.upload || rowCount !== 1) {
      throw new Error("SHA256 去重未命中或创建了重复行");
    }

    console.log(
      JSON.stringify({
        oversizedUploadRejected: true,
        deduplicated: true,
        originalBytes: persistedOriginal.length,
        status: ready.status,
        thumbnail1024: ready.thumbnail1024Url,
        thumbnail256: ready.thumbnail256Url,
      }),
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
