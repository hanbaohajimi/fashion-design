import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const readJson = (file, fallback = null) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? item.toString() : item),
      2,
    ) + "\n",
    "utf8",
  );
  renameSync(temporary, file);
}

/** Keep generation input separate from the later existing-preparation view. */
export function readNativeSidePreparation(directory) {
  const preserved = readJson(
    resolve(directory, "native-input-preparation.json"),
  );
  if (!preserved) return readJson(resolve(directory, "side-preparation.json"));
  if (
    ![
      "preserved-before-registration",
      "reconstructed-from-recorded-task-and-binding",
    ].includes(preserved.evidenceKind) ||
    !preserved.preparation?.taskId ||
    !(
      preserved.preparation.externalInpaint ||
      preserved.preparation.externalSideCutout
    )
  )
    throw new Error("独立native输入证据缺少真实任务或明确来源标记");
  return preserved.preparation;
}

export function preserveNativeInputPreparation(directory, preparation) {
  if (!(preparation?.externalInpaint || preparation?.externalSideCutout))
    return;
  if (
    !preparation.taskId ||
    !preparation.sourceAssetId ||
    preparation.mode === "existing"
  )
    throw new Error("不能将已覆盖的existing准备冒充原native输入");
  const file = resolve(directory, "native-input-preparation.json");
  if (existsSync(file)) {
    if (!isDeepStrictEqual(readNativeSidePreparation(directory), preparation))
      throw new Error("已保留的native输入不得改写");
    return;
  }
  writeJson(file, {
    evidenceKind: "preserved-before-registration",
    preservedAt: new Date().toISOString(),
    preparation,
  });
}
/** Persist intent BEFORE sending. An uncertain or failed request is never sent twice automatically. */
export function reserveCall(file, request) {
  const prior = readJson(file);
  if (prior)
    throw new Error(
      `已有调用记录 ${prior.status}，禁止自动重复收费；检查 ${file}`,
    );
  writeJson(file, {
    status: "submitted-unknown",
    fingerprint: fingerprint(request),
    startedAt: new Date().toISOString(),
    request,
  });
}

/** Review is tied to exact pixels, never to a case ID or an earlier candidate. */
export function unreviewedCandidate(candidate) {
  const result = { ...candidate };
  for (const field of ["review", "sideDisplay", "supportWidthRatio"])
    delete result[field];
  return { ...result, reviewedForDisplay: false, anchorNeedsReview: true };
}

export function assertDisplayCandidate(candidate) {
  if (candidate?.processingProbe)
    throw new Error("处理探针是中间素材，不允许confirm为入架成品");
}

/** A probe case may continue to a distinct, audited production-derived asset. */
export function assertDerivedDisplayCandidate(item, candidate, receipt, hash) {
  assertDisplayCandidate(candidate);
  if (
    item?.derivedProcessingIntermediate ||
    receipt?.processingIntermediate ||
    receipt?.preparation?.processingProbe
  )
    throw new Error("派生处理中间素材不能确认入架，须先完成后续编辑并独立审核");
  if (!item?.processingProbe) return;
  const processing = receipt?.preparation?.materialProcessing;
  if (
    !processing ||
    processing.derivedSha256 !== hash ||
    receipt.preparation.status !== "ready" ||
    receipt.asset?.id !== candidate?.provenance?.assetId ||
    receipt.asset.parentAssetId !== processing.rawAssetId ||
    receipt.asset.generationTaskId ||
    [
      processing.rawAssetId,
      processing.sourceAssetId,
      processing.maskAssetId,
    ].includes(receipt.asset.id) ||
    !receipt.preparation.candidates?.some(
      (value) => value.assetId === receipt.asset.id,
    ) ||
    fingerprint(processing) !== fingerprint(candidate.materialProcessing)
  )
    throw new Error(
      "probe案例只能确认真实独立派生候选，不能直接确认处理中间图",
    );
}

export function materialOperation(item) {
  const operation = item?.operation ?? "transparency";
  if (
    !["transparency", "correction"].includes(operation) ||
    (item?.materialOperation && item.materialOperation !== operation) ||
    (operation === "correction" && !item.notes?.trim())
  )
    throw new Error("素材处理operation必须明确一致，局部修正必须提供notes");
  return operation;
}

/** An explicit scope extension supplements, never rewrites, the parent pixel review. */
export function assertNextStageScope(scope, expected) {
  if (
    scope?.decision !== "approved-as-next-stage-scope" ||
    scope.sourceSha256 !== expected.sourceSha256 ||
    scope.maskSha256 !== expected.maskSha256 ||
    scope.targetAttemptId !== expected.targetAttemptId ||
    scope.operation !== expected.operation ||
    !scope.reviewedBy ||
    !scope.reviewedAt ||
    !scope.reviewChecks?.length ||
    !scope.allowedTargets?.length
  )
    throw new Error(
      "下一阶段范围说明必须绑定真实源、当前蒙版、operation及本次attempt，不能改写旧审核",
    );
}

/** Position-guide preflight is from the production function, never a replacement original. */
export function assertCorrectionGuideWire(guide, request) {
  if (
    !guide ||
    request.referenceImages?.length < 2 ||
    request.referenceImages?.length > 3 ||
    request.referenceImages[0]?.sha256 !== guide.sourceSha256 ||
    request.referenceImages[1]?.sha256 !== guide.guideSha256 ||
    request.maskImage?.sha256 !== guide.maskSha256
  )
    throw new Error(
      "实际guide wire与已审核生产预览的源、图2或蒙版SHA不一致，禁止收费请求",
    );
}

/** Correction must originate in the real production operation, not a renamed green probe. */
export function assertMaterialDeriveOperation({
  operation,
  binding,
  admission,
  task,
}) {
  const correction = Boolean(
    task?.compiledPrompt?.notes?.includes(
      "wardrobe-masked-correction-probe:v1",
    ),
  );
  if (
    !task ||
    task.status !== "SUCCEEDED" ||
    task.taskType !== "inpaint" ||
    correction !== (operation === "correction") ||
    (binding.operation && binding.operation !== operation) ||
    (operation === "correction" &&
      (binding.operation !== "correction" ||
        admission?.input?.operation !== "correction" ||
        admission?.frozenInput?.operation !== "correction" ||
        admission.taskId !== task.id ||
        admission.input.sourceAssetId !== binding.sourceAssetId ||
        admission.input.maskAssetId !== binding.maskAssetId))
  )
    throw new Error(
      "素材派生operation与真实任务marker、冻结probe receipt或来源不符",
    );
}

export function assertMaterialProbeEvidence({
  item,
  registered,
  sourceId,
  sourceHash,
  maskHash,
  sourceReview,
  maskReview,
  allowProbeParent = false,
}) {
  const operation = materialOperation(item);
  const intermediate = registered?.processingProbe === true;
  if (intermediate)
    assertProbeParentReview(sourceReview, sourceHash, allowProbeParent);
  if (
    item?.processingProbe !== true ||
    !registered?.id ||
    registered.status !== "ready" ||
    registered.sourceAssetId !== sourceId ||
    registered.category !== item.category ||
    registered.presentation?.view !== "side" ||
    !registered.candidates?.some(
      (candidate) => candidate.assetId === sourceId,
    ) ||
    sourceReview?.sha256 !== sourceHash ||
    !sourceReview.reviewChecks?.length ||
    !(
      intermediate ||
      sourceReview.decision === "approved" ||
      (sourceReview.decision === "rejected" &&
        (operation === "correction"
          ? sourceReview.eligibleForLocalCorrection === true
          : sourceReview.structureApproved === true))
    ) ||
    maskReview?.decision !== "approved-as-targeted-edit-input-only" ||
    maskReview.sourceSha256 !== sourceHash ||
    maskReview.maskSha256 !== maskHash ||
    (operation === "correction" && maskReview.operation !== "correction") ||
    !maskReview.reviewChecks?.length
  )
    throw new Error(
      "素材probe必须为显式中间处理、真实已登记侧候选和精确hash已审来源/蒙版",
    );
}

/** Compare the complete captured wire request, including mask bytes, except model ID. */
export function assertModelOnlyComparison(baseline, request) {
  if (!baseline?.model || !request?.model)
    throw new Error("模型对照缺少实际baseline或model");
  const previous = { ...baseline };
  const current = { ...request };
  delete previous.model;
  delete current.model;
  if (!isDeepStrictEqual(previous, current))
    throw new Error("模型对照实际wire除model外与baseline不一致，禁止收费请求");
}

/** A side correction may cite a sleeve from this exact confirmed front, never another garment. */
export function assertConfirmedFrontReference(
  reference,
  front,
  revision,
  review,
) {
  if (
    !front?.reviewedForDisplay ||
    front.provenance?.assetId !== revision?.assetId ||
    front.provenance?.revisionId !== revision?.id ||
    reference?.sourceSha256 !== front.sha256 ||
    review?.decision !== "approved-as-structure-reference-only" ||
    review.sourceSha256 !== reference.sourceSha256 ||
    review.roiSha256 !== reference.roiSha256 ||
    !review.reviewChecks?.length
  )
    throw new Error("侧图结构参考必须来自已确认且审核hash匹配的当前正面修订");
}

/** An authored guide is explicitly different from a crop of the real garment. */
export function assertAuthoredStructureGuide(
  guide,
  front,
  revision,
  review,
  actual,
) {
  if (
    guide?.authored !== true ||
    guide.role !== "structure-guide-only-not-garment-design" ||
    !front?.reviewedForDisplay ||
    guide.frontAssetId !== revision?.assetId ||
    guide.frontRevisionId !== revision.id ||
    front.provenance?.assetId !== revision.assetId ||
    front.provenance?.revisionId !== revision.id ||
    guide.frontSha256 !== front.sha256 ||
    guide.sha256 !== actual?.sha256 ||
    guide.width !== actual.width ||
    guide.height !== actual.height ||
    review?.decision !== "approved-as-authored-structure-guide" ||
    review.authored !== true ||
    review.guideOnlyNotProviderOutput !== true ||
    review.guideSha256 !== guide.sha256 ||
    review.frontSha256 !== guide.frontSha256 ||
    review.frontAssetId !== guide.frontAssetId ||
    review.frontRevisionId !== guide.frontRevisionId ||
    review.maskSha256 !== actual.maskSha256 ||
    !review.reviewedBy ||
    !review.reviewedAt ||
    !review.reviewChecks?.length
  )
    throw new Error(
      "原创结构guide须明确标注、匹配实际字节与蒙版并绑定当前已审核正面",
    );
}

export function assertNativeSideCutoutSource(
  prepared,
  task,
  review,
  hash,
  front,
) {
  if (
    !prepared?.externalInpaint ||
    prepared.mask?.processingProbe ||
    prepared.processingProbe ||
    task?.status !== "SUCCEEDED" ||
    task.taskType !== "inpaint" ||
    task.id !== prepared.taskId ||
    task.compiledPrompt?.notes?.includes("wardrobe-material-alpha-probe:v1") ||
    review?.decision !== "rejected" ||
    review.stage !== "side" ||
    review.sha256 !== hash ||
    review.structureApproved !== true ||
    review.eligibleForBackgroundOnlyExtraction !== true ||
    !review.reviewChecks?.length ||
    prepared.frontAssetId !== front?.assetId ||
    prepared.category !== front.category ||
    prepared.presentation?.revisionId !== front.id
  )
    throw new Error(
      "native侧图只可在精确hash结构通过且仅需去背景的独立审核后提取；probe不可采用",
    );
}

export function assertProbeParentReview(review, hash, explicitlyAllowed) {
  if (
    !explicitlyAllowed ||
    review?.decision !== "approved-as-processing-intermediate" ||
    review.stage !== "side-processing-probe" ||
    review.eligibleForNextStage !== true ||
    review.processingProbe !== true ||
    review.sha256 !== hash ||
    !review.reviewChecks?.length
  )
    throw new Error(
      "处理中间父图须显式允许并有精确hash的下一阶段审核，不能视为成品通过",
    );
}

/** A new intent may cite a separate review; the old rejection is never rewritten. */
export function nativeSourceReviewName(allowProbeParent, sideReview, explicit) {
  return explicit || !allowProbeParent ? sideReview : "probe-review.json";
}

export function assertNativeContinuationScope(review, scope, expected) {
  assertProbeParentReview(review, expected.sourceSha256, true);
  assertNextStageScope(scope, expected);
  if (
    !review.reviewedBy ||
    !review.reviewedAt ||
    !review.allowedTargets?.length ||
    scope.allowedTargets.some(
      (target) => !review.allowedTargets.includes(target),
    )
  )
    throw new Error(
      "新意图范围必须是独立父图审核明确允许的目标，不能沿用旧局部结论",
    );
}

/** A derived hop is a real source/raw/mask DAG, not an invented generation task. */
export function assertDerivedNativeSideHop({
  asset,
  source,
  raw,
  mask,
  task,
  preparation,
  sourcePreparation,
  prepared,
  receipt,
  front,
  hashes,
  fileHash,
  sourceFileHash,
  rawFileHash,
  wire,
}) {
  const step = asset?.designStep;
  let processing;
  try {
    processing = JSON.parse(
      step?.inputSnapshot?.parameters?.processing ?? "null",
    );
  } catch {
    throw new Error("派生侧图DesignStep处理记录无效");
  }
  const correction = processing?.kind === "masked-edit";
  const expectedTool = correction
    ? "wardrobe-masked-edit"
    : "wardrobe-material-alpha";
  const request = task?.compiledPrompt?.request;
  const presentation = {
    view: "side",
    revisionId: front.id,
    orientation: front.orientation,
  };
  const same = isDeepStrictEqual;
  const sourceIds = [source?.id, raw?.id, mask?.id];
  if (
    !asset ||
    !source ||
    !raw ||
    !mask ||
    !processing ||
    !["masked-edit", "material-alpha"].includes(processing.kind) ||
    !(correction
      ? [
          "masked-provider-rgb-preserve-alpha-v1",
          "masked-provider-rgb-interior-v2",
        ].includes(processing.algorithm)
      : processing.algorithm === "green-dominance-original-rgb-v1") ||
    (processing.algorithm === "masked-provider-rgb-interior-v2" &&
      (processing.alphaThreshold !== 240 || processing.interiorRadius !== 2)) ||
    asset.generationTaskId !== null ||
    asset.parentAssetId !== raw.id ||
    new Set([asset.id, ...sourceIds]).size !== 4 ||
    [asset, source, raw, mask].some(
      (value) =>
        value.projectId !== asset.projectId ||
        value.archivedAt ||
        !value.url?.startsWith("s3://"),
    ) ||
    !asset.rootAssetId ||
    raw.rootAssetId !== asset.rootAssetId ||
    source.rootAssetId !== asset.rootAssetId ||
    step?.projectId !== asset.projectId ||
    step.outputAssetId !== asset.id ||
    step.generationTaskId !== null ||
    step.actor !== "wardrobe" ||
    step.tool !== expectedTool ||
    step.inputSnapshot.parameters.reviewRequired !== "true" ||
    !same(
      step.inputSnapshot.sources?.map((entry) => entry.assetId),
      sourceIds,
    ) ||
    processing.sourceAssetId !== source.id ||
    processing.rawAssetId !== raw.id ||
    processing.maskAssetId !== mask.id ||
    !same(processing, prepared?.materialProcessing) ||
    !same(processing, receipt?.preparation?.materialProcessing) ||
    Object.entries(hashes).some(
      ([key, value]) => !value || processing[key] !== value,
    ) ||
    Object.keys(hashes).length !== 4 ||
    hashes.derivedSha256 !== fileHash ||
    hashes.sourceSha256 !== sourceFileHash ||
    hashes.rawSha256 !== rawFileHash ||
    receipt?.asset?.id !== asset.id ||
    receipt.asset.parentAssetId !== raw.id ||
    receipt.asset.rootAssetId !== asset.rootAssetId ||
    receipt.asset.generationTaskId !== null ||
    receipt.input?.sourceAssetId !== source.id ||
    receipt.input.rawAssetId !== raw.id ||
    receipt.input.maskAssetId !== mask.id ||
    (receipt.input.operation ?? "transparency") !==
      (correction ? "correction" : "transparency") ||
    !preparation ||
    preparation.id !== prepared.id ||
    preparation.id !== receipt.preparation.id ||
    preparation.projectId !== asset.projectId ||
    preparation.ready !== true ||
    preparation.taskId !== null ||
    preparation.error ||
    prepared.status !== "ready" ||
    prepared.taskId !== null ||
    prepared.sourceAssetId !== asset.id ||
    prepared.frontAssetId !== front.assetId ||
    prepared.category !== front.category ||
    !same(prepared.presentation, presentation) ||
    !prepared.candidates?.some((candidate) => candidate.assetId === asset.id) ||
    preparation.input?.mode !== "existing" ||
    preparation.input.sourceKind !== "isolated" ||
    preparation.input.sourceAssetId !== asset.id ||
    preparation.input.category !== front.category ||
    preparation.input.region ||
    preparation.input.referenceAssetIds?.length ||
    !same(preparation.input.presentation, presentation) ||
    !sourcePreparation ||
    sourcePreparation.id !== receipt.input.sidePreparationId ||
    sourcePreparation.id !== prepared.materialSourcePreparationId ||
    sourcePreparation.projectId !== asset.projectId ||
    sourcePreparation.error ||
    sourcePreparation.input?.category !== front.category ||
    !same(sourcePreparation.input.presentation, presentation) ||
    (sourcePreparation.input.mode === "existing"
      ? sourcePreparation.ready !== true ||
        sourcePreparation.taskId !== null ||
        sourcePreparation.input.sourceAssetId !== source.id
      : !source.generationTaskId ||
        sourcePreparation.taskId !== source.generationTaskId) ||
    !task ||
    task.projectId !== asset.projectId ||
    task.status !== "SUCCEEDED" ||
    task.taskType !== "inpaint" ||
    raw.generationTaskId !== task.id ||
    raw.parentAssetId !== source.id ||
    task.parentAssetId !== source.id ||
    request?.referenceImageUrl !== source.url ||
    request.referenceImageUrls?.[0] !== source.url ||
    request.maskImageUrl !== mask.url ||
    Boolean(
      task.compiledPrompt?.notes?.includes(
        "wardrobe-masked-correction-probe:v1",
      ),
    ) !== correction ||
    wire?.referenceImages?.[0]?.sha256 !== hashes.sourceSha256 ||
    wire.maskImage?.sha256 !== hashes.maskSha256
  )
    throw new Error(
      "派生侧图真实准备、三源四SHA、DesignStep、成功raw任务或冻结正面不一致",
    );
  return processing;
}

export function assertNativeSideHop({
  asset,
  parent,
  task,
  prepared,
  front,
  actualHash,
  fileHash,
  parentHash,
  wire,
  preparation,
}) {
  if (
    !asset ||
    !parent ||
    !task ||
    task.status !== "SUCCEEDED" ||
    asset.generationTaskId !== task.id ||
    asset.parentAssetId !== parent.id ||
    task.parentAssetId !== parent.id ||
    asset.projectId !== parent.projectId ||
    task.projectId !== asset.projectId ||
    asset.rootAssetId !== parent.rootAssetId ||
    asset.archivedAt ||
    parent.archivedAt ||
    prepared.sourceAssetId !== parent.id ||
    actualHash !== fileHash ||
    wire?.referenceImages?.[0]?.sha256 !== parentHash ||
    (prepared.sourceLineage && prepared.sourceLineage.sha256 !== parentHash) ||
    prepared.presentation?.revisionId !== front.id ||
    prepared.category !== front.category ||
    prepared.presentation.orientation !== front.orientation ||
    (prepared.frontAssetId ??
      (parent.id === front.assetId ? parent.id : undefined)) !== front.assetId
  )
    throw new Error("native侧图递归血缘、源像素或冻结正面绑定不一致");
  if (prepared.externalInpaint) {
    if (
      task.taskType !== "inpaint" ||
      task.compiledPrompt?.request?.referenceImageUrl !== parent.url
    )
      throw new Error("native父图没有对应真实INPAINT来源");
  } else if (prepared.externalSideCutout) {
    const nativeBinding = prepared.nativeInputPreparation;
    if (
      task.taskType !== "i2i" ||
      !preparation ||
      preparation.id !== prepared.cutoutPreparationId ||
      preparation.taskId !== task.id ||
      preparation.input?.mode !== "extract" ||
      preparation.input.sourceKind !== "isolated" ||
      preparation.input.sourceAssetId !== parent.id ||
      preparation.input.category !== front.category ||
      preparation.input.presentation ||
      preparation.input.region ||
      preparation.input.referenceAssetIds?.length ||
      !nativeBinding?.externalInpaint ||
      nativeBinding.taskId !== parent.generationTaskId ||
      nativeBinding.frontAssetId !== front.assetId ||
      nativeBinding.presentation?.revisionId !== front.id ||
      nativeBinding.presentation.orientation !== front.orientation ||
      nativeBinding.category !== front.category
    )
      throw new Error(
        "去背景父图必须有真实普通extract准备及原native侧图绑定，不能伪装INPAINT",
      );
  } else if (
    !preparation ||
    preparation.taskId !== task.id ||
    preparation.input?.presentation?.revisionId !== front.id ||
    preparation.input.presentation.orientation !== front.orientation ||
    preparation.input.category !== front.category
  )
    throw new Error("原侧图没有真实WardrobePreparation绑定，禁止伪造记录");
}

/** Register a real native-inpaint side only against its frozen confirmed front. */
export function sideInpaintRegistration(
  prepared,
  front,
  assetId,
  requestKey,
  originalPreparation,
) {
  if (prepared.processingProbe || prepared.mask?.processingProbe)
    throw new Error("处理探针不得登记为侧图成品");
  if (
    !(
      prepared.externalInpaint ||
      (originalPreparation &&
        originalPreparation.id === prepared.id &&
        originalPreparation.task?.status === "SUCCEEDED" &&
        originalPreparation.task.id === prepared.taskId &&
        !originalPreparation.error &&
        originalPreparation.taskId === prepared.taskId &&
        originalPreparation.input?.sourceAssetId === front.assetId &&
        originalPreparation.input.category === front.category &&
        originalPreparation.input.presentation?.revisionId === front.id &&
        originalPreparation.input.presentation.orientation ===
          prepared.presentation?.orientation) ||
      (prepared.externalSideCutout &&
        prepared.cutoutPreparationId &&
        prepared.taskId)
    ) ||
    !assetId ||
    assetId === front.assetId ||
    (prepared.frontAssetId ??
      (originalPreparation ? prepared.sourceAssetId : undefined)) !==
      front.assetId ||
    prepared.category !== front.category ||
    prepared.presentation?.revisionId !== front.id ||
    prepared.presentation.view !== "side" ||
    !["left", "right"].includes(prepared.presentation.orientation)
  )
    throw new Error("原生侧图修正必须登记到冻结的同类别正面修订");
  return {
    requestKey,
    sourceAssetId: assetId,
    name: prepared.name,
    category: prepared.category,
    sourceKind: "isolated",
    mode: "existing",
    referenceAssetIds: [],
    presentation: {
      view: "side",
      revisionId: front.id,
      orientation: prepared.presentation.orientation,
    },
  };
}

export function ensureSideFront(manifest, canonical, id, sourceAssetId) {
  const existing = manifest.items.find((item) => item.id === id);
  const existingMatches =
    existing?.provenance?.assetId === sourceAssetId &&
    existing.reviewedForDisplay;
  const front = canonical?.items?.find(
    (item) =>
      item.id === id &&
      item.provenance?.assetId === sourceAssetId &&
      item.reviewedForDisplay,
  );
  if (!front && existingMatches) return existing;
  if (!front) throw new Error("侧图缺少与实际输入资产一致的已确认正面manifest");
  const copy = structuredClone(front);
  if (existingMatches && existing.sideDisplay)
    copy.sideDisplay = structuredClone(existing.sideDisplay);
  manifest.items = [...manifest.items.filter((item) => item.id !== id), copy];
  return copy;
}
