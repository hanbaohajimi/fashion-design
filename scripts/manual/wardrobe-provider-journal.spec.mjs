import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readJson,
  readNativeSidePreparation,
  preserveNativeInputPreparation,
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
  reserveCall,
  sideInpaintRegistration,
  unreviewedCandidate,
  writeJson,
} from "./wardrobe-provider-journal.mjs";

test("native登记和确认分别保存existing准备，再次血缘读取仍使用原生成输入", () => {
  const dir = mkdtempSync(join(tmpdir(), "wardrobe-native-input-"));
  try {
    const original = {
      externalInpaint: true,
      mode: "inpaint",
      taskId: "real-task",
      sourceAssetId: "real-parent",
      frontAssetId: "front",
      category: "outerwear",
      presentation: {
        view: "side",
        revisionId: "front-v3",
        orientation: "left",
      },
    };
    writeJson(join(dir, "side-preparation.json"), original);
    preserveNativeInputPreparation(dir, original);
    const registered = {
      id: "real-existing-prep",
      taskId: null,
      sourceAssetId: "real-output",
      mode: "existing",
      status: "ready",
    };
    writeJson(join(dir, "registered-side-preparation.json"), registered);
    writeJson(join(dir, "side-confirmed.json"), {
      item: { version: 4 },
      preparationId: registered.id,
    });
    assert.deepEqual(readNativeSidePreparation(dir), original);
    assert.deepEqual(readJson(join(dir, "side-preparation.json")), original);
    // A legacy already-overwritten working record must not hide the independent input.
    writeJson(join(dir, "side-preparation.json"), {
      ...original,
      ...registered,
    });
    assert.deepEqual(readNativeSidePreparation(dir), original);
    assert.doesNotThrow(() =>
      assertNativeSideHop({
        asset: {
          id: "real-output",
          generationTaskId: "real-task",
          parentAssetId: "real-parent",
          projectId: "project",
          rootAssetId: "design-root",
        },
        parent: {
          id: "real-parent",
          projectId: "project",
          rootAssetId: "design-root",
          url: "s3://real-parent.png",
        },
        task: {
          id: "real-task",
          status: "SUCCEEDED",
          taskType: "inpaint",
          parentAssetId: "real-parent",
          projectId: "project",
          compiledPrompt: {
            request: { referenceImageUrl: "s3://real-parent.png" },
          },
        },
        prepared: readNativeSidePreparation(dir),
        front: {
          id: "front-v3",
          assetId: "front",
          category: "outerwear",
          orientation: "left",
        },
        actualHash: "output-sha",
        fileHash: "output-sha",
        parentHash: "parent-sha",
        wire: { referenceImages: [{ sha256: "parent-sha" }] },
      }),
    );
    assert.doesNotThrow(() => preserveNativeInputPreparation(dir, original));
    assert.throws(() =>
      preserveNativeInputPreparation(dir, {
        ...original,
        taskId: "another-task",
      }),
    );
    assert.throws(() =>
      preserveNativeInputPreparation(dir, { ...original, ...registered }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("历史输入重建必须明确标注来源，不能把已有existing准备伪装成原任务", () => {
  const dir = mkdtempSync(join(tmpdir(), "wardrobe-native-reconstructed-"));
  try {
    const preparation = {
      externalInpaint: true,
      taskId: "recorded-real-task",
      sourceAssetId: "recorded-parent",
      mode: "inpaint",
    };
    writeJson(join(dir, "native-input-preparation.json"), {
      evidenceKind: "reconstructed-from-recorded-task-and-binding",
      reconstructedAt: "2026-11-04",
      preparation,
    });
    assert.deepEqual(readNativeSidePreparation(dir), preparation);
    for (const changed of [
      { evidenceKind: "original-captured-on-old-date", preparation },
      {
        evidenceKind: "reconstructed-from-recorded-task-and-binding",
        preparation: { ...preparation, taskId: null },
      },
    ]) {
      writeJson(join(dir, "native-input-preparation.json"), changed);
      assert.throws(() => readNativeSidePreparation(dir));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function derivedNativeHop() {
  const front = {
    id: "front-revision",
    assetId: "confirmed-front",
    category: "outerwear",
    orientation: "left",
  };
  const presentation = {
    view: "side",
    revisionId: front.id,
    orientation: front.orientation,
  };
  const hashes = {
    sourceSha256: "1".repeat(64),
    rawSha256: "2".repeat(64),
    maskSha256: "3".repeat(64),
    derivedSha256: "4".repeat(64),
  };
  const source = {
    id: "source",
    projectId: "project",
    rootAssetId: "original-design",
    generationTaskId: "source-task",
    archivedAt: null,
    url: "s3://private/source.png",
  };
  const raw = {
    ...source,
    id: "raw",
    parentAssetId: source.id,
    generationTaskId: "raw-task",
    url: "s3://private/raw.png",
  };
  const mask = {
    ...source,
    id: "mask",
    generationTaskId: null,
    url: "s3://private/mask.png",
  };
  const processing = {
    kind: "masked-edit",
    algorithm: "masked-provider-rgb-interior-v2",
    alphaThreshold: 240,
    interiorRadius: 2,
    sourceAssetId: source.id,
    rawAssetId: raw.id,
    maskAssetId: mask.id,
    ...hashes,
  };
  const asset = {
    ...source,
    id: "derived",
    generationTaskId: null,
    parentAssetId: raw.id,
    url: "s3://private/derived.png",
    designStep: {
      id: "derived-step",
      projectId: "project",
      outputAssetId: "derived",
      generationTaskId: null,
      actor: "wardrobe",
      tool: "wardrobe-masked-edit",
      inputSnapshot: {
        version: 1,
        sources: [source.id, raw.id, mask.id].map((id) => ({
          role: "garment_ref",
          assetId: id,
          elementId: id,
        })),
        parameters: {
          processing: JSON.stringify(processing),
          reviewRequired: "true",
        },
      },
    },
  };
  const prepared = {
    id: "derived-preparation",
    projectId: "project",
    sourceAssetId: asset.id,
    frontAssetId: front.assetId,
    materialSourcePreparationId: "source-preparation",
    category: front.category,
    sourceKind: "isolated",
    mode: "existing",
    taskId: null,
    error: null,
    status: "ready",
    presentation: structuredClone(presentation),
    candidates: [{ assetId: asset.id }],
    materialProcessing: structuredClone(processing),
  };
  return {
    asset,
    source,
    raw,
    mask,
    front,
    hashes,
    fileHash: hashes.derivedSha256,
    sourceFileHash: hashes.sourceSha256,
    rawFileHash: hashes.rawSha256,
    task: {
      id: raw.generationTaskId,
      projectId: "project",
      status: "SUCCEEDED",
      taskType: "inpaint",
      parentAssetId: source.id,
      compiledPrompt: {
        notes: ["wardrobe-masked-correction-probe:v1"],
        request: {
          referenceImageUrl: source.url,
          referenceImageUrls: [source.url],
          maskImageUrl: mask.url,
        },
      },
    },
    preparation: {
      id: prepared.id,
      projectId: "project",
      ready: true,
      taskId: null,
      error: null,
      input: {
        sourceAssetId: asset.id,
        sourceKind: "isolated",
        mode: "existing",
        category: front.category,
        referenceAssetIds: [],
        presentation: structuredClone(presentation),
      },
    },
    sourcePreparation: {
      id: "source-preparation",
      projectId: "project",
      taskId: source.generationTaskId,
      error: null,
      input: {
        mode: "extract",
        category: front.category,
        presentation: structuredClone(presentation),
      },
    },
    prepared,
    receipt: {
      asset: structuredClone(asset),
      preparation: structuredClone(prepared),
      input: {
        sourceAssetId: source.id,
        rawAssetId: raw.id,
        maskAssetId: mask.id,
        sidePreparationId: "source-preparation",
        operation: "correction",
      },
    },
    wire: {
      referenceImages: [{ sha256: hashes.sourceSha256 }],
      maskImage: { sha256: hashes.maskSha256 },
    },
  };
}

test("调用前持久化；断线或失败不会因再次运行而重复发起付费请求", () => {
  const dir = mkdtempSync(join(tmpdir(), "wardrobe-journal-"));
  try {
    const file = join(dir, "source.json");
    reserveCall(file, { prompt: "羊毛外套" });
    assert.equal(readJson(file).status, "submitted-unknown");
    assert.throws(
      () => reserveCall(file, { prompt: "羊毛外套" }),
      /禁止自动重复收费/u,
    );
    writeJson(file, {
      ...readJson(file),
      status: "failed-or-unknown-no-auto-retry",
    });
    assert.throws(
      () => reserveCall(file, { prompt: "改变内容也不能覆盖" }),
      /禁止自动重复收费/u,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("续跑侧图批次补齐后来确认的正面，且不能错接其他正面资产", () => {
  const manifest = {
    items: [{ id: "earlier-case", provenance: { assetId: "earlier" } }],
  };
  const canonical = {
    items: [
      {
        id: "new-case",
        provenance: { assetId: "confirmed-front" },
        reviewedForDisplay: true,
      },
    ],
  };
  const front = ensureSideFront(
    manifest,
    canonical,
    "new-case",
    "confirmed-front",
  );
  front.sideDisplay = { reviewedForDisplay: false };
  assert.equal(manifest.items.length, 2);
  assert.equal(canonical.items[0].sideDisplay, undefined);
  assert.throws(
    () => ensureSideFront(manifest, canonical, "new-case", "different-source"),
    /实际输入资产/u,
  );
});

test("侧图恢复保留已有侧候选但同步相同正面资产的新挂点修订", () => {
  const old = {
    id: "coat",
    provenance: { assetId: "front", revisionId: "old" },
    reviewedForDisplay: true,
    anchor: { x: 0.5, y: 0.1 },
    sideDisplay: { sha256: "side-pending" },
  };
  const current = {
    ...old,
    provenance: { assetId: "front", revisionId: "new" },
    anchor: { x: 0.5, y: 0.21 },
    sideDisplay: undefined,
  };
  const result = ensureSideFront(
    { items: [old] },
    { items: [current] },
    "coat",
    "front",
  );
  assert.deepEqual(result.anchor, current.anchor);
  assert.equal(result.provenance.revisionId, "new");
  assert.equal(result.sideDisplay.sha256, "side-pending");
  assert.equal(old.anchor.y, 0.1);
});

test("新候选不能继承旧图审核、侧图和挂点确认进入正常渲染", () => {
  const previous = {
    id: "same-case",
    sha256: "old",
    reviewedForDisplay: true,
    anchorNeedsReview: false,
    review: { decision: "approved" },
    sideDisplay: { reviewedForDisplay: true },
    supportWidthRatio: 0.62,
  };
  const replacement = unreviewedCandidate({ ...previous, sha256: "new" });
  assert.equal(
    [replacement].filter((item) => item.reviewedForDisplay).length,
    0,
  );
  assert.equal(replacement.anchorNeedsReview, true);
  for (const key of ["review", "sideDisplay", "supportWidthRatio"])
    assert.equal(key in replacement, false);
  assert.equal(previous.reviewedForDisplay, true);
  assert.equal(previous.sideDisplay.reviewedForDisplay, true);
});

test("中间颜色抠底探针即使语义审核通过也不能作为展示成品确认", () => {
  assert.throws(
    () =>
      assertDisplayCandidate({
        processingProbe: true,
        review: { decision: "approved" },
      }),
    /中间素材/u,
  );
  assert.doesNotThrow(() => assertDisplayCandidate({ processingProbe: false }));
});

test("原生蒙版侧图登记保持真实结果与冻结正面绑定，不伪造生成准备", () => {
  const front = { id: "revision", assetId: "front", category: "outerwear" };
  const prepared = {
    externalInpaint: true,
    frontAssetId: "front",
    name: "羽绒服",
    category: "outerwear",
    presentation: { view: "side", revisionId: "revision", orientation: "left" },
    repairOfPreparationId: "actual-failed-side-preparation",
  };
  const result = sideInpaintRegistration(
    prepared,
    front,
    "real-inpaint",
    "key",
  );
  assert.equal(result.mode, "existing");
  assert.equal(result.sourceAssetId, "real-inpaint");
  assert.equal(result.presentation.revisionId, front.id);
  assert.equal("repairPreparationId" in result.presentation, false);
  for (const changes of [
    { assetId: "another-front" },
    { id: "another-revision" },
    { category: "top" },
  ])
    assert.throws(
      () =>
        sideInpaintRegistration(
          prepared,
          { ...front, ...changes },
          "result",
          "key",
        ),
      /冻结的同类别/u,
    );
  assert.throws(() => sideInpaintRegistration(prepared, front, "front", "key"));
  assert.throws(
    () =>
      sideInpaintRegistration(
        { ...prepared, mask: { processingProbe: true } },
        front,
        "probe-result",
        "key",
      ),
    /探针/u,
  );
});

test("侧图蒙版第二参考只接受当前已确认正面及独立批准的原像素裁片", () => {
  const reference = { sourceSha256: "front-hash", roiSha256: "roi-hash" };
  const revision = { assetId: "front-asset", id: "front-revision" };
  const front = {
    reviewedForDisplay: true,
    sha256: "front-hash",
    provenance: { assetId: "front-asset", revisionId: "front-revision" },
  };
  const review = {
    decision: "approved-as-structure-reference-only",
    ...reference,
    reviewChecks: ["five sleeve panels"],
  };
  assert.doesNotThrow(() =>
    assertConfirmedFrontReference(reference, front, revision, review),
  );
  for (const change of [
    { sourceSha256: "other-front" },
    { roiSha256: "diagnostic-image" },
  ])
    assert.throws(() =>
      assertConfirmedFrontReference(
        { ...reference, ...change },
        front,
        revision,
        review,
      ),
    );
  assert.throws(() =>
    assertConfirmedFrontReference(
      reference,
      { ...front, reviewedForDisplay: false },
      revision,
      review,
    ),
  );
  assert.throws(() =>
    assertConfirmedFrontReference(
      reference,
      front,
      { ...revision, id: "stale" },
      review,
    ),
  );
});

test("原创结构guide必须明确人工来源、精确字节与蒙版并绑定当前正面，不能冒充原图裁片", () => {
  const guide = {
    authored: true,
    role: "structure-guide-only-not-garment-design",
    frontAssetId: "front",
    frontRevisionId: "revision",
    frontSha256: "front-sha",
    sha256: "guide-sha",
    width: 1024,
    height: 1536,
  };
  const revision = { id: "revision", assetId: "front" };
  const front = {
    reviewedForDisplay: true,
    sha256: "front-sha",
    provenance: { assetId: "front", revisionId: "revision" },
  };
  const review = {
    decision: "approved-as-authored-structure-guide",
    authored: true,
    guideOnlyNotProviderOutput: true,
    frontAssetId: "front",
    frontRevisionId: "revision",
    frontSha256: "front-sha",
    guideSha256: "guide-sha",
    maskSha256: "mask-sha",
    reviewedBy: "reviewer",
    reviewedAt: "2026-10-30",
    reviewChecks: ["four internal lines, authored input only"],
  };
  const actual = {
    sha256: "guide-sha",
    width: 1024,
    height: 1536,
    maskSha256: "mask-sha",
  };
  assert.doesNotThrow(() =>
    assertAuthoredStructureGuide(guide, front, revision, review, actual),
  );
  for (const change of [
    { authored: false },
    { role: "same-source-roi" },
    { frontAssetId: "other" },
    { frontRevisionId: "stale" },
    { frontSha256: "other" },
    { sha256: "edited" },
    { width: 500 },
  ])
    assert.throws(() =>
      assertAuthoredStructureGuide(
        { ...guide, ...change },
        front,
        revision,
        review,
        actual,
      ),
    );
  for (const change of [
    { decision: "approved-as-structure-reference-only" },
    { guideOnlyNotProviderOutput: false },
    { maskSha256: "other-mask" },
    { guideSha256: "other-guide" },
    { reviewChecks: [] },
  ])
    assert.throws(() =>
      assertAuthoredStructureGuide(
        guide,
        front,
        revision,
        { ...review, ...change },
        actual,
      ),
    );
  assert.throws(() =>
    assertAuthoredStructureGuide(
      guide,
      { ...front, reviewedForDisplay: false },
      revision,
      review,
      actual,
    ),
  );
});

test("生产透明probe需真实侧候选与结构/蒙版精确审核，不能把中间图当成品", () => {
  const evidence = {
    item: { category: "top", processingProbe: true },
    registered: {
      id: "real-prep",
      status: "ready",
      sourceAssetId: "source",
      category: "top",
      presentation: { view: "side" },
      candidates: [{ assetId: "source" }],
    },
    sourceId: "source",
    sourceHash: "source-hash",
    maskHash: "mask-hash",
    sourceReview: {
      decision: "rejected",
      structureApproved: true,
      sha256: "source-hash",
      reviewChecks: ["structure passed, transmission pending"],
    },
    maskReview: {
      decision: "approved-as-targeted-edit-input-only",
      sourceSha256: "source-hash",
      maskSha256: "mask-hash",
      reviewChecks: ["sleeve selection"],
    },
  };
  assert.doesNotThrow(() => assertMaterialProbeEvidence(evidence));
  const intermediate = {
    ...evidence,
    registered: { ...evidence.registered, processingProbe: true },
    sourceReview: {
      decision: "approved-as-processing-intermediate",
      stage: "side-processing-probe",
      processingProbe: true,
      eligibleForNextStage: true,
      sha256: "source-hash",
      reviewChecks: ["zero seam intermediate only"],
    },
  };
  assert.throws(() => assertMaterialProbeEvidence(intermediate));
  assert.doesNotThrow(() =>
    assertMaterialProbeEvidence({ ...intermediate, allowProbeParent: true }),
  );
  assert.throws(() =>
    assertMaterialProbeEvidence({
      ...intermediate,
      allowProbeParent: true,
      sourceReview: {
        ...intermediate.sourceReview,
        eligibleForNextStage: false,
      },
    }),
  );
  for (const changes of [
    { item: { ...evidence.item, processingProbe: false } },
    { registered: { ...evidence.registered, id: undefined } },
    { registered: { ...evidence.registered, presentation: undefined } },
    { sourceId: "other" },
    { maskHash: "changed" },
    { sourceReview: { ...evidence.sourceReview, structureApproved: false } },
    { sourceReview: { ...evidence.sourceReview, sha256: "wrong" } },
    { maskReview: { ...evidence.maskReview, sourceSha256: "wrong" } },
  ])
    assert.throws(() =>
      assertMaterialProbeEvidence({ ...evidence, ...changes }),
    );
});

test("probe同案例只能确认真实独立派生资产，不能把raw状态改名为已审核候选", () => {
  const processing = {
    kind: "masked-edit",
    rawAssetId: "raw",
    sourceAssetId: "source",
    maskAssetId: "mask",
    derivedSha256: "derived-sha",
  };
  const candidate = {
    processingProbe: false,
    provenance: { assetId: "derived" },
    materialProcessing: processing,
  };
  const receipt = {
    asset: { id: "derived", parentAssetId: "raw", generationTaskId: null },
    preparation: {
      status: "ready",
      candidates: [{ assetId: "derived" }],
      materialProcessing: processing,
    },
  };
  assert.doesNotThrow(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true },
      candidate,
      receipt,
      "derived-sha",
    ),
  );
  for (const changed of [
    null,
    { ...receipt, asset: { ...receipt.asset, id: "raw" } },
    {
      ...receipt,
      asset: { ...receipt.asset, generationTaskId: "provider-task" },
    },
    {
      ...receipt,
      preparation: { ...receipt.preparation, candidates: [{ assetId: "raw" }] },
    },
  ])
    assert.throws(() =>
      assertDerivedDisplayCandidate(
        { processingProbe: true },
        candidate,
        changed,
        "derived-sha",
      ),
    );
  assert.throws(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true },
      candidate,
      receipt,
      "changed",
    ),
  );
  assert.throws(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true },
      { ...candidate, processingProbe: true },
      receipt,
      "derived-sha",
    ),
  );
  assert.throws(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true, derivedProcessingIntermediate: true },
      candidate,
      receipt,
      "derived-sha",
    ),
  );
  assert.throws(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true },
      candidate,
      { ...receipt, processingIntermediate: true },
      "derived-sha",
    ),
  );
  assert.throws(() =>
    assertDerivedDisplayCandidate(
      { processingProbe: true },
      candidate,
      {
        ...receipt,
        preparation: { ...receipt.preparation, processingProbe: true },
      },
      "derived-sha",
    ),
  );
});

test("普通生成侧图登记也必须提供数据库真实准备与冻结正面，不能靠本地ID", () => {
  const front = {
    id: "front-revision",
    assetId: "front",
    category: "outerwear",
  };
  const prepared = {
    id: "side-prep",
    taskId: "actual-task",
    frontAssetId: "front",
    category: "outerwear",
    name: "coat",
    presentation: {
      revisionId: "front-revision",
      view: "side",
      orientation: "left",
    },
  };
  const row = {
    id: "side-prep",
    taskId: "actual-task",
    task: { id: "actual-task", status: "SUCCEEDED" },
    error: null,
    input: {
      sourceAssetId: "front",
      category: "outerwear",
      presentation: prepared.presentation,
    },
  };
  assert.equal(
    sideInpaintRegistration(prepared, front, "side", "new-key", row).mode,
    "existing",
  );
  for (const changed of [
    undefined,
    { ...row, task: { id: "actual-task", status: "FAILED" } },
    { ...row, id: "fake" },
    { ...row, taskId: "other" },
    { ...row, input: { ...row.input, sourceAssetId: "other-front" } },
  ])
    assert.throws(() =>
      sideInpaintRegistration(prepared, front, "side", "new-key", changed),
    );
});

test("correction显式允许修已有结构但必须有同模式精确来源及蒙版审核", () => {
  const evidence = {
    item: {
      category: "outerwear",
      processingProbe: true,
      operation: "correction",
      notes: "仅修中间横缝",
    },
    registered: {
      id: "real-prep",
      status: "ready",
      sourceAssetId: "source",
      category: "outerwear",
      presentation: { view: "side" },
      candidates: [{ assetId: "source" }],
    },
    sourceId: "source",
    sourceHash: "source-hash",
    maskHash: "mask-hash",
    sourceReview: {
      decision: "rejected",
      structureApproved: false,
      eligibleForLocalCorrection: true,
      sha256: "source-hash",
      reviewChecks: ["internal seams need repair"],
    },
    maskReview: {
      operation: "correction",
      decision: "approved-as-targeted-edit-input-only",
      sourceSha256: "source-hash",
      maskSha256: "mask-hash",
      reviewChecks: ["only interior selected"],
    },
  };
  assert.doesNotThrow(() => assertMaterialProbeEvidence(evidence));
  for (const changes of [
    { item: { ...evidence.item, notes: "  " } },
    { item: { ...evidence.item, operation: "transparency" } },
    {
      sourceReview: {
        ...evidence.sourceReview,
        eligibleForLocalCorrection: false,
      },
    },
    { maskReview: { ...evidence.maskReview, operation: "transparency" } },
  ])
    assert.throws(() =>
      assertMaterialProbeEvidence({ ...evidence, ...changes }),
    );
  assert.equal(materialOperation({}), "transparency");
  assert.throws(() => materialOperation({ operation: "unknown" }));
  assert.throws(() =>
    materialOperation({ materialOperation: "correction", notes: "fix" }),
  );
});

test("下一阶段显式范围扩展绑定真实源和新mask，不得只复用旧通过决定", () => {
  const expected = {
    sourceSha256: "source",
    maskSha256: "mask",
    targetAttemptId: "new-attempt",
    operation: "correction",
  };
  const scope = {
    ...expected,
    decision: "approved-as-next-stage-scope",
    reviewedBy: "reviewer",
    reviewedAt: "2026-10-30",
    reviewChecks: ["body pair only; previous sleeve retained"],
    allowedTargets: ["body620", "body820"],
  };
  assert.doesNotThrow(() => assertNextStageScope(scope, expected));
  for (const changed of [
    { maskSha256: "old-mask" },
    { sourceSha256: "old-source" },
    { targetAttemptId: "previous" },
    { operation: "transparency" },
    { decision: "approved" },
    { allowedTargets: [] },
    { reviewChecks: [] },
  ])
    assert.throws(() =>
      assertNextStageScope({ ...scope, ...changed }, expected),
    );
});

test("真实guide位于图2且精确匹配已审预览，错源或mask必须在收费前拒绝", () => {
  const guide = {
    sourceSha256: "source",
    guideSha256: "guide",
    maskSha256: "mask",
  };
  const request = {
    referenceImages: [{ sha256: "source" }, { sha256: "guide" }],
    maskImage: { sha256: "mask" },
  };
  assert.doesNotThrow(() => assertCorrectionGuideWire(guide, request));
  assert.doesNotThrow(() =>
    assertCorrectionGuideWire(guide, {
      ...request,
      referenceImages: [...request.referenceImages, { sha256: "detail" }],
    }),
  );
  for (const changed of [
    { referenceImages: [{ sha256: "source" }] },
    { referenceImages: [{ sha256: "guide" }, { sha256: "source" }] },
    { referenceImages: [{ sha256: "source" }, { sha256: "changed" }] },
    { maskImage: { sha256: "other" } },
  ])
    assert.throws(() =>
      assertCorrectionGuideWire(guide, { ...request, ...changed }),
    );
});

test("派生correction必须匹配真实任务marker和冻结receipt，不能将green probe重命名", () => {
  const evidence = {
    operation: "correction",
    binding: {
      operation: "correction",
      sourceAssetId: "source",
      maskAssetId: "mask",
    },
    admission: {
      taskId: "task",
      input: {
        operation: "correction",
        sourceAssetId: "source",
        maskAssetId: "mask",
      },
      frozenInput: { operation: "correction" },
    },
    task: {
      id: "task",
      status: "SUCCEEDED",
      taskType: "inpaint",
      compiledPrompt: {
        notes: [
          "wardrobe-material-alpha-probe:v1",
          "wardrobe-masked-correction-probe:v1",
        ],
      },
    },
  };
  assert.doesNotThrow(() => assertMaterialDeriveOperation(evidence));
  for (const changes of [
    { operation: "transparency" },
    { binding: { ...evidence.binding, operation: undefined } },
    { admission: null },
    { admission: { ...evidence.admission, taskId: "other" } },
    {
      task: {
        ...evidence.task,
        compiledPrompt: { notes: ["wardrobe-material-alpha-probe:v1"] },
      },
    },
    { task: { ...evidence.task, status: "FAILED" } },
  ])
    assert.throws(() =>
      assertMaterialDeriveOperation({ ...evidence, ...changes }),
    );
  assert.doesNotThrow(() =>
    assertMaterialDeriveOperation({
      operation: "transparency",
      binding: {},
      task: { status: "SUCCEEDED", taskType: "inpaint" },
    }),
  );
});

test("单变量模型对照同时锁定蒙版、参考字节、提示及全部wire参数", () => {
  const baseline = {
    model: "sunburst",
    prompt: "five sleeve panels",
    quality: "high",
    referenceImages: [{ sha256: "source" }, { sha256: "sleeve" }],
    maskImage: { sha256: "mask" },
  };
  assert.doesNotThrow(() =>
    assertModelOnlyComparison(baseline, { ...baseline, model: "image2" }),
  );
  for (const mutation of [
    { maskImage: { sha256: "different-mask" } },
    { referenceImages: [{ sha256: "other-source" }] },
    { prompt: "new prompt" },
    { quality: "medium" },
    { output_compression: 80 },
  ])
    assert.throws(
      () =>
        assertModelOnlyComparison(baseline, {
          ...baseline,
          model: "image2",
          ...mutation,
        }),
      /wire/u,
    );
});

test("native侧图提取必须单独通过结构和去背景资格，拒绝probe与错误hash", () => {
  const front = { id: "front-revision", assetId: "front", category: "bottom" };
  const prepared = {
    externalInpaint: true,
    taskId: "native",
    frontAssetId: "front",
    category: "bottom",
    presentation: { revisionId: "front-revision" },
  };
  const task = { id: "native", taskType: "inpaint", status: "SUCCEEDED" };
  const review = {
    decision: "rejected",
    stage: "side",
    sha256: "native-hash",
    structureApproved: true,
    eligibleForBackgroundOnlyExtraction: true,
    reviewChecks: ["structure preserved; RGB checker only"],
  };
  assert.doesNotThrow(() =>
    assertNativeSideCutoutSource(prepared, task, review, "native-hash", front),
  );
  for (const changed of [
    { structureApproved: false },
    { eligibleForBackgroundOnlyExtraction: false },
    { sha256: "other" },
  ])
    assert.throws(() =>
      assertNativeSideCutoutSource(
        prepared,
        task,
        { ...review, ...changed },
        "native-hash",
        front,
      ),
    );
  assert.throws(() =>
    assertNativeSideCutoutSource(
      { ...prepared, mask: { processingProbe: true } },
      task,
      review,
      "native-hash",
      front,
    ),
  );
  assert.throws(() =>
    assertNativeSideCutoutSource(
      prepared,
      { ...task, status: "FAILED" },
      review,
      "native-hash",
      front,
    ),
  );
  const input = sideInpaintRegistration(
    {
      ...prepared,
      externalInpaint: false,
      externalSideCutout: true,
      cutoutPreparationId: "real-ordinary-prep",
      presentation: { view: "side", revisionId: front.id, orientation: "left" },
    },
    front,
    "real-cutout-result",
    "existing-registration",
  );
  assert.equal(input.mode, "existing");
  assert.equal(input.sourceAssetId, "real-cutout-result");
  assert.equal("repairPreparationId" in input.presentation, false);
});

test("处理中间图只在显式下一阶段开关和精确独审后作为parent，不能冒成侧图通过", () => {
  const review = {
    decision: "approved-as-processing-intermediate",
    stage: "side-processing-probe",
    eligibleForNextStage: true,
    processingProbe: true,
    sha256: "probe",
    reviewChecks: ["zero seams"],
  };
  assert.doesNotThrow(() => assertProbeParentReview(review, "probe", true));
  assert.throws(() => assertProbeParentReview(review, "probe", false));
  assert.throws(() => assertProbeParentReview(review, "different", true));
  assert.throws(() =>
    assertProbeParentReview(
      { ...review, eligibleForNextStage: false },
      "probe",
      true,
    ),
  );
  assert.throws(() =>
    assertProbeParentReview({ ...review, decision: "approved" }, "probe", true),
  );
});

test("native递归每层核对真实task/parent/字节和冻结正面，普通侧图必须有真实准备", () => {
  const hop = {
    asset: {
      id: "native",
      generationTaskId: "task",
      parentAssetId: "previous",
      projectId: "project",
      rootAssetId: "root",
    },
    parent: {
      id: "previous",
      projectId: "project",
      rootAssetId: "root",
      url: "s3://previous",
    },
    task: {
      id: "task",
      status: "SUCCEEDED",
      taskType: "inpaint",
      parentAssetId: "previous",
      projectId: "project",
      compiledPrompt: { request: { referenceImageUrl: "s3://previous" } },
    },
    prepared: {
      externalInpaint: true,
      sourceAssetId: "previous",
      frontAssetId: "front",
      category: "top",
      presentation: { revisionId: "revision", orientation: "left" },
      sourceLineage: { sha256: "parent-sha" },
    },
    front: {
      id: "revision",
      assetId: "front",
      category: "top",
      orientation: "left",
    },
    actualHash: "native-sha",
    fileHash: "native-sha",
    parentHash: "parent-sha",
    wire: { referenceImages: [{ sha256: "parent-sha" }] },
  };
  assert.doesNotThrow(() => assertNativeSideHop(hop));
  for (const changed of [
    { fileHash: "changed" },
    { parentHash: "wrong" },
    { parent: { ...hop.parent, id: "other" } },
    { front: { ...hop.front, orientation: "right" } },
    { task: { ...hop.task, status: "FAILED" } },
  ])
    assert.throws(() => assertNativeSideHop({ ...hop, ...changed }));
  const ordinary = {
    ...hop,
    prepared: { ...hop.prepared, externalInpaint: false },
  };
  assert.throws(
    () => assertNativeSideHop(ordinary),
    /真实WardrobePreparation/u,
  );
  assert.doesNotThrow(() =>
    assertNativeSideHop({
      ...ordinary,
      preparation: {
        taskId: "task",
        input: {
          category: "top",
          presentation: { revisionId: "revision", orientation: "left" },
        },
      },
    }),
  );
  const cutout = {
    ...hop,
    parent: { ...hop.parent, generationTaskId: "parent-inpaint-task" },
    task: { ...hop.task, taskType: "i2i" },
    prepared: {
      ...hop.prepared,
      externalInpaint: false,
      externalSideCutout: true,
      cutoutPreparationId: "ordinary-extract",
      nativeInputPreparation: {
        externalInpaint: true,
        taskId: "parent-inpaint-task",
        frontAssetId: "front",
        category: "top",
        presentation: { revisionId: "revision", orientation: "left" },
      },
    },
    preparation: {
      id: "ordinary-extract",
      taskId: "task",
      input: {
        mode: "extract",
        sourceKind: "isolated",
        sourceAssetId: "previous",
        category: "top",
        referenceAssetIds: [],
      },
    },
  };
  assert.doesNotThrow(() => assertNativeSideHop(cutout));
  for (const changed of [
    { preparation: null },
    { preparation: { ...cutout.preparation, id: "fake" } },
    { task: { ...cutout.task, taskType: "inpaint" } },
    {
      preparation: {
        ...cutout.preparation,
        input: { ...cutout.preparation.input, sourceAssetId: "other" },
      },
    },
    {
      preparation: {
        ...cutout.preparation,
        input: {
          ...cutout.preparation.input,
          presentation: { revisionId: "revision" },
        },
      },
    },
    {
      prepared: {
        ...cutout.prepared,
        nativeInputPreparation: {
          ...cutout.prepared.nativeInputPreparation,
          taskId: "wrong-parent",
        },
      },
    },
  ])
    assert.throws(() => assertNativeSideHop({ ...cutout, ...changed }));
});

test("递归祖先接受真实无task派生资产，不将算法派生伪装成native任务", () => {
  const hop = derivedNativeHop();
  const processing = assertDerivedNativeSideHop(hop);
  assert.equal(processing.algorithm, "masked-provider-rgb-interior-v2");
  assert.equal(hop.asset.generationTaskId, null);
  assert.equal(hop.preparation.taskId, null);
  assert.equal(hop.asset.parentAssetId, hop.raw.id);
  assert.equal(hop.raw.parentAssetId, hop.source.id);
  assert.deepEqual(processing, hop.prepared.materialProcessing);
  assert.throws(
    () =>
      sideInpaintRegistration(
        { ...hop.prepared, processingProbe: true },
        hop.front,
        hop.asset.id,
        "must-not-confirm-ancestor",
      ),
    /处理探针不得登记/u,
  );
});

test("派生祖先仍兼容历史RGB v1和真实透明派生算法，不重写为v2", () => {
  for (const kind of ["masked-edit", "material-alpha"]) {
    const hop = derivedNativeHop();
    const processing = {
      ...hop.prepared.materialProcessing,
      kind,
      algorithm:
        kind === "masked-edit"
          ? "masked-provider-rgb-preserve-alpha-v1"
          : "green-dominance-original-rgb-v1",
    };
    delete processing.alphaThreshold;
    delete processing.interiorRadius;
    hop.asset.designStep.inputSnapshot.parameters.processing =
      JSON.stringify(processing);
    hop.prepared.materialProcessing = structuredClone(processing);
    hop.receipt.preparation.materialProcessing = structuredClone(processing);
    if (kind === "material-alpha") {
      hop.asset.designStep.tool = "wardrobe-material-alpha";
      hop.task.compiledPrompt.notes = ["wardrobe-material-alpha-probe:v1"];
      delete hop.receipt.input.operation;
    }
    assert.deepEqual(assertDerivedNativeSideHop(hop), processing);
    if (kind === "masked-edit") {
      const invalid = { ...processing, algorithm: "masked-provider-rgb-v1" };
      hop.asset.designStep.inputSnapshot.parameters.processing =
        JSON.stringify(invalid);
      hop.prepared.materialProcessing = invalid;
      hop.receipt.preparation.materialProcessing = structuredClone(invalid);
      assert.throws(() => assertDerivedNativeSideHop(hop));
    }
  }
});

test("派生链上一层也可为真实existing算法来源，来源准备必须实际包含该资产", () => {
  const hop = derivedNativeHop();
  hop.source.generationTaskId = null;
  hop.sourcePreparation.taskId = null;
  hop.sourcePreparation.ready = true;
  hop.sourcePreparation.input.mode = "existing";
  hop.sourcePreparation.input.sourceAssetId = hop.source.id;
  assert.doesNotThrow(() => assertDerivedNativeSideHop(hop));
  for (const changed of [
    { ready: false },
    { taskId: "invented-source-task" },
    {
      input: { ...hop.sourcePreparation.input, sourceAssetId: "other-source" },
    },
  ]) {
    assert.throws(
      () =>
        assertDerivedNativeSideHop({
          ...hop,
          sourcePreparation: { ...hop.sourcePreparation, ...changed },
        }),
      /派生侧图/u,
    );
  }
});

test("派生祖先拒绝伪造任务、私有资产、真实准备和冻结正面不一致", async (t) => {
  const changes = [
    [
      "给派生资产伪造任务",
      (hop) => {
        hop.asset.generationTaskId = "fake";
      },
    ],
    [
      "给派生DesignStep伪造任务",
      (hop) => {
        hop.asset.designStep.generationTaskId = "fake";
      },
    ],
    [
      "把派生直接挂到算法源",
      (hop) => {
        hop.asset.parentAssetId = hop.source.id;
      },
    ],
    [
      "替换raw根资产",
      (hop) => {
        hop.raw.rootAssetId = "another-design";
      },
    ],
    [
      "跨项目来源",
      (hop) => {
        hop.source.projectId = "another-project";
      },
    ],
    [
      "源资产归档",
      (hop) => {
        hop.source.archivedAt = "2026-11-04T00:00:00Z";
      },
    ],
    [
      "非私有蒙版",
      (hop) => {
        hop.mask.url = "https://example.test/mask.png";
      },
    ],
    [
      "伪造准备ID",
      (hop) => {
        hop.preparation.id = "fake-preparation";
      },
    ],
    [
      "派生准备尚未就绪",
      (hop) => {
        hop.preparation.ready = false;
      },
    ],
    [
      "派生准备含付费任务",
      (hop) => {
        hop.preparation.taskId = "fake-task";
      },
    ],
    [
      "派生准备存在错误",
      (hop) => {
        hop.preparation.error = "failed";
      },
    ],
    [
      "existing被换为extract",
      (hop) => {
        hop.preparation.input.mode = "extract";
      },
    ],
    [
      "来源类型不符",
      (hop) => {
        hop.preparation.input.sourceKind = "sketch";
      },
    ],
    [
      "准备引用别的资产",
      (hop) => {
        hop.preparation.input.sourceAssetId = "other";
      },
    ],
    [
      "准备额外增加裁剪",
      (hop) => {
        hop.preparation.input.region = { x: 0, y: 0, width: 0.5, height: 1 };
      },
    ],
    [
      "准备夹带参考图",
      (hop) => {
        hop.preparation.input.referenceAssetIds = ["other"];
      },
    ],
    [
      "视图候选不含派生资产",
      (hop) => {
        hop.prepared.candidates = [{ assetId: "other" }];
      },
    ],
    [
      "缺少真实来源准备",
      (hop) => {
        hop.sourcePreparation = null;
      },
    ],
    [
      "来源准备与receipt错接",
      (hop) => {
        hop.sourcePreparation.id = "wrong-source-preparation";
      },
    ],
    [
      "来源准备跨项目",
      (hop) => {
        hop.sourcePreparation.projectId = "other-project";
      },
    ],
    [
      "来源准备任务不是实际source任务",
      (hop) => {
        hop.sourcePreparation.taskId = "another-source-task";
      },
    ],
    [
      "来源准备冻结方向错误",
      (hop) => {
        hop.sourcePreparation.input.presentation.orientation = "right";
      },
    ],
    [
      "当前正面修订已改变",
      (hop) => {
        hop.front.id = "new-front-revision";
      },
    ],
    [
      "当前正面资产已改变",
      (hop) => {
        hop.front.assetId = "new-front-asset";
      },
    ],
    [
      "当前类别改变",
      (hop) => {
        hop.front.category = "top";
      },
    ],
    [
      "当前方向改变",
      (hop) => {
        hop.front.orientation = "right";
      },
    ],
  ];
  for (const [name, change] of changes) {
    await t.test(name, () => {
      const hop = derivedNativeHop();
      change(hop);
      assert.throws(() => assertDerivedNativeSideHop(hop), /派生侧图/u);
    });
  }
});

test("派生祖先逐项核对三源四SHA、DesignStep和实际raw任务输入", async (t) => {
  const changes = [
    [
      "非法processing JSON",
      (hop) => {
        hop.asset.designStep.inputSnapshot.parameters.processing = "{";
      },
    ],
    [
      "错误处理tool",
      (hop) => {
        hop.asset.designStep.tool = "wardrobe-correction-guide";
      },
    ],
    [
      "错误处理actor",
      (hop) => {
        hop.asset.designStep.actor = "user";
      },
    ],
    [
      "处理step错接输出",
      (hop) => {
        hop.asset.designStep.outputAssetId = hop.raw.id;
      },
    ],
    [
      "缺少人工审核约束",
      (hop) => {
        hop.asset.designStep.inputSnapshot.parameters.reviewRequired = "false";
      },
    ],
    [
      "三源缺少蒙版",
      (hop) => {
        hop.asset.designStep.inputSnapshot.sources.pop();
      },
    ],
    [
      "三源次序被替换",
      (hop) => {
        hop.asset.designStep.inputSnapshot.sources.reverse();
      },
    ],
    [
      "receipt伪造任务",
      (hop) => {
        hop.receipt.asset.generationTaskId = "fake";
      },
    ],
    [
      "receipt改用另一来源",
      (hop) => {
        hop.receipt.input.sourceAssetId = "other-source";
      },
    ],
    [
      "receipt混淆操作类型",
      (hop) => {
        hop.receipt.input.operation = "transparency";
      },
    ],
    [
      "receipt处理记录篡改",
      (hop) => {
        hop.receipt.preparation.materialProcessing.rawSha256 = "changed";
      },
    ],
    [
      "源文件不是已核对字节",
      (hop) => {
        hop.sourceFileHash = "changed";
      },
    ],
    [
      "raw文件不是实际输出",
      (hop) => {
        hop.rawFileHash = "changed";
      },
    ],
    [
      "派生文件不是已核对字节",
      (hop) => {
        hop.fileHash = "changed";
      },
    ],
    [
      "四SHA缺少一份",
      (hop) => {
        delete hop.hashes.maskSha256;
      },
    ],
    [
      "raw任务未成功",
      (hop) => {
        hop.task.status = "RUNNING";
      },
    ],
    [
      "raw任务不是INPAINT",
      (hop) => {
        hop.task.taskType = "i2i";
      },
    ],
    [
      "raw资产指向另一任务",
      (hop) => {
        hop.raw.generationTaskId = "other-task";
      },
    ],
    [
      "raw任务来自另一项目",
      (hop) => {
        hop.task.projectId = "other-project";
      },
    ],
    [
      "raw任务父资产不符",
      (hop) => {
        hop.task.parentAssetId = "other-source";
      },
    ],
    [
      "raw资产父资产不符",
      (hop) => {
        hop.raw.parentAssetId = "other-source";
      },
    ],
    [
      "compiled主参考错源",
      (hop) => {
        hop.task.compiledPrompt.request.referenceImageUrl = "s3://other.png";
      },
    ],
    [
      "compiled首图错序",
      (hop) => {
        hop.task.compiledPrompt.request.referenceImageUrls.unshift(
          hop.mask.url,
        );
      },
    ],
    [
      "compiled蒙版错源",
      (hop) => {
        hop.task.compiledPrompt.request.maskImageUrl = hop.source.url;
      },
    ],
    [
      "缺少真实correction marker",
      (hop) => {
        hop.task.compiledPrompt.notes = [];
      },
    ],
    [
      "实际wire首图不是源",
      (hop) => {
        hop.wire.referenceImages[0].sha256 = hop.hashes.maskSha256;
      },
    ],
    [
      "实际wire蒙版错误",
      (hop) => {
        hop.wire.maskImage.sha256 = "changed";
      },
    ],
  ];
  for (const key of [
    "sourceSha256",
    "rawSha256",
    "maskSha256",
    "derivedSha256",
  ]) {
    changes.push([
      `实际${key}不符`,
      (hop) => {
        hop.hashes[key] = "changed";
      },
    ]);
  }
  for (const [name, change] of changes) {
    await t.test(name, () => {
      const hop = derivedNativeHop();
      change(hop);
      assert.throws(() => assertDerivedNativeSideHop(hop), /派生侧图/u);
    });
  }
});

test("新意图可显式使用独立全图审核，旧probe审核文件选择保持兼容", () => {
  assert.equal(
    nativeSourceReviewName(true, "side-review.json", false),
    "probe-review.json",
  );
  assert.equal(
    nativeSourceReviewName(false, "side-review.json", false),
    "side-review.json",
  );
  assert.equal(
    nativeSourceReviewName(true, "whole-review.json", true),
    "whole-review.json",
  );
  assert.equal(
    nativeSourceReviewName(false, "whole-review.json", true),
    "whole-review.json",
  );
});

test("新原生意图范围只能缩小独立全图审核允许目标，不能借旧局部结论扩大", async (t) => {
  const expected = {
    sourceSha256: "raw-sha",
    maskSha256: "new-mask-sha",
    targetAttemptId: "new-native-attempt",
    operation: "correction",
  };
  const review = {
    decision: "approved-as-processing-intermediate",
    stage: "side-processing-probe",
    eligibleForNextStage: true,
    processingProbe: true,
    sha256: expected.sourceSha256,
    reviewedBy: "independent-reviewer",
    reviewedAt: "2026-11-04T00:00:00Z",
    reviewChecks: ["实际全图轮廓与已成功结构核对，允许新目标"],
    allowedTargets: ["body-lower-seam", "near-sleeve-lower-seam"],
  };
  const scope = {
    ...expected,
    decision: "approved-as-next-stage-scope",
    reviewedBy: "independent-reviewer",
    reviewedAt: "2026-11-04T00:01:00Z",
    reviewChecks: ["本次仅处理已获批目标子集"],
    allowedTargets: ["body-lower-seam"],
  };
  assert.doesNotThrow(() =>
    assertNativeContinuationScope(review, scope, expected),
  );
  assert.doesNotThrow(() =>
    assertNativeContinuationScope(
      review,
      { ...scope, allowedTargets: [...review.allowedTargets] },
      expected,
    ),
  );
  for (const [name, change] of [
    [
      "超出审核目标",
      (value) => {
        value.scope.allowedTargets.push("collar");
      },
    ],
    [
      "旧局部审核没有allowedTargets",
      (value) => {
        delete value.review.allowedTargets;
      },
    ],
    [
      "审核人缺失",
      (value) => {
        delete value.review.reviewedBy;
      },
    ],
    [
      "审核时间缺失",
      (value) => {
        delete value.review.reviewedAt;
      },
    ],
    [
      "旧失败结论",
      (value) => {
        value.review.decision = "rejected";
      },
    ],
    [
      "审核不允许下一阶段",
      (value) => {
        value.review.eligibleForNextStage = false;
      },
    ],
    [
      "审核针对另一输出",
      (value) => {
        value.review.sha256 = "other";
      },
    ],
    [
      "范围未独立批准",
      (value) => {
        value.scope.decision = "pending";
      },
    ],
    [
      "范围缺少检查记录",
      (value) => {
        value.scope.reviewChecks = [];
      },
    ],
    [
      "范围无目标",
      (value) => {
        value.scope.allowedTargets = [];
      },
    ],
    [
      "范围错源",
      (value) => {
        value.scope.sourceSha256 = "other";
      },
    ],
    [
      "范围错蒙版",
      (value) => {
        value.scope.maskSha256 = "other";
      },
    ],
    [
      "范围错attempt",
      (value) => {
        value.scope.targetAttemptId = "other";
      },
    ],
    [
      "范围错操作",
      (value) => {
        value.scope.operation = "transparency";
      },
    ],
  ]) {
    await t.test(name, () => {
      const value = structuredClone({ review, scope });
      change(value);
      assert.throws(() =>
        assertNativeContinuationScope(value.review, value.scope, expected),
      );
    });
  }
});
