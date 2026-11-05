import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve, relative, isAbsolute } from "node:path";
import {
  fingerprint,
  assertDisplayCandidate,
  assertDerivedDisplayCandidate,
  assertConfirmedFrontReference,
  assertAuthoredStructureGuide,
  assertMaterialProbeEvidence,
  assertMaterialDeriveOperation,
  materialOperation,
  assertNextStageScope,
  assertCorrectionGuideWire,
  assertModelOnlyComparison,
  assertNativeSideCutoutSource,
  assertProbeParentReview,
  assertNativeSideHop,
  assertDerivedNativeSideHop,
  nativeSourceReviewName,
  assertNativeContinuationScope,
  ensureSideFront,
  readJson,
  readNativeSidePreparation,
  preserveNativeInputPreparation,
  reserveCall,
  sideInpaintRegistration,
  unreviewedCandidate,
  writeJson,
} from "./wardrobe-provider-journal.mjs";
import {
  AmuxAdapter,
  AmuxHttpTransport,
  AiRuntimeService,
  inspectMaskedRgbInterior,
  amuxAdapterConfigFromEnv,
  createReferenceImageLoader,
  createAmuxClaudeClientFromEnv,
  type AiGenerationRequest,
} from "../../packages/ai/src/index";
import { assertTransparentGarment } from "../../apps/api/src/modules/wardrobe/wardrobe-media";
import { preparationPrompt } from "../../apps/api/src/modules/wardrobe/wardrobe.rules";
import type { WardrobeCategory } from "../../packages/shared/src/wardrobe";
import type { GenerationJobData } from "../../packages/shared/src/index";

type Case = {
  id: string;
  name: string;
  category: string;
  display: string;
  sourcePrompt: string;
  sourceEditPrompt?: string;
  processingProbe?: boolean;
  derivedProcessingIntermediate?: boolean;
  operation?: "transparency" | "correction";
  materialOperation?: "transparency" | "correction";
  nextStageScope?: { file: string; sha256: string };
  correctionGuide?: {
    sourceSha256: string;
    maskSha256: string;
    guideSha256: string;
    reviewFile: string;
  };
  notes: string;
  materialTags?: string[];
  anchor?: { x: number; y: number };
  materialReference?: {
    sourceFile: string;
    sourceSha256: string;
    roiFile: string;
    roiSha256: string;
    roiPixels: { x: number; y: number; width: number; height: number };
  };
  structureGuide?: {
    file: string;
    sha256: string;
    width: number;
    height: number;
    authored: boolean;
    role: string;
    frontAssetId: string;
    frontRevisionId: string;
    frontSha256: string;
    reviewFile: string;
  };
};
const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`缺少${key}`);
  return value;
};
const root = process.cwd();
const out = requiredEnv("WARDROBE_PROVIDER_OUT");
const baseOut = process.env.WARDROBE_PROVIDER_BASE_OUT || out;
const run = readJson(resolve(baseOut, "run.json"));
const config = amuxAdapterConfigFromEnv();
const selected = requiredEnv("WARDROBE_PROVIDER_IDS").split(",");
const cases: Case[] = readJson(
  requiredEnv("WARDROBE_PROVIDER_CASES"),
).items.filter((item: Case) => selected.includes(item.id));
const context = new AsyncLocalStorage<{ item: Case; stage: string }>();
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const sharp: typeof import("../../apps/api/node_modules/sharp").default =
  apiRequire("sharp");
const nativeFetch = globalThis.fetch;
const directory = (item: Case) => resolve(out, item.id);
const baseDirectory = (item: Case) => resolve(baseOut, item.id);
const frontReceipt = (item: Case) =>
  readJson(resolve(baseDirectory(item), "current-confirmed.json")) ??
  readJson(resolve(baseDirectory(item), "confirmed.json"));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const safeError = (error: unknown) => ({
  name: error instanceof Error ? error.name : "Error",
  code:
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : undefined,
});

// Record actual HTTP status/request IDs/usage; never persist headers, keys or signed URLs.
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const current = context.getStore();
  const remote =
    current &&
    url.origin === new URL(config.baseUrl).origin &&
    init?.method === "POST";
  if (remote)
    writeJson(
      resolve(
        directory(current.item),
        `${current.stage}-${url.pathname.endsWith("/messages") ? "moderation" : "image"}-http.json`,
      ),
      {
        endpoint: url.origin + url.pathname,
        status: "submitted-unknown",
        sentAt: new Date().toISOString(),
        actualCost: "unknown-until-provider-billing",
      },
    );
  const response = await nativeFetch(input, init);
  if (remote) {
    const data = (await response
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    const file = resolve(
      directory(current.item),
      `${current.stage}-${url.pathname.endsWith("/messages") ? "moderation" : "image"}-http.json`,
    );
    writeJson(file, {
      endpoint: url.origin + url.pathname,
      status: response.status,
      requestId:
        response.headers.get("x-request-id") ??
        response.headers.get("request-id"),
      responseId: data?.id ?? null,
      usage: data?.usage ?? null,
      actualCost: "unknown-until-provider-billing",
      receivedAt: new Date().toISOString(),
    });
  }
  return response;
};

async function persistImage(url: string, file: string) {
  const match = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/u.exec(url);
  let bytes: Buffer;
  if (match?.[1]) bytes = Buffer.from(match[1], "base64");
  else {
    if (new URL(url).protocol !== "https:")
      throw new Error("生成图片URL必须HTTPS");
    const response = await nativeFetch(url, {
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("生成图片下载失败");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length > 25 * 1024 * 1024) throw new Error("生成图片超过25MB");
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (meta.format !== "png") throw new Error("供应商未返回请求的PNG格式");
  writeFileSync(file, bytes);
  return {
    file,
    width: meta.width,
    height: meta.height,
    hasAlpha: meta.hasAlpha,
    sha256: sha(bytes),
  };
}

function makeAdapter() {
  const actual = new AmuxHttpTransport(config);
  const transport = {
    generate: async (body: Record<string, unknown>, signal: AbortSignal) =>
      submit(body, () => actual.generate(body, signal)),
    edit: async (body: FormData, signal: AbortSignal) => {
      const fields: Record<string, unknown> = {};
      let images = 0;
      const references: {
        sha256: string;
        size: number;
        contentType: string;
      }[] = [];
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") fields[key] = value;
        else {
          const evidence = {
            sha256: sha(Buffer.from(await value.arrayBuffer())),
            size: value.size,
            contentType: value.type,
          };
          if (key === "mask") fields.maskImage = evidence;
          else {
            images++;
            references.push(evidence);
          }
        }
      }
      fields.referenceImageCount = images;
      fields.referenceImages = references;
      return submit(fields, () => actual.edit(body, signal));
    },
  };
  return new AmuxAdapter(
    config,
    transport,
    createReferenceImageLoader({
      allowedOrigins: [new URL(requiredEnv("S3_ENDPOINT")).origin],
    }),
  );
}
async function submit(
  request: Record<string, unknown>,
  send: () => Promise<unknown>,
) {
  const active = context.getStore();
  if (!active) throw new Error("真实请求没有证据上下文");
  if (
    active.item.structureGuide &&
    process.env.WARDROBE_PROVIDER_STRUCTURE_GUIDE === "true"
  ) {
    const binding = readJson(
      resolve(directory(active.item), "source-side-binding.json"),
    );
    const mask = readJson(
      resolve(directory(active.item), "inpaint-binding.json"),
    );
    if ((request.referenceImages as unknown[] | undefined)?.length !== 2)
      throw new Error("作者结构guide实际wire必须恰好包含真实源和独立guide两图");
    assertCorrectionGuideWire(
      {
        sourceSha256: binding?.sha256,
        maskSha256: mask?.maskSha256,
        guideSha256: active.item.structureGuide.sha256,
      },
      request,
    );
  }
  if (active.item.correctionGuide) {
    const review = readJson(
      resolve(root, active.item.correctionGuide.reviewFile),
    );
    if (
      review?.decision !== "approved-as-position-guide-only" ||
      review.sourceSha256 !== active.item.correctionGuide.sourceSha256 ||
      review.maskSha256 !== active.item.correctionGuide.maskSha256 ||
      review.guideSha256 !== active.item.correctionGuide.guideSha256 ||
      !review.reviewChecks?.length
    )
      throw new Error("位置guide缺少精确SHA独立审核");
    assertCorrectionGuideWire(active.item.correctionGuide, request);
  }
  if (process.env.WARDROBE_PROVIDER_MATCH_PROMPT) {
    const baseline = readJson(
      process.env.WARDROBE_PROVIDER_MATCH_PROMPT,
    )?.request;
    assertModelOnlyComparison(baseline, request);
  }
  const file = resolve(directory(active.item), `${active.stage}-call.json`);
  reserveCall(file, request);
  console.log(
    `${active.item.id}: ${active.stage} 正在调用真实 ${config.imageModel}`,
  );
  try {
    const response = (await send()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      usage?: unknown;
    };
    const images = [];
    for (const [index, image] of (response.data ?? []).entries()) {
      const imageUrl = image.b64_json
        ? `data:image/png;base64,${image.b64_json}`
        : image.url;
      if (imageUrl)
        images.push(
          await persistImage(
            imageUrl,
            resolve(
              directory(active.item),
              `${active.stage}-provider-${index}.png`,
            ),
          ),
        );
    }
    writeJson(file, {
      ...readJson(file),
      status: "response-received",
      finishedAt: new Date().toISOString(),
      images,
      usage: response.usage ?? null,
      actualCost: "unknown-until-provider-billing",
    });
    return response;
  } catch (error) {
    writeJson(file, {
      ...readJson(file),
      status: "failed-or-unknown-no-auto-retry",
      error: safeError(error),
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function freezeCase(item: Case) {
  if (!/^[a-z0-9-]+$/u.test(item.id))
    throw new Error("case id 必须为安全文件名");
  mkdirSync(directory(item), { recursive: true });
  const file = resolve(directory(item), "case.json");
  const previous = readJson(file);
  if (previous && fingerprint(previous) !== fingerprint(item))
    throw new Error(`${item.id} 清单已改变，请使用新output目录`);
  writeJson(file, item);
}
async function source(item: Case) {
  freezeCase(item);
  const evidence = readJson(resolve(directory(item), "source-call.json"));
  if (
    evidence?.status === "response-received" &&
    evidence.images?.[0]?.file &&
    existsSync(evidence.images[0].file)
  ) {
    if (
      sha(readFileSync(evidence.images[0].file)) !== evidence.images[0].sha256
    )
      throw new Error("已保存source原图hash不一致，禁止继续");
    console.log(`${item.id}: 使用已保存设计源，不重复调用`);
    return;
  }
  const editOut = process.env.WARDROBE_PROVIDER_SOURCE_EDIT_OUT;
  let editReferenceUrl: string | undefined;
  if (editOut) {
    if (!item.sourceEditPrompt)
      throw new Error("源局部修正须有独立明确sourceEditPrompt");
    const originalDirectory = resolve(editOut, item.id);
    const original = readJson(resolve(originalDirectory, "source-call.json"));
    const review = readJson(resolve(originalDirectory, "source-review.json"));
    if (
      original?.status !== "response-received" ||
      original.images?.length !== 1 ||
      review?.decision !== "rejected" ||
      review.stage !== "source" ||
      review.sha256 !== original.images[0].sha256
    )
      throw new Error("source局部修正需要已生成且明确拒绝的同hash设计源");
    const bytes = readFileSync(original.images[0].file);
    if (sha(bytes) !== review.sha256) throw new Error("设计源原图hash不一致");
    const { S3FileStorage } =
      await import("../../apps/api/src/modules/files/storage.service");
    const storage = new S3FileStorage();
    const key = `wardrobe-provider/${run.runId}/attempts/${process.env.WARDROBE_PROVIDER_ATTEMPT}/${item.id}/source-edit-input.png`;
    const binding = {
      originalSourceFile: original.images[0].file,
      originalSha256: review.sha256,
      originalReviewFile: resolve(originalDirectory, "source-review.json"),
      storageKey: key,
      sourceEditPrompt: item.sourceEditPrompt,
    };
    const bindingFile = resolve(directory(item), "source-edit-binding.json");
    const previous = readJson(bindingFile);
    if (previous && fingerprint(previous) !== fingerprint(binding))
      throw new Error("局部源修正的来源与目标已冻结，不可改写");
    writeJson(bindingFile, binding);
    await storage.uploadBuffer(
      key,
      bytes,
      "image/png",
      createHash("sha256").update(bytes).digest("base64"),
    );
    editReferenceUrl = await storage.createDownloadUrl(key, 900);
  }
  const request: AiGenerationRequest = {
    ...(editReferenceUrl
      ? { taskType: "i2i", referenceImageUrl: editReferenceUrl }
      : { taskType: "t2i" }),
    prompt: editReferenceUrl
      ? (item.sourceEditPrompt as string)
      : item.sourcePrompt,
    width: 1024,
    height: 1536,
    outputFormat: "png",
    background: "opaque",
    quality: config.quality,
  };
  await context.run({ item, stage: "source" }, () =>
    makeAdapter().submit(request, AbortSignal.timeout(720_000)),
  );
  console.log(`${item.id}: source原图已保存，待设计规格复核`);
}

async function prepareAll() {
  const command = requiredEnv("WARDROBE_PROVIDER_COMMAND");
  const side =
    command === "side" ||
    command === "side-cutout" ||
    command === "material-probe" ||
    (command === "inpaint" &&
      Boolean(process.env.WARDROBE_PROVIDER_SIDE_SOURCE_OUT));
  const stage = side ? "side" : "candidate";
  const [
    { prisma, DesignAssetOperation },
    { BillingService },
    { GenerationService },
    { BullGenerationJobs },
    { ProjectAccessPolicy },
    { S3FileStorage },
    { S3ThumbnailStorage },
    { createGenerationProcessor },
    { AmuxClaudeContentModerationService },
  ] = await Promise.all([
    Promise.resolve(
      apiRequire(
        "@fashion/db",
      ) as typeof import("../../apps/api/node_modules/@fashion/db"),
    ),
    Promise.resolve(
      apiRequire(
        "@fashion/billing",
      ) as typeof import("../../apps/api/node_modules/@fashion/billing"),
    ),
    import("../../apps/api/src/modules/generation/generation.service"),
    import("../../apps/api/src/modules/generation/generation-queue.service"),
    import("../../apps/api/src/modules/studio/project-access.policy"),
    import("../../apps/api/src/modules/files/storage.service"),
    import("../../apps/worker/src/storage"),
    import("../../apps/worker/src/processors/generation.processor"),
    import("../../apps/worker/src/content-moderation.service"),
  ]);
  const { WardrobeService } =
    await import("../../apps/api/src/modules/wardrobe/wardrobe.service");
  const { Queue, QueueEvents, Worker } = apiRequire(
    "bullmq",
  ) as typeof import("../../apps/api/node_modules/bullmq");
  const schemas = await prisma.$queryRaw<
    Array<{ current_schema: string }>
  >`SELECT current_schema()`;
  if (
    schemas[0]?.current_schema !== run.schema ||
    !run.schema.startsWith("wardrobe_provider_")
  )
    throw new Error("数据库隔离失败");
  const storage = new S3FileStorage();
  const access = new ProjectAccessPolicy(prisma);
  const billing = new BillingService(prisma);
  const jobs = new BullGenerationJobs();
  const redis = new URL(requiredEnv("REDIS_URL"));
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    password: redis.password || undefined,
  };
  const queueName = `wardrobe-provider-${run.runId}`;
  const prefix = `wardrobe-provider-${run.runId}`;
  const queue = new Queue<GenerationJobData>(queueName, {
    connection,
    prefix,
    defaultJobOptions: { attempts: 1 },
  });
  Object.assign(jobs, { queue });
  // Keep production admission adapter, but force single attempts for real paid verification.
  const add = queue.add.bind(queue);
  queue.add = (name, data, options) =>
    add(name, data, { ...options, attempts: 1 });
  const events = new QueueEvents(queueName, { connection, prefix });
  const ai = new AiRuntimeService([makeAdapter()], {
    primaryProvider: "amux",
    timeoutMs: 720_000,
    retryBaseMs: 1,
    maxRetries: 0,
  });
  const processor = createGenerationProcessor({
    database: prisma,
    billing,
    ai,
    timeoutMs: 900_000,
    moderator: new AmuxClaudeContentModerationService(
      createAmuxClaudeClientFromEnv(),
    ),
    storage: new S3ThumbnailStorage(),
  });
  let worker:
    | import("../../apps/api/node_modules/bullmq").Worker<GenerationJobData>
    | undefined;
  const service = new GenerationService(
    prisma,
    jobs,
    billing,
    {
      compile: async () => {
        throw new Error("禁止额外提示编译模型调用");
      },
    } as never,
    storage,
    access,
  );
  const wardrobe = new WardrobeService(prisma, access, storage, service);
  async function nativeSideChain(
    startDirectory: string,
    front: {
      id: string;
      assetId: string;
      category: string;
      orientation: string;
    },
    selectedReview?: { file: string; sha256: string },
  ) {
    const frozen = await prisma.wardrobeRevision.findFirst({
      where: {
        id: front.id,
        assetId: front.assetId,
        item: { projectId: run.projectId, archived: false },
      },
    });
    const frozenPayload = frozen?.payload as
      { reviewed?: boolean; category?: string } | undefined;
    if (
      !frozen ||
      frozenPayload?.reviewed !== true ||
      frozenPayload.category !== front.category
    )
      throw new Error("native侧图缺少真实已确认正面修订");
    let folder = startDirectory;
    let boundReview = selectedReview;
    let expectedAssetId: string | undefined;
    const visited = new Set<string>();
    const chain = [];
    const evidenceFolder = (value: string) => {
      const location = relative(baseOut, value);
      if (!location || location.startsWith("..") || isAbsolute(location))
        throw new Error("native侧图证据目录越界");
      return value;
    };
    const readPrivate = async (url: string) => {
      if (!url.startsWith("s3://"))
        throw new Error("native血缘只接受真实私有资产");
      const key = url.slice(5);
      return Buffer.from(
        await storage.readPrefix(key, (await storage.head(key)).contentLength),
      );
    };
    for (;;) {
      evidenceFolder(folder);
      if (visited.size >= 64) throw new Error("native侧图血缘链过长");
      const prepared = readNativeSidePreparation(folder);
      const recorded = readJson(resolve(folder, "side-task-after.json"));
      const derived = readJson(resolve(folder, "material-derived.json"));
      const asset = await prisma.designAsset.findFirst({
        where: {
          id: recorded?.assets?.[0]?.id ?? derived?.asset?.id ?? "",
          projectId: run.projectId,
          archivedAt: null,
        },
        include: { designStep: true },
      });
      if (
        !asset?.parentAssetId ||
        visited.has(asset.id) ||
        (expectedAssetId && asset.id !== expectedAssetId)
      )
        throw new Error("native侧图缺少真实父资产或出现循环");
      visited.add(asset.id);
      const assetBytes = await readPrivate(asset.url);
      const actualHash = sha(assetBytes);
      if (
        boundReview &&
        (dirname(resolve(boundReview.file)) !== resolve(folder) ||
          sha(readFileSync(boundReview.file)) !== boundReview.sha256)
      )
        throw new Error("native父图独立审核文件已改变或越界");
      const reviewFile =
        boundReview?.file ?? resolve(folder, "probe-review.json");
      if (prepared?.mask?.processingProbe || prepared?.processingProbe)
        assertProbeParentReview(readJson(reviewFile), actualHash, true);
      if (!asset.generationTaskId) {
        if (!derived?.input || recorded)
          throw new Error(
            "无生成任务的侧图必须有真实独立派生记录，不能伪造任务",
          );
        assertProbeParentReview(readJson(reviewFile), actualHash, true);
        const sourceFolder = evidenceFolder(
          dirname(prepared?.sourceFile ?? ""),
        );
        const rawFolder = evidenceFolder(
          resolve(derived.sourceAttempt ?? "", basename(folder)),
        );
        const [preparation, sourcePreparation] = await Promise.all([
          prisma.wardrobePreparation.findFirstOrThrow({
            where: { id: prepared.id, projectId: run.projectId },
          }),
          prisma.wardrobePreparation.findFirstOrThrow({
            where: {
              id: derived.input.sidePreparationId,
              projectId: run.projectId,
            },
          }),
        ]);
        const [sourceAsset, rawAsset, maskAsset] = await Promise.all(
          [
            derived.input.sourceAssetId,
            derived.input.rawAssetId,
            derived.input.maskAssetId,
          ].map((id: string) =>
            prisma.designAsset.findFirstOrThrow({
              where: { id, projectId: run.projectId, archivedAt: null },
            }),
          ),
        );
        if (!sourceAsset || !rawAsset?.generationTaskId || !maskAsset)
          throw new Error("派生侧图缺少真实三源或raw任务");
        const task = await prisma.generationTask.findFirstOrThrow({
          where: { id: rawAsset.generationTaskId, projectId: run.projectId },
        });
        const [sourceBytes, rawBytes, maskBytes] = await Promise.all([
          readPrivate(sourceAsset.url),
          readPrivate(rawAsset.url),
          readPrivate(maskAsset.url),
        ]);
        const processing = assertDerivedNativeSideHop({
          asset,
          source: sourceAsset,
          raw: rawAsset,
          mask: maskAsset,
          task,
          preparation,
          sourcePreparation,
          prepared,
          receipt: derived,
          front,
          hashes: {
            sourceSha256: sha(sourceBytes),
            rawSha256: sha(rawBytes),
            maskSha256: sha(maskBytes),
            derivedSha256: actualHash,
          },
          fileHash: sha(readFileSync(resolve(folder, "side.png"))),
          sourceFileHash: sha(readFileSync(resolve(sourceFolder, "side.png"))),
          rawFileHash: sha(readFileSync(resolve(rawFolder, "side.png"))),
          wire: readJson(resolve(rawFolder, "side-call.json"))?.request,
        });
        chain.push({
          assetId: asset.id,
          taskId: null,
          parentAssetId: rawAsset.id,
          sha256: actualHash,
          preparationId: prepared.id,
          native: false,
          algorithmDerived: true,
          processing,
          rawTaskId: task.id,
          sourceAssetId: sourceAsset.id,
          directory: folder,
          reviewFile,
          reviewSha256: sha(readFileSync(reviewFile)),
        });
        expectedAssetId = sourceAsset.id;
        folder = sourceFolder;
        boundReview = undefined;
        continue;
      }
      if (
        recorded?.task?.id !== asset.generationTaskId ||
        recorded.task.status !== "SUCCEEDED" ||
        recorded.assets?.length !== 1
      )
        throw new Error("native真实任务与本地成功回执不一致");
      const [parent, task] = await Promise.all([
        prisma.designAsset.findFirstOrThrow({
          where: {
            id: asset.parentAssetId,
            projectId: run.projectId,
            archivedAt: null,
          },
        }),
        prisma.generationTask.findFirstOrThrow({
          where: { id: asset.generationTaskId, projectId: run.projectId },
        }),
      ]);
      const parentBytes = await readPrivate(parent.url);
      const preparationId = prepared?.externalSideCutout
        ? prepared.cutoutPreparationId
        : prepared?.id;
      const preparation = preparationId
        ? await prisma.wardrobePreparation.findFirst({
            where: { id: preparationId, projectId: run.projectId },
          })
        : null;
      assertNativeSideHop({
        asset,
        parent,
        task,
        prepared,
        front,
        actualHash,
        fileHash: sha(readFileSync(resolve(folder, "side.png"))),
        parentHash: sha(parentBytes),
        wire: readJson(resolve(folder, "side-call.json"))?.request,
        preparation,
      });
      chain.push({
        assetId: asset.id,
        taskId: task.id,
        parentAssetId: parent.id,
        sha256: actualHash,
        parentSha256: sha(parentBytes),
        preparationId: preparation?.id ?? null,
        native: Boolean(prepared.externalInpaint),
        directory: folder,
        ...(boundReview ||
        prepared.mask?.processingProbe ||
        prepared.processingProbe
          ? { reviewFile, reviewSha256: sha(readFileSync(reviewFile)) }
          : {}),
      });
      if (parent.id === front.assetId) break;
      if (!prepared.sourceLineage?.reviewFile)
        throw new Error("native祖先缺少可核对的原始侧图来源目录");
      expectedAssetId = parent.id;
      folder = dirname(prepared.sourceLineage.reviewFile);
      boundReview = prepared.sourceLineage.reviewSha256
        ? {
            file: prepared.sourceLineage.reviewFile,
            sha256: prepared.sourceLineage.reviewSha256,
          }
        : undefined;
    }
    return chain;
  }
  try {
    if (command === "audit-native-source") {
      if (!run.projectId) throw new Error("只读来源核查需要已有隔离项目");
      for (const item of cases) {
        const sourceFolder = resolve(
          requiredEnv("WARDROBE_PROVIDER_SIDE_SOURCE_OUT"),
          item.id,
        );
        const recorded = readJson(
          resolve(sourceFolder, "side-task-after.json"),
        );
        if (
          recorded?.task?.status !== "SUCCEEDED" ||
          recorded.assets?.length !== 1
        )
          throw new Error(
            "只读核查入口必须是真实已成功单张raw任务，不开放直接派生来源",
          );
        const prepared = readNativeSidePreparation(sourceFolder);
        const current = frontReceipt(item)?.item?.currentRevision;
        const front = readJson(resolve(sourceFolder, "side-front-binding.json"))
          ?.item?.currentRevision;
        if (
          !current ||
          !front ||
          current.assetId !== front.assetId ||
          current.category !== front.category
        )
          throw new Error("来源冻结正面与当前已确认素材不符");
        if (!front || !prepared?.presentation)
          throw new Error("缺少当前正面与来源展示绑定");
        const reviewFile = resolve(
          sourceFolder,
          nativeSourceReviewName(
            process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true",
            process.env.WARDROBE_PROVIDER_SIDE_REVIEW || "side-review.json",
            process.env.WARDROBE_PROVIDER_SIDE_REVIEW_EXPLICIT === "true",
          ),
        );
        const review = readJson(reviewFile);
        const hash = sha(readFileSync(resolve(sourceFolder, "side.png")));
        if (process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true")
          assertProbeParentReview(review, hash, true);
        else if (
          review?.decision !== "approved" ||
          review.stage !== "side" ||
          review.sha256 !== hash ||
          !review.reviewChecks?.length
        )
          throw new Error("已确认来源只读核查需要精确SHA正式side审核");
        const chain = await nativeSideChain(
          sourceFolder,
          { ...front, orientation: prepared.presentation.orientation },
          { file: reviewFile, sha256: sha(readFileSync(reviewFile)) },
        );
        console.log(
          JSON.stringify(
            {
              command,
              id: item.id,
              providerRequests: 0,
              databaseWrites: 0,
              storageWrites: 0,
              chain,
            },
            null,
            2,
          ),
        );
      }
      return;
    }
    if (!run.projectId) {
      if (["confirm", "confirm-side", "calibrate-front"].includes(command))
        throw new Error("没有已准备的隔离项目");
      const user = await prisma.user.create({
        data: {
          email: `wardrobe-provider-${run.runId}@example.com`,
          generationLimit: 100,
        },
      });
      const workspace = await prisma.workspace.create({
        data: { name: "真实服装验证（隔离）", ownerId: user.id },
      });
      const project = await prisma.project.create({
        data: { name: "真实供应商材质转换", wsId: workspace.id },
      });
      Object.assign(run, {
        userId: user.id,
        workspaceId: workspace.id,
        projectId: project.id,
        queueName,
        prefix,
      });
      writeJson(resolve(baseOut, "run.json"), run);
    }
    if (command === "register-side") {
      if (out === baseOut) throw new Error("侧图候选登记需要明确独立attempt");
      for (const item of cases) {
        freezeCase(item);
        const original = readNativeSidePreparation(directory(item));
        const frozen = readJson(
          resolve(directory(item), "side-front-binding.json"),
        );
        const recorded = readJson(
          resolve(directory(item), "side-task-after.json"),
        );
        if (
          !frozen?.item ||
          !recorded?.assets?.[0] ||
          recorded.task?.status !== "SUCCEEDED"
        )
          throw new Error("侧图登记需要真实完成输出及冻结正面记录");
        const receiptFile = resolve(
          directory(item),
          "registered-side-preparation.json",
        );
        const prior = readJson(receiptFile);
        const originalPreparation = original.id
          ? await prisma.wardrobePreparation.findFirst({
              where: { id: original.id, projectId: run.projectId },
            })
          : undefined;
        const input = sideInpaintRegistration(
          original,
          frozen.item.currentRevision,
          recorded.assets[0].id,
          prior?.requestKey ?? randomUUID(),
          originalPreparation
            ? {
                ...originalPreparation,
                task: await prisma.generationTask.findFirst({
                  where: {
                    id: originalPreparation.taskId ?? "",
                    projectId: run.projectId,
                  },
                }),
              }
            : undefined,
        );
        const asset = await prisma.designAsset.findFirst({
          where: {
            id: input.sourceAssetId,
            projectId: run.projectId,
            archivedAt: null,
          },
        });
        if (
          !asset?.url.startsWith("s3://") ||
          asset.generationTaskId !== recorded.task.id
        )
          throw new Error("侧图登记输出与真实私有任务不匹配");
        const key = asset.url.slice(5);
        const bytes = Buffer.from(
          await storage.readPrefix(
            key,
            (await storage.head(key)).contentLength,
          ),
        );
        if (
          sha(bytes) !== sha(readFileSync(resolve(directory(item), "side.png")))
        )
          throw new Error("侧图登记不能采用与真实私有资产不同的本地图片");
        await assertTransparentGarment(bytes);
        const chain = await nativeSideChain(directory(item), {
          ...frozen.item.currentRevision,
          orientation: input.presentation.orientation,
        });
        preserveNativeInputPreparation(directory(item), original);
        if (prior?.input && fingerprint(prior.input) !== fingerprint(input))
          throw new Error("侧图登记输入已冻结");
        writeJson(receiptFile, {
          ...prior,
          requestKey: input.requestKey,
          input,
          supplierRequests: 0,
        });
        const prepared = await wardrobe.prepare(
          run.userId,
          run.projectId,
          input,
        );
        if (
          prepared.status !== "ready" ||
          !prepared.candidates.some(
            (candidate) => candidate.assetId === asset.id,
          )
        )
          throw new Error(`侧图准备登记失败：${prepared.error}`);
        writeJson(receiptFile, {
          ...prepared,
          requestKey: input.requestKey,
          input,
          frontAssetId: frozen.item.currentRevision.assetId,
          sourceFile: resolve(directory(item), "side.png"),
          originalPreparationFile: resolve(
            directory(item),
            "side-preparation.json",
          ),
          sha256: sha(bytes),
          chain,
          supplierRequests: 0,
          confirmed: false,
        });
        console.log(
          `${item.id}: 真实侧图已登记为未确认existing候选，原任务记录不变，供应商调用0`,
        );
      }
      return;
    }
    if (command === "material-derive") {
      const rawOut = requiredEnv("WARDROBE_PROVIDER_MATERIAL_RAW_OUT");
      const materialSideOut = process.env.WARDROBE_PROVIDER_MATERIAL_SIDE_OUT;
      for (const item of cases) {
        freezeCase(item);
        const operation = materialOperation(item);
        const origin = resolve(rawOut, item.id);
        const binding = readJson(resolve(origin, "inpaint-binding.json"));
        const completed = readJson(
          resolve(
            origin,
            materialSideOut
              ? "side-task-after.json"
              : "candidate-task-after.json",
          ),
        );
        const rawAsset = completed?.assets?.[0];
        if (
          completed?.task?.status !== "SUCCEEDED" ||
          !rawAsset ||
          !binding?.maskAssetId
        )
          throw new Error("透明派生需要已完成的真实INPAINT与已登记原图和蒙版");
        const realTask = await prisma.generationTask.findFirst({
          where: { id: rawAsset.generationTaskId, projectId: run.projectId },
        });
        assertMaterialDeriveOperation({
          operation,
          binding,
          task: realTask,
          admission: readJson(resolve(origin, "material-probe-admission.json")),
        });
        if (item.correctionGuide) {
          const request = (
            realTask?.compiledPrompt as {
              request?: { referenceImageUrls?: string[] };
            } | null
          )?.request;
          const guideUrl = request?.referenceImageUrls?.[1];
          if (!guideUrl) throw new Error("真实任务缺少图2位置guide来源");
          const guide = await prisma.designAsset.findFirstOrThrow({
            where: {
              projectId: run.projectId,
              url: guideUrl,
              archivedAt: null,
            },
            include: { designStep: true },
          });
          if (
            !guide.url.startsWith("s3://") ||
            guide.designStep?.tool !== "wardrobe-correction-guide"
          )
            throw new Error("图2不是生产私有派生位置guide");
          const key = guide.url.slice(5);
          const guideBytes = Buffer.from(
            await storage.readPrefix(
              key,
              (await storage.head(key)).contentLength,
            ),
          );
          if (
            sha(guideBytes) !== item.correctionGuide.guideSha256 ||
            guide.parentAssetId !== binding.sourceAssetId
          )
            throw new Error("真实guide来源或预览SHA不一致");
          writeJson(resolve(directory(item), "correction-guide-lineage.json"), {
            taskId: realTask?.id,
            sourceAssetId: binding.sourceAssetId,
            maskAssetId: binding.maskAssetId,
            guideAsset: guide,
            guideSha256: sha(guideBytes),
            preflight: item.correctionGuide,
            providerRequests: 0,
          });
        }
        const originalSide = materialSideOut
          ? (readJson(
              resolve(
                materialSideOut,
                item.id,
                "registered-side-preparation.json",
              ),
            ) ??
            readJson(
              resolve(materialSideOut, item.id, "side-preparation.json"),
            ))
          : null;
        const frozenFront = materialSideOut
          ? readJson(
              resolve(materialSideOut, item.id, "side-front-binding.json"),
            )
          : null;
        if (materialSideOut) {
          const sideRow = originalSide?.id
            ? await prisma.wardrobePreparation.findFirst({
                where: { id: originalSide.id, projectId: run.projectId },
              })
            : null;
          const storedInput = sideRow?.input as
            | {
                category?: string;
                presentation?: { revisionId?: string; orientation?: string };
              }
            | undefined;
          if (
            !sideRow ||
            !frozenFront?.item ||
            storedInput?.category !== item.category ||
            storedInput.presentation?.revisionId !==
              frozenFront.item.currentRevision.id ||
            storedInput.presentation?.orientation !==
              originalSide.presentation?.orientation
          )
            throw new Error(
              "侧图透明派生需要真实准备ID及原冻结正面绑定，不能伪造native准备",
            );
        }
        const receiptFile = resolve(directory(item), "material-derived.json");
        const prior = readJson(receiptFile);
        const input = {
          requestKey: prior?.input?.requestKey ?? randomUUID(),
          sourceAssetId: binding.sourceAssetId,
          rawAssetId: rawAsset.id,
          maskAssetId: binding.maskAssetId,
          name: item.name,
          category: item.category,
          ...(item.operation ? { operation } : {}),
          ...(materialSideOut ? { sidePreparationId: originalSide.id } : {}),
        };
        if (prior && fingerprint(prior.input) !== fingerprint(input))
          throw new Error("透明派生来源已冻结，不得替换");
        writeJson(receiptFile, {
          ...prior,
          input,
          sourceAttempt: rawOut,
          providerRequests: 0,
          processingIntermediate: item.derivedProcessingIntermediate === true,
        });
        const prepared = await wardrobe.deriveMaterialCandidate(
          run.userId,
          run.projectId,
          input,
        );
        const candidate = prepared.candidates[0];
        if (
          prepared.status !== "ready" ||
          !candidate ||
          !prepared.materialProcessing
        )
          throw new Error(`透明派生未形成真实可复核候选：${prepared.error}`);
        if (
          prepared.materialProcessing.kind !==
            (operation === "correction" ? "masked-edit" : "material-alpha") ||
          prepared.materialProcessing.algorithm !==
            (operation === "correction"
              ? (prior?.preparation?.materialProcessing?.algorithm ??
                "masked-provider-rgb-interior-v2")
              : "green-dominance-original-rgb-v1")
        )
          throw new Error("派生候选算法与显式operation不符");
        const asset = await prisma.designAsset.findUniqueOrThrow({
          where: { id: candidate.assetId },
          include: { designStep: true },
        });
        const key = asset.url.slice(5);
        const bytes = Buffer.from(
          await storage.readPrefix(
            key,
            (await storage.head(key)).contentLength,
          ),
        );
        const file = resolve(
          directory(item),
          materialSideOut ? "side.png" : "candidate.png",
        );
        writeFileSync(file, bytes);
        const diagnosticFile = resolve(
          origin,
          "matte-diagnostic/original-rgb-derived-alpha.png",
        );
        let diagnosticMatches: boolean | null = null;
        if (operation === "correction") {
          const inputBuffers = await Promise.all(
            [input.sourceAssetId, input.maskAssetId].map(async (id) => {
              const original = await prisma.designAsset.findFirstOrThrow({
                where: { id, projectId: run.projectId },
              });
              const key = original.url.slice(5);
              return Buffer.from(
                await storage.readPrefix(
                  key,
                  (await storage.head(key)).contentLength,
                ),
              );
            }),
          );
          const [source, mask, derived] = await Promise.all(
            [...inputBuffers, bytes].map((png) =>
              sharp(png).ensureAlpha().raw().toBuffer(),
            ),
          );
          if (
            !source ||
            !mask ||
            !derived ||
            source.length !== derived.length ||
            mask.length !== source.length
          )
            throw new Error("局部修正像素尺寸不一致");
          const sourceMeta = await sharp(inputBuffers[0]).metadata();
          if (!sourceMeta.width || !sourceMeta.height)
            throw new Error("原图尺寸缺失");
          const interior = inspectMaskedRgbInterior({
            source: {
              width: sourceMeta.width,
              height: sourceMeta.height,
              data: source,
            },
            mask: {
              width: sourceMeta.width,
              height: sourceMeta.height,
              data: mask,
            },
          });
          const interiorV2 =
            prepared.materialProcessing.algorithm ===
            "masked-provider-rgb-interior-v2";
          let changedRgb = 0;
          for (let i = 0; i < source.length; i += 4) {
            if (derived[i + 3] !== source[i + 3])
              throw new Error("局部修正改变了原alpha");
            for (let c = 0; c < 3; c++) {
              if (derived[i + c] !== source[i + c]) {
                if (mask[i + 3] === 255 || source[i + 3] === 0)
                  throw new Error("局部修正改变了保护区RGB");
                if (interiorV2 && !interior.eligible[i / 4])
                  throw new Error("局部修正改变了半透明边缘或2px轮廓带RGB");
                changedRgb++;
              }
            }
          }
          if (!changedRgb) throw new Error("局部修正未改变任何可见RGB");
          writeJson(resolve(directory(item), "production-pixel-audit.json"), {
            operation,
            alphaChanged: 0,
            protectedRgbaChanged: 0,
            invisibleRgbChanged: 0,
            ...(interiorV2
              ? { edgeRgbChanged: 0, interiorEligibility: interior.stats }
              : {}),
            changedRgbChannels: changedRgb,
            sourceSha256: prepared.materialProcessing.sourceSha256,
            derivedSha256: sha(bytes),
            providerRequests: 0,
          });
        } else if (existsSync(diagnosticFile)) {
          const [actual, expected] = await Promise.all(
            [bytes, readFileSync(diagnosticFile)].map((png) =>
              sharp(png).ensureAlpha().raw().toBuffer(),
            ),
          );
          if (!actual || !expected || !actual.equals(expected))
            throw new Error("真实派生资产与已审核gain0诊断RGBA不一致");
          diagnosticMatches = true;
        } else if (
          !materialSideOut ||
          process.env.WARDROBE_PROVIDER_WITHOUT_DIAGNOSTIC !== "true"
        ) {
          throw new Error("缺少本次明确审核的gain0诊断对照");
        }
        if (materialSideOut) {
          if (
            prepared.presentation?.revisionId !==
              frozenFront.item.currentRevision.id ||
            prepared.presentation?.orientation !==
              originalSide.presentation.orientation
          )
            throw new Error("派生侧候选未保持冻结展示绑定");
          writeJson(resolve(directory(item), "side-preparation.json"), {
            ...prepared,
            processingProbe: item.derivedProcessingIntermediate === true,
            sourceAssetId: candidate.assetId,
            frontAssetId: frozenFront.item.currentRevision.assetId,
            name: item.name,
            category: item.category,
            sourceFile: resolve(materialSideOut, item.id, "side.png"),
            materialSourcePreparationId: originalSide.id,
          });
          writeJson(
            resolve(directory(item), "side-front-binding.json"),
            frozenFront,
          );
        } else
          writeJson(resolve(directory(item), "preparation.json"), prepared);
        writeJson(receiptFile, {
          input,
          sourceAttempt: rawOut,
          preparation: prepared,
          asset,
          providerRequests: 0,
          processingIntermediate: item.derivedProcessingIntermediate === true,
          allRgbaMatchesAuditedDiagnostic: diagnosticMatches,
          diagnosticFile: diagnosticMatches ? diagnosticFile : null,
          diagnosticComparison: diagnosticMatches
            ? "matched"
            : "pending-independent-review",
        });
        const canonical = readJson(resolve(baseOut, "manifest.json"));
        const manifestFile = resolve(out, "manifest.json");
        const manifest = readJson(manifestFile) ?? canonical;
        const previousEntry = manifest.items.find(
          (value: { id: string }) => value.id === item.id,
        );
        const previousCandidate = materialSideOut
          ? previousEntry?.sideDisplay
          : previousEntry;
        if (
          previousCandidate?.sha256 === sha(bytes) &&
          previousCandidate.provenance?.assetId === asset.id
        ) {
          console.log(
            `${item.id}: 复用同一真实素材处理候选，保留既有审核状态，供应商调用0`,
          );
          continue;
        }
        const entry = unreviewedCandidate({
          id: item.id,
          name: item.name,
          category: item.category,
          display: item.display,
          file,
          sourceFile: readJson(
            resolve(
              origin,
              materialSideOut ? "side-preparation.json" : "preparation.json",
            ),
          )?.sourceFile,
          ...(materialSideOut
            ? { orientation: originalSide.presentation.orientation }
            : {}),
          notes: item.derivedProcessingIntermediate
            ? "仅处理中间素材；派生保留原alpha及保护区，禁止确认入架，须先通过独立中间态审核再进入明确下一次编辑。"
            : operation === "correction"
              ? "局部细节修正候选；算法派生，原alpha和蒙版外RGBA保留，原图/供应商中间图/蒙版永久保留，尚未确认。"
              : "透明材质处理候选；算法派生，原图/供应商中间图/蒙版永久保留，尚未确认。",
          anchor: { x: 0.5, y: 0.08 },
          imageBounds:
            candidate.imageBounds ?? (await assertTransparentGarment(bytes)),
          materialProcessing: prepared.materialProcessing,
          provenance: {
            provider: "algorithm-derived",
            modelId: prepared.materialProcessing.algorithm,
            assetId: asset.id,
            sourceAssetId: input.sourceAssetId,
            rawAssetId: input.rawAssetId,
            maskAssetId: input.maskAssetId,
            preparationId: prepared.id,
          },
          sha256: sha(bytes),
          processingProbe: item.derivedProcessingIntermediate === true,
          evidenceKind: "algorithm-derived-from-provider-probe",
          checks: {
            alpha: "passed",
            designFidelity: "pending-human-review",
            allRgbaMatchesAuditedDiagnostic: diagnosticMatches,
            diagnosticComparison: diagnosticMatches
              ? "matched"
              : "pending-independent-review",
            providerRequests: 0,
          },
        });
        if (materialSideOut) {
          const frontEntry = ensureSideFront(
            manifest,
            canonical,
            item.id,
            frozenFront.item.currentRevision.assetId,
          );
          frontEntry.sideDisplay = entry;
        } else
          manifest.items = [
            ...manifest.items.filter(
              (value: { id: string }) => value.id !== item.id,
            ),
            entry,
          ];
        writeJson(manifestFile, manifest);
        console.log(
          `${item.id}: 已登记真实${operation === "correction" ? "局部细节修正" : "透明材质处理"}候选，${diagnosticMatches ? "RGBA与诊断逐字节一致" : "独立三底及像素审核待完成"}，尚未confirm，供应商调用0`,
        );
      }
      return;
    }
    if (command === "calibrate-front") {
      if (out === baseOut) throw new Error("挂点校准必须保存到独立attempt");
      for (const item of cases) {
        const manifestFile = resolve(baseOut, "manifest.json");
        const manifest = readJson(manifestFile);
        const entry = manifest?.items?.find(
          (value: { id: string }) => value.id === item.id,
        );
        const front = frontReceipt(item);
        const review = readJson(resolve(directory(item), "anchor-review.json"));
        if (
          !entry?.reviewedForDisplay ||
          !front?.item ||
          entry.provenance.assetId !== front.item.currentRevision.assetId ||
          review?.decision !== "approved" ||
          review.sha256 !== sha(readFileSync(entry.file)) ||
          !review.anchor ||
          !review.reviewedBy ||
          !review.reviewedAt ||
          !review.reviewChecks?.length
        )
          throw new Error("挂点校准缺少与当前正面原图一致的明确审核");
        const receiptFile = resolve(directory(item), "anchor-confirmed.json");
        const prior = readJson(receiptFile);
        if (prior?.item) {
          console.log(`${item.id}: 已完成无生成挂点校准`);
          continue;
        }
        const receipt = prior ?? { requestKey: randomUUID(), front, review };
        if (fingerprint(receipt.review) !== fingerprint(review))
          throw new Error("同一次挂点校准的审核与参数已冻结");
        writeJson(receiptFile, receipt);
        const confirmed = await wardrobe.updatePresentation(
          run.userId,
          run.projectId,
          receipt.front.item.id,
          {
            requestKey: receipt.requestKey,
            expectedVersion: receipt.front.item.version,
            revisionId: receipt.front.item.currentRevision.id,
            frontAnchor: review.anchor,
            ...(review.supportWidthRatio !== undefined
              ? { supportWidthRatio: review.supportWidthRatio }
              : {}),
            ...(review.shelfDepthRatio !== undefined
              ? { shelfDepthRatio: review.shelfDepthRatio }
              : {}),
          },
        );
        if (confirmed.currentRevision.assetId !== entry.provenance.assetId)
          throw new Error("挂点校准不应改变正面资产");
        const result = {
          ...receipt,
          item: confirmed,
          evidenceDirectory: directory(item),
        };
        writeJson(
          resolve(baseDirectory(item), "current-confirmed.json"),
          result,
        );
        entry.anchor = review.anchor;
        entry.anchorCalibrationReview = review;
        entry.provenance.revisionId = confirmed.currentRevision.id;
        if (review.supportWidthRatio !== undefined)
          entry.supportWidthRatio = review.supportWidthRatio;
        if (review.shelfDepthRatio !== undefined)
          entry.shelfDepthRatio = review.shelfDepthRatio;
        writeJson(manifestFile, manifest);
        writeJson(receiptFile, result);
        console.log(`${item.id}: 已保存实际挂点修订，未发起任何生成`);
      }
      return;
    }
    if (command === "confirm" || command === "confirm-side") {
      for (const item of cases) {
        const confirmingSide = command === "confirm-side";
        const review = readJson(
          resolve(
            directory(item),
            confirmingSide ? "side-review.json" : "review.json",
          ),
        );
        const bytes = readFileSync(
          resolve(
            directory(item),
            confirmingSide ? "side.png" : "candidate.png",
          ),
        );
        if (
          review?.decision !== "approved" ||
          review.sha256 !== sha(bytes) ||
          !review.reviewedBy ||
          !review.reviewedAt ||
          !review.reviewChecks?.length ||
          !review.anchor
        )
          throw new Error(`${item.id}:缺少与原图hash一致的显式人工审核记录`);
        const receiptFile = resolve(
          directory(item),
          confirmingSide ? "side-confirmed.json" : "confirmed.json",
        );
        const existing = readJson(receiptFile);
        if (existing?.item) {
          console.log(`${item.id}: 已确认，复用原修订`);
          continue;
        }
        const receipt = existing ?? {
          requestKey: randomUUID(),
          presentationRequestKey: randomUUID(),
        };
        writeJson(receiptFile, receipt);
        const manifestFile = resolve(out, "manifest.json");
        const manifest = readJson(manifestFile);
        let entry = manifest.items.find(
          (value: { id: string }) => value.id === item.id,
        );
        assertDerivedDisplayCandidate(
          item,
          confirmingSide ? entry?.sideDisplay : entry,
          readJson(resolve(directory(item), "material-derived.json")),
          sha(bytes),
        );
        assertDisplayCandidate(entry);
        let confirmed;
        if (confirmingSide) {
          const front =
            readJson(resolve(directory(item), "side-front-binding.json")) ??
            frontReceipt(item);
          let prepared = readNativeSidePreparation(directory(item));
          entry = ensureSideFront(
            manifest,
            readJson(resolve(baseOut, "manifest.json")),
            item.id,
            prepared.frontAssetId ?? prepared.sourceAssetId,
          );
          if (!front?.item || !entry.sideDisplay)
            throw new Error("缺少已确认正面或侧图候选");
          assertDisplayCandidate(entry.sideDisplay);
          if (
            (prepared.externalInpaint || prepared.externalSideCutout) &&
            !prepared.id
          ) {
            preserveNativeInputPreparation(directory(item), prepared);
            const registeredFile = resolve(
              directory(item),
              "registered-side-preparation.json",
            );
            const previousRegistration = readJson(registeredFile);
            receipt.existingRequestKey ??=
              previousRegistration?.requestKey ?? randomUUID();
            writeJson(receiptFile, receipt);
            const registrationInput = sideInpaintRegistration(
              prepared,
              front.item.currentRevision,
              entry.sideDisplay.provenance.assetId,
              receipt.existingRequestKey,
            );
            if (
              previousRegistration?.input &&
              fingerprint(previousRegistration.input) !==
                fingerprint(registrationInput)
            )
              throw new Error("已有native登记与本次确认来源不一致");
            const registered = await wardrobe.prepare(
              run.userId,
              run.projectId,
              registrationInput,
            );
            if (registered.status !== "ready")
              throw new Error(`原生侧图登记失败: ${registered.error}`);
            writeJson(registeredFile, {
              ...previousRegistration,
              ...registered,
              requestKey: receipt.existingRequestKey,
              input: registrationInput,
              supplierRequests: 0,
            });
            prepared = registered;
            entry.sideDisplay.provenance.preparationId = registered.id;
          }
          confirmed = await wardrobe.updatePresentation(
            run.userId,
            run.projectId,
            front.item.id,
            {
              requestKey: receipt.requestKey,
              expectedVersion: front.item.version,
              revisionId: front.item.currentRevision.id,
              supportWidthRatio: review.supportWidthRatio,
              sideDisplay: {
                preparationId: prepared.id,
                assetId: entry.sideDisplay.provenance.assetId,
                anchor: review.anchor,
                reviewed: true,
              },
            },
          );
          Object.assign(entry.sideDisplay, {
            anchor: review.anchor,
            anchorNeedsReview: false,
            reviewedForDisplay: true,
            review,
          });
        } else {
          let prepared = readJson(resolve(directory(item), "preparation.json"));
          if (prepared.externalInpaint && !prepared.id) {
            receipt.existingRequestKey ??= randomUUID();
            writeJson(receiptFile, receipt);
            const existingPrepared = await wardrobe.prepare(
              run.userId,
              run.projectId,
              {
                requestKey: receipt.existingRequestKey,
                sourceAssetId: entry.provenance.assetId,
                name: item.name,
                category: item.category,
                sourceKind: "isolated",
                mode: "existing",
                referenceAssetIds: [],
              },
            );
            prepared = { ...prepared, ...existingPrepared };
            writeJson(resolve(directory(item), "preparation.json"), prepared);
            entry.provenance.preparationId = prepared.id;
          }
          const replacement = out !== baseOut ? frontReceipt(item) : null;
          confirmed = await wardrobe.confirm(run.userId, run.projectId, {
            requestKey: receipt.requestKey,
            preparationId: prepared.id,
            assetId: entry.provenance.assetId,
            name: item.name,
            category: item.category,
            display: item.display,
            anchor: review.anchor,
            reviewed: true,
            ...(replacement?.item
              ? {
                  itemId: replacement.item.id,
                  expectedVersion: replacement.item.version,
                }
              : {}),
          });
          if (review.supportWidthRatio !== undefined)
            confirmed = await wardrobe.updatePresentation(
              run.userId,
              run.projectId,
              confirmed.id,
              {
                requestKey: receipt.presentationRequestKey,
                expectedVersion: confirmed.version,
                revisionId: confirmed.currentRevision.id,
                supportWidthRatio: review.supportWidthRatio,
              },
            );
          Object.assign(entry, {
            anchor: review.anchor,
            anchorNeedsReview: false,
            supportWidthRatio: review.supportWidthRatio,
            reviewedForDisplay: true,
            review,
          });
        }
        writeJson(receiptFile, { ...receipt, item: confirmed, review });
        writeJson(resolve(baseDirectory(item), "current-confirmed.json"), {
          ...receipt,
          item: confirmed,
          review,
          evidenceDirectory: directory(item),
        });
        Object.assign(entry.provenance, {
          itemId: confirmed.id,
          revisionId: confirmed.currentRevision.id,
        });
        writeJson(manifestFile, manifest);
        if (out !== baseOut) {
          const canonical = readJson(resolve(baseOut, "manifest.json"));
          canonical.items = [
            ...canonical.items.filter(
              (value: { id: string }) => value.id !== item.id,
            ),
            entry,
          ];
          writeJson(resolve(baseOut, "manifest.json"), canonical);
        }
        console.log(`${item.id}: ${command} 显式审核已保存到真实修订`);
      }
      return;
    }
    const tasks = new Map<string, Case>();
    if (command === "material-probe") {
      const sourceOut = requiredEnv("WARDROBE_PROVIDER_MATERIAL_SIDE_OUT");
      for (const item of cases) {
        freezeCase(item);
        const operation = materialOperation(item);
        const origin = resolve(sourceOut, item.id);
        const registered =
          readJson(resolve(origin, "registered-side-preparation.json")) ??
          readJson(resolve(origin, "side-preparation.json"));
        const frozen = readJson(resolve(origin, "side-front-binding.json"));
        const source = registered?.sourceAssetId
          ? await prisma.designAsset.findFirst({
              where: {
                id: registered.sourceAssetId,
                projectId: run.projectId,
                archivedAt: null,
              },
            })
          : null;
        if (
          !source?.url.startsWith("s3://") ||
          !frozen?.item ||
          registered.presentation?.revisionId !== frozen.item.currentRevision.id
        )
          throw new Error("生产透明probe没有合法的私有侧图来源和冻结正面");
        const sourceKey = source.url.slice(5);
        const sourceBytes = Buffer.from(
          await storage.readPrefix(
            sourceKey,
            (await storage.head(sourceKey)).contentLength,
          ),
        );
        if (sha(sourceBytes) !== sha(readFileSync(resolve(origin, "side.png"))))
          throw new Error("probe母图真实私有字节与本地证据不同");
        const sourceRow = await prisma.wardrobePreparation.findFirst({
          where: { id: registered.id, projectId: run.projectId },
        });
        const sourceInput = sourceRow?.input as
          | {
              mode?: string;
              sourceAssetId?: string;
              presentation?: { revisionId?: string; orientation?: string };
            }
          | undefined;
        if (
          !sourceRow ||
          !sourceRow.ready ||
          sourceRow.error ||
          sourceInput?.mode !== "existing" ||
          sourceInput?.sourceAssetId !== source.id ||
          sourceInput.presentation?.revisionId !==
            registered.presentation.revisionId ||
          sourceInput.presentation?.orientation !==
            registered.presentation.orientation
        )
          throw new Error("probe来源需真实existing侧图准备，不能只使用本地ID");
        const maskFile = requiredEnv("WARDROBE_PROVIDER_MASK");
        const maskBytes = readFileSync(maskFile);
        const sourceReview = readJson(
          resolve(
            origin,
            registered.processingProbe
              ? "probe-review.json"
              : "side-review.json",
          ),
        );
        const maskReview = readJson(
          resolve(dirname(maskFile), "mask-review.json"),
        );
        assertMaterialProbeEvidence({
          item,
          registered,
          sourceId: source.id,
          sourceHash: sha(sourceBytes),
          maskHash: sha(maskBytes),
          sourceReview,
          maskReview,
          allowProbeParent:
            process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true",
        });
        let nextStageScope;
        if (item.nextStageScope) {
          const scopeFile = resolve(root, item.nextStageScope.file);
          if (sha(readFileSync(scopeFile)) !== item.nextStageScope.sha256)
            throw new Error("下一阶段范围说明hash与冻结案例不一致");
          const scope = readJson(scopeFile);
          assertNextStageScope(scope, {
            sourceSha256: sha(sourceBytes),
            maskSha256: sha(maskBytes),
            targetAttemptId: relative(resolve(baseOut, "attempts"), out),
            operation,
          });
          nextStageScope = { ...item.nextStageScope, scope };
        }
        let detailRegion;
        if (item.materialReference) {
          const reference = item.materialReference;
          const meta = await sharp(sourceBytes).metadata();
          if (
            !meta.width ||
            !meta.height ||
            reference.sourceSha256 !== sha(sourceBytes)
          )
            throw new Error("probe细节必须来自同一完整母图");
          const roi = readFileSync(resolve(root, reference.roiFile));
          const expected = await sharp(sourceBytes)
            .extract({
              left: reference.roiPixels.x,
              top: reference.roiPixels.y,
              width: reference.roiPixels.width,
              height: reference.roiPixels.height,
            })
            .ensureAlpha()
            .raw()
            .toBuffer();
          if (
            sha(roi) !== reference.roiSha256 ||
            !expected.equals(await sharp(roi).ensureAlpha().raw().toBuffer())
          )
            throw new Error("probe细节不是已审核的原像素ROI");
          detailRegion = {
            x: reference.roiPixels.x / meta.width,
            y: reference.roiPixels.y / meta.height,
            width: reference.roiPixels.width / meta.width,
            height: reference.roiPixels.height / meta.height,
          };
        }
        const receiptFile = resolve(
          directory(item),
          "material-probe-admission.json",
        );
        const prior = readJson(receiptFile);
        const maskId = prior?.maskId ?? randomUUID();
        const maskRequestKey = prior?.maskRequestKey ?? randomUUID();
        const requestKey = prior?.requestKey ?? randomUUID();
        const frozenInput = {
          sourceAssetId: source.id,
          sourceSha256: sha(sourceBytes),
          sourcePreparationId: registered.id,
          maskSha256: sha(maskBytes),
          detailRegion,
          name: item.name,
          category: item.category,
          notes: item.notes,
          ...(item.operation ? { operation } : {}),
          ...(nextStageScope ? { nextStageScope } : {}),
        };
        if (
          prior?.frozenInput &&
          fingerprint(prior.frozenInput) !== fingerprint(frozenInput)
        )
          throw new Error("生产probe来源已冻结不可改写");
        writeJson(receiptFile, {
          ...prior,
          maskId,
          maskRequestKey,
          requestKey,
          frozenInput,
        });
        if (prior?.taskId) {
          tasks.set(prior.taskId, item);
          continue;
        }
        const temporaryKey = `temporary/masks/${run.userId}/${maskId}.png`;
        await storage.uploadBuffer(
          temporaryKey,
          maskBytes,
          "image/png",
          createHash("sha256").update(maskBytes).digest("base64"),
        );
        const maskAsset = await wardrobe.registerMaterialMask(
          run.userId,
          run.projectId,
          {
            requestKey: maskRequestKey,
            sourceAssetId: source.id,
            maskId,
            sha256: sha(maskBytes),
            ...(item.operation ? { operation } : {}),
          },
        );
        const input = {
          requestKey,
          sourceAssetId: source.id,
          maskAssetId: maskAsset.assetId,
          name: item.name,
          category: item.category,
          notes: item.notes,
          ...(item.operation ? { operation } : {}),
          ...(detailRegion ? { detailRegion } : {}),
        };
        const admitted = await wardrobe.createMaterialProbe(
          run.userId,
          run.projectId,
          input,
        );
        const binding = {
          sourceAssetId: source.id,
          sourceSha256: sha(sourceBytes),
          maskAssetId: maskAsset.assetId,
          maskSha256: sha(maskBytes),
          maskFile,
          processingProbe: true,
          background: "opaque",
          productionEntry: "WardrobeService.createMaterialProbe",
          operation,
          ...(nextStageScope ? { nextStageScope } : {}),
        };
        writeJson(resolve(directory(item), "inpaint-binding.json"), binding);
        writeJson(resolve(directory(item), "side-front-binding.json"), frozen);
        writeJson(resolve(directory(item), "side-preparation.json"), {
          ...admitted,
          sourceAssetId: source.id,
          frontAssetId: frozen.item.currentRevision.assetId,
          presentation: registered.presentation,
          name: item.name,
          category: item.category,
          sourceFile: resolve(origin, "side.png"),
          mode: "inpaint",
          externalInpaint: true,
          processingProbe: true,
          materialSourcePreparationId: registered.id,
          sourceLineage: {
            assetId: source.id,
            parentAssetId: source.parentAssetId,
            rootAssetId: source.rootAssetId,
            generationTaskId: source.generationTaskId,
            sha256: sha(sourceBytes),
            reviewFile: resolve(origin, "side-review.json"),
          },
          mask: binding,
          materialProbeInput: input,
        });
        writeJson(receiptFile, {
          maskId,
          maskRequestKey,
          requestKey,
          frozenInput,
          input,
          ...admitted,
        });
        tasks.set(admitted.taskId, item);
      }
    }
    let poseAssetId: string | undefined;
    const posePath = process.env.WARDROBE_PROVIDER_POSE_REFERENCE;
    if (posePath) {
      if (!side) throw new Error("姿态参考只用于明确side准备");
      const original = readFileSync(posePath);
      const meta = await sharp(original).metadata();
      if (meta.format !== "png" || !meta.width || !meta.height)
        throw new Error("姿态参考必须是PNG图片");
      const poseFile = resolve(out, "pose-reference.json");
      const saved = readJson(poseFile);
      if (saved && saved.originalSha256 !== sha(original))
        throw new Error("本attempt姿态参考已冻结，不能换图后复用请求");
      const scaled =
        meta.width < 256
          ? await sharp(original).resize({ width: 256 }).png().toBuffer()
          : original;
      const key = `wardrobe-provider/${run.runId}/pose-${sha(scaled)}.png`;
      const importedId: string = saved?.assetId ?? randomUUID();
      poseAssetId = importedId;
      mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, "pose-analysis.png"), scaled);
      writeJson(poseFile, {
        assetId: poseAssetId,
        sourceFile: posePath,
        originalSha256: sha(original),
        analysisSha256: sha(scaled),
        originalWidth: meta.width,
        originalHeight: meta.height,
        operation: meta.width < 256 ? "uniform-resize-width-256" : "original",
        role: "pose-only-not-design",
        originalPreserved: true,
      });
      await storage.uploadBuffer(
        key,
        scaled,
        "image/png",
        createHash("sha256").update(scaled).digest("base64"),
      );
      const scaledMeta = await sharp(scaled).metadata();
      await prisma.designAsset.upsert({
        where: { id: importedId },
        create: {
          id: importedId,
          projectId: run.projectId,
          rootAssetId: importedId,
          operation: DesignAssetOperation.IMPORTED,
          url: `s3://${key}`,
          width: scaledMeta.width,
          height: scaledMeta.height,
        },
        update: {},
      });
    }
    for (const item of command === "material-probe" ? [] : cases) {
      freezeCase(item);
      const sideSourceOut = process.env.WARDROBE_PROVIDER_SIDE_SOURCE_OUT;
      const sourceStage = sideSourceOut ? "side" : "candidate";
      const candidateSourceOut =
        sideSourceOut || process.env.WARDROBE_PROVIDER_SOURCE_CANDIDATE_OUT;
      const candidateDirectory = candidateSourceOut
        ? resolve(candidateSourceOut, item.id)
        : null;
      const candidateTask = candidateDirectory
        ? readJson(
            resolve(candidateDirectory, `${sourceStage}-task-after.json`),
          )
        : null;
      const candidateReviewName = sideSourceOut
        ? nativeSourceReviewName(
            process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true",
            process.env.WARDROBE_PROVIDER_SIDE_REVIEW || "side-review.json",
            process.env.WARDROBE_PROVIDER_SIDE_REVIEW_EXPLICIT === "true",
          )
        : "review.json";
      const candidateReview = candidateDirectory
        ? readJson(resolve(candidateDirectory, candidateReviewName))
        : null;
      const candidateFile = candidateDirectory
        ? resolve(candidateDirectory, `${sourceStage}.png`)
        : null;
      const candidateAsset = candidateTask?.assets?.[0];
      if (
        candidateDirectory &&
        ((side && !sideSourceOut) ||
          candidateTask?.task?.status !== "SUCCEEDED" ||
          candidateTask.assets.length !== 1 ||
          (process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT !== "true" &&
            (candidateReview?.decision !== "rejected" ||
              candidateReview.stage !== (sideSourceOut ? "side" : "front"))) ||
          !candidateReview.reviewChecks?.length ||
          !candidateFile ||
          sha(readFileSync(candidateFile)) !== candidateReview.sha256)
      )
        throw new Error("候选修正来源必须为明确记录且hash一致的已拒绝单张候选");
      if (process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true")
        assertProbeParentReview(
          candidateReview,
          candidateFile ? sha(readFileSync(candidateFile)) : "",
          true,
        );
      const explicitSourceOut = process.env.WARDROBE_PROVIDER_SOURCE_OUT;
      const sourceDirectory = explicitSourceOut
        ? resolve(explicitSourceOut, item.id)
        : directory(item);
      const localSource =
        explicitSourceOut || out !== baseOut
          ? readJson(resolve(sourceDirectory, "source-call.json"))
          : null;
      if (explicitSourceOut && !localSource)
        throw new Error("指定source-attempt没有已保存来源，禁止回退到旧源");
      const sourceRecord =
        (candidateAsset
          ? {
              status: "response-received",
              images: [
                {
                  file: candidateFile,
                  sha256: candidateReview.sha256,
                  width: candidateAsset.width,
                  height: candidateAsset.height,
                },
              ],
            }
          : null) ??
        localSource ??
        readJson(resolve(baseDirectory(item), "source-call.json"));
      if (sourceRecord?.status !== "response-received")
        throw new Error(`${item.id} 缺少已完成设计源`);
      const file = resolve(
        directory(item),
        side ? "side-preparation.json" : "preparation.json",
      );
      const prior = readJson(file);
      if (prior?.taskId) {
        tasks.set(prior.taskId, item);
        continue;
      }
      let sourceRegion:
        { x: number; y: number; width: number; height: number } | undefined;
      let sourceReviewFile: string | undefined;
      if (!side && !candidateAsset) {
        sourceReviewFile = resolve(
          localSource ? sourceDirectory : baseDirectory(item),
          process.env.WARDROBE_PROVIDER_SOURCE_REVIEW || "source-review.json",
        );
        const review = readJson(sourceReviewFile);
        if (
          review?.decision !== "approved" ||
          review.stage !== "source" ||
          review.sha256 !== sourceRecord.images?.[0]?.sha256 ||
          !review.reviewChecks?.length
        )
          throw new Error(
            `${item.id}设计源尚未按明确规格独立审核，不发起付费转换`,
          );
        sourceRegion = review.region;
      }
      const front = side ? frontReceipt(item) : null;
      if (side && !front?.item)
        throw new Error(`${item.id}没有已明确确认的正面修订`);
      const originalSidePreparation =
        sideSourceOut && candidateDirectory
          ? readNativeSidePreparation(candidateDirectory)
          : null;
      if (
        sideSourceOut &&
        ((!originalSidePreparation?.id &&
          command !== "side-cutout" &&
          !(
            command === "inpaint" &&
            (originalSidePreparation?.externalInpaint ||
              originalSidePreparation?.externalSideCutout)
          )) ||
          originalSidePreparation.presentation?.revisionId !==
            front.item.currentRevision.id ||
          originalSidePreparation.category !== item.category)
      )
        throw new Error("侧图修正来源没有绑定当前同类别正面修订");
      if (
        command === "inpaint" &&
        originalSidePreparation &&
        candidateDirectory
      ) {
        if (
          originalSidePreparation.mask?.processingProbe &&
          process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT !== "true"
        )
          throw new Error("probe父图需要明确下一阶段允许");
        if (
          process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true" &&
          process.env.WARDROBE_PROVIDER_SIDE_REVIEW_EXPLICIT === "true"
        ) {
          if (!item.nextStageScope)
            throw new Error("独立父图审核须配套本次编辑的明确nextStageScope");
          const scopeBytes = readFileSync(resolve(item.nextStageScope.file));
          if (sha(scopeBytes) !== item.nextStageScope.sha256)
            throw new Error("新意图编辑范围文件已改变");
          assertNativeContinuationScope(
            candidateReview,
            JSON.parse(scopeBytes.toString("utf8")),
            {
              sourceSha256: sourceRecord.images[0].sha256,
              maskSha256: sha(
                readFileSync(requiredEnv("WARDROBE_PROVIDER_MASK")),
              ),
              targetAttemptId: process.env.WARDROBE_PROVIDER_ATTEMPT,
              operation: "correction",
            },
          );
        }
        const chain = await nativeSideChain(
          candidateDirectory,
          {
            ...front.item.currentRevision,
            orientation: originalSidePreparation.presentation.orientation,
          },
          {
            file: resolve(candidateDirectory, candidateReviewName),
            sha256: sha(
              readFileSync(resolve(candidateDirectory, candidateReviewName)),
            ),
          },
        );
        writeJson(resolve(directory(item), "native-side-chain.json"), {
          frontRevisionId: front.item.currentRevision.id,
          chain,
        });
      }
      if (command === "side-cutout") {
        const nativeTask = await prisma.generationTask.findFirst({
          where: { id: candidateTask.task.id, projectId: run.projectId },
        });
        assertNativeSideCutoutSource(
          originalSidePreparation,
          nativeTask,
          candidateReview,
          sourceRecord.images[0].sha256,
          front.item.currentRevision,
        );
      }
      const frontManifest = side
        ? readJson(resolve(baseOut, "manifest.json"))?.items?.find(
            (entry: { id: string; provenance?: { assetId?: string } }) =>
              entry.id === item.id &&
              entry.provenance?.assetId === front.item.currentRevision.assetId,
          )
        : null;
      if (side && !frontManifest?.file)
        throw new Error("侧图的实际正面来源与当前确认manifest不一致");
      const bytes = readFileSync(sourceRecord.images[0].file);
      if (sha(bytes) !== sourceRecord.images[0].sha256)
        throw new Error("source原图hash不一致");
      if (side)
        writeJson(resolve(directory(item), "side-front-binding.json"), front);
      const originalPreparation = readJson(
        resolve(
          localSource ? sourceDirectory : baseDirectory(item),
          "preparation.json",
        ),
      );
      const assetId =
        candidateAsset?.id ??
        (side
          ? front.item.currentRevision.assetId
          : (prior?.sourceAssetId ??
            originalPreparation?.sourceAssetId ??
            randomUUID()));
      const attemptPrefix = process.env.WARDROBE_PROVIDER_ATTEMPT
        ? `attempts/${process.env.WARDROBE_PROVIDER_ATTEMPT}/`
        : "";
      const key = `wardrobe-provider/${run.runId}/${attemptPrefix}${item.id}/source.png`;
      let sourceLineage;
      if (candidateAsset && candidateDirectory) {
        const stored = await prisma.designAsset.findUniqueOrThrow({
          where: { id: candidateAsset.id },
        });
        if (
          stored.projectId !== run.projectId ||
          stored.archivedAt ||
          stored.generationTaskId !== candidateTask.task.id ||
          !stored.rootAssetId ||
          !stored.url.startsWith("s3://")
        )
          throw new Error("候选来源资产不属于本次隔离项目或来源链不一致");
        const key = stored.url.slice(5);
        const storedBytes = Buffer.from(
          await storage.readPrefix(
            key,
            (await storage.head(key)).contentLength,
          ),
        );
        if (sha(storedBytes) !== candidateReview.sha256)
          throw new Error("私有存储候选与已审核来源hash不同，禁止付费修正");
        sourceLineage = {
          assetId: stored.id,
          parentAssetId: stored.parentAssetId,
          rootAssetId: stored.rootAssetId,
          generationTaskId: stored.generationTaskId,
          sha256: candidateReview.sha256,
          reviewFile: resolve(candidateDirectory, candidateReviewName),
          ...(process.env.WARDROBE_PROVIDER_SIDE_REVIEW_EXPLICIT === "true" &&
          process.env.WARDROBE_PROVIDER_ALLOW_PROBE_PARENT === "true"
            ? {
                reviewSha256: sha(
                  readFileSync(
                    resolve(candidateDirectory, candidateReviewName),
                  ),
                ),
                continuationScope: item.nextStageScope,
              }
            : {}),
        };
        const bindingFile = resolve(
          directory(item),
          sideSourceOut
            ? "source-side-binding.json"
            : "source-candidate-binding.json",
        );
        const previousBinding = readJson(bindingFile);
        if (
          previousBinding &&
          fingerprint(previousBinding) !== fingerprint(sourceLineage)
        )
          throw new Error("同attempt候选来源已冻结，不可改写");
        writeJson(bindingFile, sourceLineage);
      }
      if (!side && !candidateAsset) {
        await storage.uploadBuffer(
          key,
          bytes,
          "image/png",
          createHash("sha256").update(bytes).digest("base64"),
        );
        await prisma.designAsset.upsert({
          where: { id: assetId },
          create: {
            id: assetId,
            projectId: run.projectId,
            rootAssetId: assetId,
            operation: DesignAssetOperation.GENERATED,
            url: `s3://${key}`,
            width: sourceRecord.images[0].width,
            height: sourceRecord.images[0].height,
          },
          update: {},
        });
      }
      const referenceAssetIds = poseAssetId ? [poseAssetId] : [];
      let materialReferenceEvidence;
      if (process.env.WARDROBE_PROVIDER_MATERIAL_REFERENCE === "true") {
        const reference = item.materialReference;
        if (
          (side && command !== "inpaint") ||
          (candidateAsset && command !== "inpaint") ||
          !reference ||
          (!side && reference.sourceSha256 !== sourceRecord.images[0].sha256)
        )
          throw new Error("同源材质参考必须对应当前完整设计源，不可替代源图");
        let materialSourceAssetId = assetId;
        let materialRootAssetId = sourceLineage?.rootAssetId ?? assetId;
        if (side) {
          assertConfirmedFrontReference(
            reference,
            frontManifest,
            front.item.currentRevision,
            readJson(resolve(directory(item), "reference-review.json")),
          );
          const actualFront = await prisma.wardrobeRevision.findFirst({
            where: {
              id: front.item.currentRevision.id,
              assetId: front.item.currentRevision.assetId,
              item: {
                id: front.item.id,
                projectId: run.projectId,
                archived: false,
                version: front.item.version,
              },
              version: front.item.version,
            },
          });
          const payload = actualFront?.payload as
            { reviewed?: boolean; category?: string } | undefined;
          if (
            !actualFront ||
            payload?.reviewed !== true ||
            payload.category !== item.category
          )
            throw new Error("侧图结构参考没有当前项目真实已审核正面修订");
          const storedFront = await prisma.designAsset.findFirst({
            where: {
              id: actualFront.assetId,
              projectId: run.projectId,
              archivedAt: null,
            },
          });
          if (!storedFront?.url.startsWith("s3://"))
            throw new Error("正面结构参考必须来自同项目真实私有资产");
          const frontKey = storedFront.url.slice(5);
          const frontBytes = Buffer.from(
            await storage.readPrefix(
              frontKey,
              (await storage.head(frontKey)).contentLength,
            ),
          );
          if (sha(frontBytes) !== reference.sourceSha256)
            throw new Error("已确认正面私有资产与结构参考完整源hash不一致");
          materialSourceAssetId = storedFront.id;
          materialRootAssetId = storedFront.rootAssetId;
        }
        const sourceBytes = readFileSync(resolve(root, reference.sourceFile));
        const roiBytes = readFileSync(resolve(root, reference.roiFile));
        if (
          sha(sourceBytes) !== reference.sourceSha256 ||
          sha(roiBytes) !== reference.roiSha256
        )
          throw new Error("同源材质原图或ROI的hash不一致");
        const expectedPixels = await sharp(sourceBytes)
          .extract({
            left: reference.roiPixels.x,
            top: reference.roiPixels.y,
            width: reference.roiPixels.width,
            height: reference.roiPixels.height,
          })
          .ensureAlpha()
          .raw()
          .toBuffer();
        const actualPixels = await sharp(roiBytes)
          .ensureAlpha()
          .raw()
          .toBuffer();
        if (!expectedPixels.equals(actualPixels))
          throw new Error("材质ROI不是记录坐标对应的原图像素");
        const metadata = await sharp(roiBytes).metadata();
        if (
          metadata.width !== reference.roiPixels.width ||
          metadata.height !== reference.roiPixels.height
        )
          throw new Error("材质ROI尺寸与记录不一致");
        const bindingFile = resolve(
          directory(item),
          "material-reference-binding.json",
        );
        const previous = readJson(bindingFile);
        const referenceId = previous?.assetId ?? randomUUID();
        const referenceKey = `wardrobe-provider/${run.runId}/${attemptPrefix}${item.id}/material-reference.png`;
        materialReferenceEvidence = {
          ...reference,
          assetId: referenceId,
          sourceAssetId: materialSourceAssetId,
          ...(side ? { sourceRevisionId: front.item.currentRevision.id } : {}),
          role: side
            ? "same-confirmed-front-reference-only-not-side-geometry"
            : candidateAsset
              ? "same-candidate-detail-only-not-external-photo"
              : "same-design-source-microtexture-only-not-external-photo",
          storageKey: referenceKey,
          width: metadata.width,
          height: metadata.height,
          resized: false,
        };
        if (
          previous &&
          fingerprint(previous) !== fingerprint(materialReferenceEvidence)
        )
          throw new Error("同attempt材质参考已冻结，不能改写");
        writeJson(bindingFile, materialReferenceEvidence);
        await storage.uploadBuffer(
          referenceKey,
          roiBytes,
          "image/png",
          createHash("sha256").update(roiBytes).digest("base64"),
        );
        await prisma.designAsset.upsert({
          where: { id: referenceId },
          create: {
            id: referenceId,
            projectId: run.projectId,
            parentAssetId: materialSourceAssetId,
            rootAssetId: materialRootAssetId,
            operation: DesignAssetOperation.IMPORTED,
            url: `s3://${referenceKey}`,
            width: metadata.width,
            height: metadata.height,
          },
          update: {},
        });
        referenceAssetIds.push(referenceId);
      }
      let structureGuideEvidence;
      if (process.env.WARDROBE_PROVIDER_STRUCTURE_GUIDE === "true") {
        const guide = item.structureGuide;
        if (
          !side ||
          command !== "inpaint" ||
          !guide ||
          materialReferenceEvidence ||
          referenceAssetIds.length
        )
          throw new Error("原创结构guide不能冒充照片ROI或混用其他参考");
        const guideBytes = readFileSync(resolve(root, guide.file));
        const metadata = await sharp(guideBytes).metadata();
        const review = readJson(resolve(root, guide.reviewFile));
        assertAuthoredStructureGuide(
          guide,
          frontManifest,
          front.item.currentRevision,
          review,
          {
            sha256: sha(guideBytes),
            width: metadata.width,
            height: metadata.height,
            maskSha256: sha(
              readFileSync(requiredEnv("WARDROBE_PROVIDER_MASK")),
            ),
          },
        );
        if (metadata.format !== "png" || guideBytes.length >= 4 * 1024 * 1024)
          throw new Error("原创结构guide须为小于4MB的已审核PNG");
        const actualFront = await prisma.wardrobeRevision.findFirst({
          where: {
            id: guide.frontRevisionId,
            assetId: guide.frontAssetId,
            version: front.item.version,
            item: {
              id: front.item.id,
              projectId: run.projectId,
              archived: false,
              version: front.item.version,
            },
          },
        });
        const frontPayload = actualFront?.payload as
          { reviewed?: boolean; category?: string } | undefined;
        const storedFront = await prisma.designAsset.findFirst({
          where: {
            id: guide.frontAssetId,
            projectId: run.projectId,
            archivedAt: null,
          },
        });
        if (
          !actualFront ||
          frontPayload?.reviewed !== true ||
          frontPayload.category !== item.category ||
          !storedFront?.url.startsWith("s3://")
        )
          throw new Error("原创guide绑定的正面并非当前项目真实已审核修订");
        const frontKey = storedFront.url.slice(5);
        const frontBytes = Buffer.from(
          await storage.readPrefix(
            frontKey,
            (await storage.head(frontKey)).contentLength,
          ),
        );
        if (sha(frontBytes) !== guide.frontSha256)
          throw new Error("原创guide绑定的实际私有正面hash不一致");
        const bindingFile = resolve(
          directory(item),
          "structure-guide-binding.json",
        );
        const previous = readJson(bindingFile);
        const guideId = previous?.assetId ?? randomUUID();
        const guideKey = `wardrobe-provider/${run.runId}/${attemptPrefix}${item.id}/authored-structure-guide.png`;
        structureGuideEvidence = {
          ...guide,
          assetId: guideId,
          storageKey: guideKey,
          providerGenerated: false,
          resized: false,
        };
        if (
          previous &&
          fingerprint(previous) !== fingerprint(structureGuideEvidence)
        )
          throw new Error("同attempt原创结构guide已冻结，不可改写");
        writeJson(bindingFile, structureGuideEvidence);
        await storage.uploadBuffer(
          guideKey,
          guideBytes,
          "image/png",
          createHash("sha256").update(guideBytes).digest("base64"),
        );
        await prisma.designAsset.upsert({
          where: { id: guideId },
          create: {
            id: guideId,
            projectId: run.projectId,
            rootAssetId: guideId,
            operation: DesignAssetOperation.IMPORTED,
            url: `s3://${guideKey}`,
            width: metadata.width,
            height: metadata.height,
          },
          update: {},
        });
        await prisma.designStep.upsert({
          where: { outputAssetId: guideId },
          create: {
            projectId: run.projectId,
            outputAssetId: guideId,
            tool: "wardrobe-authored-structure-guide",
            actor: "user",
            intent: "人工新绘结构参考，不是供应商成衣输出或原图裁片",
            inputSnapshot: {
              authored: true,
              providerGenerated: false,
              role: guide.role,
              frontAssetId: guide.frontAssetId,
              frontRevisionId: guide.frontRevisionId,
              frontSha256: guide.frontSha256,
              guideSha256: guide.sha256,
              reviewFile: guide.reviewFile,
            },
          },
          update: {},
        });
        referenceAssetIds.push(guideId);
      }
      const inpaintReferenceEvidence =
        materialReferenceEvidence ?? structureGuideEvidence;
      const requestKey = prior?.requestKey ?? randomUUID();
      writeJson(file, {
        sourceAssetId: assetId,
        requestKey,
        name: item.name,
        category: item.category,
        sourceFile:
          side && !sideSourceOut
            ? frontManifest.file
            : sourceRecord.images[0].file,
        ...(side
          ? {
              frontAssetId: front.item.currentRevision.assetId,
              originalFrontFile: frontManifest.file,
              originDesignSourceFile: frontManifest.sourceFile,
              presentation: {
                view: "side",
                revisionId: front.item.currentRevision.id,
                orientation:
                  originalSidePreparation?.presentation?.orientation ?? "left",
              },
              ...(originalSidePreparation
                ? { repairOfPreparationId: originalSidePreparation.id }
                : {}),
            }
          : {}),
        sourceReviewFile,
        sourceKind: side || candidateAsset ? "isolated" : "sketch",
        mode: candidateAsset ? "extract" : "complete",
        ...(sourceLineage ? { sourceLineage } : {}),
        ...(materialReferenceEvidence ? { materialReferenceEvidence } : {}),
        ...(structureGuideEvidence ? { structureGuideEvidence } : {}),
        ...(sourceRegion ? { reviewedRegion: sourceRegion } : {}),
      });
      if (command === "inpaint") {
        if (
          !candidateAsset ||
          !sourceLineage ||
          referenceAssetIds.length !== (inpaintReferenceEvidence ? 1 : 0) ||
          sourceRegion
        )
          throw new Error("蒙版修正必须以明确失败候选为唯一真实来源");
        const maskFile = requiredEnv("WARDROBE_PROVIDER_MASK");
        const maskBytes = readFileSync(maskFile);
        const maskReview = readJson(resolve(dirname(maskFile), "mask.json"));
        const maskMeta = await sharp(maskBytes).metadata();
        if (
          maskBytes.length >= 4 * 1024 * 1024 ||
          maskMeta.format !== "png" ||
          !maskMeta.hasAlpha ||
          maskMeta.width !== sourceRecord.images[0].width ||
          maskMeta.height !== sourceRecord.images[0].height ||
          maskReview?.sourceSha256 !== sourceLineage.sha256 ||
          maskReview.maskSha256 !== sha(maskBytes)
        )
          throw new Error(
            "mask须为对应来源同尺寸且已记录hash的alpha PNG，小于4MB",
          );
        const maskAlpha = await sharp(maskBytes)
          .extractChannel("alpha")
          .raw()
          .toBuffer();
        if (
          !maskAlpha.some((value) => value === 0) ||
          !maskAlpha.some((value) => value === 255)
        )
          throw new Error("mask需要同时包含明确可编辑和受保护区域");
        const maskBindingFile = resolve(
          directory(item),
          "inpaint-binding.json",
        );
        const priorMask = readJson(maskBindingFile);
        const maskAssetId = priorMask?.maskAssetId ?? randomUUID();
        const maskKey = `wardrobe-provider/${run.runId}/${attemptPrefix}${item.id}/mask.png`;
        const maskBinding = {
          sourceAssetId: assetId,
          sourceSha256: sourceLineage.sha256,
          maskAssetId,
          maskFile,
          maskSha256: sha(maskBytes),
          maskKey,
          width: maskMeta.width,
          height: maskMeta.height,
          semantics: "alpha0-edit-alpha255-protect",
          processingProbe: item.processingProbe ?? false,
          background:
            process.env.WARDROBE_PROVIDER_INPAINT_BACKGROUND === "opaque"
              ? "opaque"
              : "transparent",
        };
        if (priorMask && fingerprint(priorMask) !== fingerprint(maskBinding))
          throw new Error("同inpaint来源与蒙版已冻结");
        writeJson(maskBindingFile, maskBinding);
        await storage.uploadBuffer(
          maskKey,
          maskBytes,
          "image/png",
          createHash("sha256").update(maskBytes).digest("base64"),
        );
        await prisma.designAsset.upsert({
          where: { id: maskAssetId },
          create: {
            id: maskAssetId,
            projectId: run.projectId,
            parentAssetId: assetId,
            rootAssetId: sourceLineage.rootAssetId,
            operation: DesignAssetOperation.IMPORTED,
            url: `s3://${maskKey}`,
            width: maskMeta.width,
            height: maskMeta.height,
          },
          update: {},
        });
        // Native multi-reference edits use their explicit image-role instructions;
        // the wardrobe extraction helper correctly assumes one repair source.
        const prompt =
          item.processingProbe ||
          (side &&
            (inpaintReferenceEvidence ||
              originalSidePreparation?.externalInpaint ||
              originalSidePreparation?.externalSideCutout))
            ? item.notes
            : preparationPrompt({
                requestKey,
                sourceAssetId: assetId,
                name: item.name,
                category: item.category as WardrobeCategory,
                sourceKind: "isolated",
                mode: "extract",
                notes: item.notes,
                ...(side
                  ? {
                      presentation: {
                        view: "side" as const,
                        revisionId: front.item.currentRevision.id,
                        orientation:
                          originalSidePreparation.presentation.orientation,
                        repairPreparationId: originalSidePreparation.id,
                      },
                    }
                  : {}),
              });
        const admitted = await service.createFromAgent(
          run.userId,
          {
            projectId: run.projectId,
            parentAssetId: assetId,
            taskType: "inpaint",
            prompt,
            referenceImageUrl: candidateAsset.url,
            ...(inpaintReferenceEvidence
              ? {
                  referenceImageUrls: [
                    candidateAsset.url,
                    `s3://${inpaintReferenceEvidence.storageKey}`,
                  ],
                }
              : {}),
            maskImageUrl: inpaintReferenceEvidence
              ? `s3://${maskKey}`
              : await storage.createDownloadUrl(maskKey, 24 * 60 * 60),
            width: maskMeta.width,
            height: maskMeta.height,
            background: maskBinding.background as "opaque" | "transparent",
            outputFormat: "png",
            quality: config.quality,
          },
          requestKey,
          prompt,
          {
            version: 1,
            mode: "board_guided",
            positivePrompt: prompt,
            negativePrompt: "",
            sources: [
              {
                elementId: assetId,
                assetId,
                role: "edit_source",
                title: "需修正的真实候选",
              },
              {
                elementId: maskAssetId,
                assetId: maskAssetId,
                role: "edit_mask",
                title: "已审核局部编辑蒙版",
              },
              ...(materialReferenceEvidence
                ? [
                    {
                      elementId: materialReferenceEvidence.assetId,
                      assetId: materialReferenceEvidence.assetId,
                      role: "detail_ref",
                      title: "同一母图的原像素局部材质参考",
                    },
                    ...(side
                      ? [
                          {
                            elementId: materialReferenceEvidence.sourceAssetId,
                            assetId: materialReferenceEvidence.sourceAssetId,
                            role: "detail_source",
                            title: "已确认同款正面结构参考原图",
                          },
                        ]
                      : []),
                  ]
                : []),
              ...(structureGuideEvidence
                ? [
                    {
                      elementId: structureGuideEvidence.assetId,
                      assetId: structureGuideEvidence.assetId,
                      role: "structure_guide",
                      title: "人工新绘结构示意，仅作分格指导，非成衣或原图裁片",
                    },
                  ]
                : []),
            ],
            palette: [],
            paletteReferences: [],
            styleReferences: [],
            silhouetteReferences: [],
            fabricReferences: [],
            fabricInputs: [],
            patternReferences: [],
            detailReferences: [],
            avoidLabels: [],
            notes: [
              "真实局部重绘：透明mask区域可修改，实体内衬及蒙版外结构仍须独立复核。",
            ],
            enhancement: "keywords",
          },
        );
        writeJson(file, {
          ...readJson(file),
          ...admitted,
          mode: "inpaint",
          externalInpaint: true,
          mask: maskBinding,
        });
        tasks.set(admitted.taskId, item);
        continue;
      }
      const prepared = await wardrobe.prepare(run.userId, run.projectId, {
        requestKey,
        sourceAssetId: assetId,
        name: item.name,
        category: item.category,
        sourceKind: side || candidateAsset ? "isolated" : "sketch",
        mode: candidateAsset ? "extract" : "complete",
        notes: item.notes,
        referenceAssetIds,
        ...(sourceRegion ? { region: sourceRegion } : {}),
        ...(side && command !== "side-cutout"
          ? {
              presentation: {
                view: "side",
                revisionId: front.item.currentRevision.id,
                orientation:
                  originalSidePreparation?.presentation?.orientation ?? "left",
                ...(sideSourceOut
                  ? { repairPreparationId: originalSidePreparation.id }
                  : {}),
              },
            }
          : {}),
      });
      if (command === "side-cutout") {
        writeJson(
          resolve(directory(item), "cutout-preparation.json"),
          prepared,
        );
        writeJson(file, {
          ...readJson(file),
          externalSideCutout: true,
          cutoutPreparationId: prepared.id,
          taskId: prepared.taskId,
          error: prepared.error,
          nativeInputPreparation: originalSidePreparation,
          mode: "extract",
        });
      } else writeJson(file, { ...readJson(file), ...prepared });
      if (!prepared.taskId)
        throw new Error(`${item.id}准备接纳失败: ${prepared.error}`);
      tasks.set(prepared.taskId, item);
    }
    worker = new Worker<GenerationJobData>(
      queueName,
      async (job) => {
        const item = tasks.get(job.data.taskId);
        if (!item) throw new Error("隔离队列存在非当前选择的任务，拒绝执行");
        const task = await prisma.generationTask.findUniqueOrThrow({
          where: { id: job.data.taskId },
        });
        writeJson(resolve(directory(item), `${stage}-task-before.json`), {
          taskId: task.id,
          status: task.status,
          input: task.input,
          compiledPrompt: task.compiledPrompt,
        });
        return context.run({ item, stage }, () => processor(job));
      },
      {
        connection,
        prefix,
        concurrency: Number(process.env.WARDROBE_PROVIDER_CONCURRENCY),
        maxStalledCount: 0,
      },
    );
    await events.waitUntilReady();
    for (const [taskId, item] of tasks) {
      const current = await prisma.generationTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      if (current.status === "QUEUED" || current.status === "RUNNING") {
        const job = await queue.getJob(taskId);
        if (!job) throw new Error("任务缺少持久队列记录；禁止自动新建收费请求");
        await job.waitUntilFinished(events, 960_000).catch(() => undefined);
      }
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const assets = await prisma.designAsset.findMany({
        where: { generationTaskId: taskId },
      });
      const step = await prisma.designStep.findUnique({
        where: { generationTaskId: taskId },
      });
      writeJson(resolve(directory(item), `${stage}-task-after.json`), {
        task,
        assets,
        designStep: step,
      });
      if (task.status !== "SUCCEEDED") {
        console.log(`${item.id}: ${task.status}，保留全部证据，禁止自动重发`);
        continue;
      }
      for (const asset of assets) {
        const bytes = Buffer.from(
          await storage.readPrefix(
            asset.url.slice(5),
            (await storage.head(asset.url.slice(5))).contentLength,
          ),
        );
        const file = resolve(directory(item), `${stage}.png`);
        writeFileSync(file, bytes);
        let imageBounds;
        let alphaError;
        try {
          imageBounds = await assertTransparentGarment(bytes);
        } catch (error) {
          alphaError =
            error instanceof Error
              ? error.message
              : "无有效透明主体，不能确认入架";
        }
        const manifestFile = resolve(out, "manifest.json");
        const manifest = readJson(manifestFile) ??
          (out !== baseOut
            ? readJson(resolve(baseOut, "manifest.json"))
            : null) ?? {
            schemaVersion: 1,
            evidenceKind: "provider-generated",
            items: [],
          };
        let previous = manifest.items.find(
          (entry: { id: string }) => entry.id === item.id,
        );
        const prepared = readJson(
          resolve(
            directory(item),
            side ? "side-preparation.json" : "preparation.json",
          ),
        );
        if (
          prepared.sourceLineage &&
          (asset.parentAssetId !== prepared.sourceAssetId ||
            asset.rootAssetId !== prepared.sourceLineage.rootAssetId)
        )
          throw new Error(
            "修正结果未保留真实父候选及原设计root，拒绝进入展示manifest",
          );
        if (side) {
          previous = ensureSideFront(
            manifest,
            readJson(resolve(baseOut, "manifest.json")),
            item.id,
            prepared.frontAssetId ?? prepared.sourceAssetId,
          );
          if (previous.sideDisplay?.sha256 === sha(bytes)) {
            previous.sideDisplay.processingProbe = Boolean(
              item.processingProbe || prepared.mask?.processingProbe,
            );
            writeJson(manifestFile, manifest);
            continue;
          }
          previous.sideDisplay = {
            file,
            processingProbe: Boolean(
              item.processingProbe || prepared.mask?.processingProbe,
            ),
            imageBounds,
            anchorNeedsReview: true,
            orientation: "left",
            reviewedForDisplay: false,
            sha256: sha(bytes),
            provenance: {
              provider: "amux",
              modelId: config.imageModel,
              taskId,
              assetId: asset.id,
              sourceAssetId: prepared.sourceAssetId,
              preparationId: prepared.id,
            },
            checks: {
              alpha: imageBounds ? "passed" : "failed",
              alphaError,
              designFidelity: "pending-human-review",
            },
          };
          writeJson(manifestFile, manifest);
          console.log(
            `${item.id}: ${previous.sideDisplay.processingProbe ? "已保存真实处理中间图，不是侧挂成品" : "已保存独立真实侧图，待人工复核"}`,
          );
          continue;
        }
        if (previous?.sha256 === sha(bytes)) {
          writeJson(manifestFile, manifest);
          continue;
        }
        const entry = unreviewedCandidate({
          id: item.id,
          name: item.name,
          category: item.category,
          display: item.display,
          file,
          sourceFile: prepared.sourceFile,
          sourcePrompt: item.sourcePrompt,
          notes: item.notes,
          ...(item.processingProbe ? { processingProbe: true } : {}),
          anchor: item.anchor ?? {
            x: 0.5,
            y: imageBounds ? imageBounds.y / imageBounds.height : 0.08,
          },
          anchorNeedsReview: true,
          imageBounds,
          materialTags: item.materialTags ?? [],
          provenance: {
            provider: "amux",
            modelId: config.imageModel,
            taskId,
            assetId: asset.id,
            sourceAssetId: prepared.sourceAssetId,
            preparationId: prepared.id,
          },
          reviewedForDisplay: false,
          sha256: sha(bytes),
          checks: {
            alpha: imageBounds ? "passed" : "failed",
            alphaError,
            designFidelity: "pending-human-review",
            originalPixelsUnchanged: true,
          },
        });
        manifest.items = [
          ...manifest.items.filter(
            (entry: { id: string }) => entry.id !== item.id,
          ),
          entry,
        ];
        writeJson(manifestFile, manifest);
        console.log(
          `${item.id}: 已保存真实候选，alpha ${entry.checks.alpha}，待人工复核`,
        );
      }
    }
  } finally {
    wardrobe.onModuleDestroy();
    await worker?.close();
    await events.close();
    await jobs.onModuleDestroy();
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.env.WARDROBE_PROVIDER_COMMAND === "source") {
    const pending = [...cases];
    await Promise.all(
      Array.from(
        { length: Number(process.env.WARDROBE_PROVIDER_CONCURRENCY) },
        async () => {
          for (let item = pending.shift(); item; item = pending.shift())
            await source(item);
        },
      ),
    );
  } else await prepareAll();
}
main().catch((error) => {
  console.error(
    "真实验证停止：",
    error instanceof Error ? error.message : "未知错误",
  );
  process.exitCode = 1;
});
