import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// Read-only production data audit. Never starts a worker or calls an AI provider.
const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const base = resolve(root, option("out", "output/wardrobe-provider"));
const reportFile = resolve(
  root,
  option("report", "output/wardrobe-provider/final-state-audit.json"),
);
const reportLocation = relative(resolve(root, "output"), reportFile);
assert(
  reportLocation &&
    !reportLocation.startsWith("..") &&
    !isAbsolute(reportLocation),
  "报告必须位于output内",
);
const read = (file) =>
  JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = read(resolve(base, "run.json"));
const manifestBytes = readFileSync(resolve(base, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert(
  /^wardrobe_provider_[0-9]+$/u.test(run.schema),
  "只接受真实供应商隔离schema",
);
const database = new URL(process.env.DATABASE_URL);
database.searchParams.set("schema", run.schema);
database.searchParams.set("options", `-c search_path=${run.schema}`);
process.env.DATABASE_URL = database.toString();
const require = createRequire(resolve(root, "apps/api/package.json"));
const { prisma } = require("@fashion/db");
const { Queue } = require("bullmq");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "auto",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const redis = new URL(process.env.REDIS_URL);
const queueName = `wardrobe-provider-${run.runId}`;
const queue = new Queue(queueName, {
  prefix: queueName,
  connection: {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    password: redis.password || undefined,
  },
});
const tasks = new Map();
const assets = new Map();
const failures = [];
const items = [];
const permittedPending = new Set(
  option("allow-pending", "").split(",").filter(Boolean),
);

async function privateAsset(id) {
  if (assets.has(id)) return assets.get(id);
  const asset = await prisma.designAsset.findFirstOrThrow({
    where: { id, projectId: run.projectId, archivedAt: null },
    include: { designStep: true },
  });
  assert(asset.url.startsWith("s3://"), "素材必须是私有对象");
  const result = await storage.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: asset.url.slice(5),
    }),
  );
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  const value = { asset, sha256: sha(bytes), byteLength: bytes.length };
  assets.set(id, value);
  return value;
}

async function successfulTask(id) {
  if (tasks.has(id)) return tasks.get(id);
  const task = await prisma.generationTask.findFirstOrThrow({
    where: { id, projectId: run.projectId },
    select: {
      id: true,
      status: true,
      parentAssetId: true,
      completedAt: true,
      moderationStatus: true,
    },
  });
  assert.equal(task.status, "SUCCEEDED", `来源任务${id}必须成功`);
  assert(task.completedAt, "成功任务必须有完成时间");
  tasks.set(id, task);
  return task;
}

async function lineage(id, visiting = new Set()) {
  assert(!visiting.has(id) && visiting.size < 64, "素材血缘循环或超过64层");
  const next = new Set(visiting).add(id);
  const { asset, sha256 } = await privateAsset(id);
  if (asset.generationTaskId) {
    const task = await successfulTask(asset.generationTaskId);
    assert.equal(task.parentAssetId, asset.parentAssetId, "任务父资产须一致");
  } else if (
    ["wardrobe-material-alpha", "wardrobe-masked-edit"].includes(
      asset.designStep?.tool,
    )
  ) {
    const processing = JSON.parse(
      asset.designStep.inputSnapshot.parameters.processing,
    );
    assert.equal(asset.designStep.generationTaskId, null);
    assert.equal(asset.parentAssetId, processing.rawAssetId);
    assert.equal(sha256, processing.derivedSha256);
    const ids = [
      processing.sourceAssetId,
      processing.rawAssetId,
      processing.maskAssetId,
    ];
    assert.deepEqual(
      asset.designStep.inputSnapshot.sources.map((source) => source.assetId),
      ids,
    );
    for (const [inputId, expected] of [
      [processing.sourceAssetId, processing.sourceSha256],
      [processing.rawAssetId, processing.rawSha256],
      [processing.maskAssetId, processing.maskSha256],
    ])
      assert.equal(
        (await privateAsset(inputId)).sha256,
        expected,
        "派生三源真实字节必须一致",
      );
    await lineage(processing.sourceAssetId, next);
  }
  if (asset.parentAssetId) {
    const { asset: parent } = await privateAsset(asset.parentAssetId);
    assert.equal(parent.rootAssetId, asset.rootAssetId, "祖先根资产须保持一致");
    await lineage(parent.id, next);
  } else assert.equal(asset.rootAssetId, asset.id, "无父资产必须是真实原始根");
}

async function view(entry, assetId, label) {
  assert(entry?.reviewedForDisplay, `${label}必须已明确审核保存`);
  assert.equal(
    entry.provenance.assetId,
    assetId,
    `${label}数据库与canonical资产不符`,
  );
  const localSha = sha(readFileSync(entry.file));
  const stored = await privateAsset(assetId);
  assert.equal(localSha, entry.sha256, `${label}本地字节不符`);
  assert.equal(stored.sha256, entry.sha256, `${label}私有字节不符`);
  if (entry.provenance.taskId)
    assert.equal(stored.asset.generationTaskId, entry.provenance.taskId);
  await lineage(assetId);
  return {
    assetId,
    sha256: stored.sha256,
    generationTaskId: stored.asset.generationTaskId,
    byteLength: stored.byteLength,
    privateBytesMatch: true,
    localBytesMatch: true,
  };
}

try {
  const schema = await prisma.$queryRaw`SELECT current_schema()`;
  assert.equal(schema[0].current_schema, run.schema);
  const storedItems = await prisma.wardrobeItem.findMany({
    where: { projectId: run.projectId, archived: false },
    include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
  });
  assert.equal(manifest.items.length, 29, "canonical必须有29件");
  assert.equal(storedItems.length, 29, "数据库必须有29件");
  assert.equal(
    new Set(manifest.items.map((item) => item.provenance.itemId)).size,
    29,
  );
  for (const entry of manifest.items) {
    try {
      const item = storedItems.find(
        (value) => value.id === entry.provenance.itemId,
      );
      assert(item, "canonical单品必须在真实项目中");
      const revision = item.revisions[0];
      const payload = revision.payload;
      assert.equal(
        revision.id,
        entry.provenance.revisionId,
        "必须采用真实最新修订",
      );
      assert.equal(item.version, revision.version);
      assert.equal(payload.reviewed, true);
      assert.equal(payload.category, entry.category);
      assert.equal(payload.display, entry.display);
      assert.deepEqual(payload.anchor, entry.anchor);
      assert.deepEqual(payload.imageBounds, entry.imageBounds);
      assert.equal(
        payload.presentation?.supportWidthRatio,
        entry.supportWidthRatio,
      );
      assert.equal(
        payload.presentation?.shelfDepthRatio,
        entry.shelfDepthRatio,
      );
      const front = await view(entry, revision.assetId, `${entry.id}/front`);
      const side = payload.presentation?.sideDisplay;
      let sideResult = null;
      if (side || entry.sideDisplay) {
        assert(
          side?.reviewed && entry.sideDisplay,
          "数据库和canonical必须同时存在审核侧图",
        );
        assert.deepEqual(side.anchor, entry.sideDisplay.anchor);
        assert.deepEqual(side.imageBounds, entry.sideDisplay.imageBounds);
        assert.equal(side.orientation, entry.sideDisplay.orientation);
        sideResult = await view(
          entry.sideDisplay,
          side.assetId,
          `${entry.id}/side`,
        );
        const preparation = await prisma.wardrobePreparation.findFirstOrThrow({
          where: { id: side.preparationId, projectId: run.projectId },
        });
        assert.equal(preparation.error, null);
        assert.equal(preparation.input.category, entry.category);
        const frozen = await prisma.wardrobeRevision.findFirstOrThrow({
          where: {
            id: preparation.input.presentation.revisionId,
            itemId: item.id,
          },
        });
        assert.equal(
          frozen.assetId,
          revision.assetId,
          "侧图冻结正面应与当前正面素材一致",
        );
        if (preparation.input.mode === "existing") {
          assert.equal(preparation.ready, true);
          assert.equal(preparation.input.sourceAssetId, side.assetId);
          assert.equal(preparation.taskId, null);
        } else
          assert.equal(
            (await privateAsset(side.assetId)).asset.generationTaskId,
            preparation.taskId,
          );
        sideResult.preparationId = preparation.id;
      } else assert(permittedPending.has(entry.id), "侧图尚未保存");
      const currentFile = resolve(base, entry.id, "current-confirmed.json");
      const receipt = read(
        existsSync(currentFile)
          ? currentFile
          : resolve(base, entry.id, "confirmed.json"),
      );
      assert.equal(
        receipt.item.currentRevision.id,
        revision.id,
        "保存回执应对应最新修订",
      );
      assert.equal(receipt.item.version, item.version);
      items.push({
        id: entry.id,
        itemId: item.id,
        revisionId: revision.id,
        version: item.version,
        front,
        side: sideResult,
        canonicalMatches: true,
      });
    } catch (error) {
      failures.push({ id: entry.id, error: error.message });
    }
  }
  const taskStates = await prisma.generationTask.groupBy({
    by: ["status"],
    where: { projectId: run.projectId },
    _count: { _all: true },
  });
  const failedTasks = await prisma.generationTask.findMany({
    where: { projectId: run.projectId, status: "FAILED" },
    select: { id: true, errorCode: true, completedAt: true },
  });
  const pendingTasks = await prisma.generationTask.findMany({
    where: { projectId: run.projectId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, status: true },
  });
  const queueCounts = await queue.getJobCounts(
    "active",
    "waiting",
    "delayed",
    "paused",
    "waiting-children",
  );
  const workerCount = (await queue.getWorkers()).length;
  if (
    pendingTasks.length ||
    workerCount ||
    Object.values(queueCounts).some((count) => count !== 0)
  )
    failures.push({ error: "仍有在途任务或运行worker" });
  const http = [];
  const calls = [];
  const rejectedReviews = [];
  function visit(folder) {
    for (const value of readdirSync(folder, { withFileTypes: true })) {
      const file = resolve(folder, value.name);
      if (value.isDirectory()) visit(file);
      else if (/-http\.json$/u.test(value.name))
        http.push({ file: relative(base, file), ...read(file) });
      else if (/^(source|candidate|side)-call\.json$/u.test(value.name))
        calls.push({ file: relative(base, file), status: read(file).status });
      else if (
        /review[^/]*\.json$/u.test(value.name) &&
        read(file).decision === "rejected"
      )
        rejectedReviews.push(relative(base, file));
    }
  }
  visit(base);
  const report = {
    checkedAt: new Date().toISOString(),
    schema: run.schema,
    projectId: run.projectId,
    manifestSha256: sha(manifestBytes),
    items,
    failures,
    allowedPending: [...permittedPending],
    privateAssetsRead: assets.size,
    successfulAncestorTasksVerified: tasks.size,
    taskStates,
    failedTasks,
    pendingTasks,
    queueCounts,
    workerCount,
    external: {
      imageRequests: http.filter((entry) =>
        entry.file.endsWith("-image-http.json"),
      ).length,
      moderationRequests: http.filter((entry) =>
        entry.file.endsWith("-moderation-http.json"),
      ).length,
      httpFailures: http
        .filter((entry) => entry.status < 200 || entry.status >= 300)
        .map(({ file, status }) => ({ file, status })),
      failedOrUnknownCalls: calls.filter(
        (entry) => entry.status !== "response-received",
      ),
      rejectedReviewRecords: rejectedReviews.length,
      actualCost: "unknown-until-provider-billing",
      configuredZeroIsNotFree: true,
      basis: "retained actual HTTP and call receipts; not provider invoice",
    },
    databaseWrites: 0,
    storageWrites: 0,
    providerRequestsByAudit: 0,
    passed: failures.length === 0 && permittedPending.size === 0,
  };
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        reportFile,
        checkedItems: items.length,
        privateAssetsRead: assets.size,
        successfulAncestorTasksVerified: tasks.size,
        failures,
        external: report.external,
        taskStates,
        pendingTasks,
        queueCounts,
        workerCount,
        passed: report.passed,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await queue.close();
  await prisma.$disconnect();
  storage.destroy();
}
