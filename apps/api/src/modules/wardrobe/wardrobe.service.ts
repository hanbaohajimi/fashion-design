import {
  DesignAssetOperation,
  Prisma,
  type PrismaClient,
  type WardrobeItem,
  type WardrobeRevision,
  type WardrobePreparation,
  type WardrobeOutfit,
  type WardrobeOutfitSnapshot,
  type WardrobeTryOn,
} from "@fashion/db";
import {
  wardrobePrepareSchema,
  wardrobeMaterialProbeSchema,
  wardrobeMaterialMaskSchema,
  wardrobeMaterialAlphaSchema,
  wardrobeConfirmSchema,
  wardrobeArchiveSchema,
  wardrobePresentationSchema,
  outfitSaveSchema,
  outfitReferenceSchema,
  outfitTryOnSchema,
  outfitTrialSchema,
  type WardrobeSummary,
  type WardrobeImageBounds,
  type WardrobeDisplay,
  type WardrobeRevisionView,
  type WardrobeItemView,
  type WardrobePreparationView,
  type OutfitSnapshotView,
  type OutfitSnapshotItem,
  type OutfitView,
  type WardrobeTryOnView,
  type WardrobeMaterialProcessing,
  type WardrobePrepareInput,
} from "@fashion/shared";
import {
  deriveMaterialAlpha,
  deriveMaskedProviderRgbInterior,
  inspectMaskedRgbInterior,
  MATERIAL_ALPHA_ALGORITHM,
  MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM,
  MASKED_RGB_ALPHA_THRESHOLD,
  MASKED_RGB_INTERIOR_RADIUS,
} from "@fashion/ai";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { z } from "zod";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { GenerationService } from "../generation/generation.service";
import {
  assertTransparentGarment,
  composeOutfitReference,
  cropWardrobeImage,
  readWardrobeImage,
  createCorrectionSelectionGuide,
  CORRECTION_GUIDE_ALGORITHM,
  OUTFIT_REFERENCE_LAYOUT,
} from "./wardrobe-media";
import {
  assertOutfitItems,
  outfitPrompt,
  preparationPrompt,
  wardrobeCapabilities,
} from "./wardrobe.rules";

export const WARDROBE_DB = Symbol("WARDROBE_DB");
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assetUrl = (id: string) =>
  `/api/design-assets/${encodeURIComponent(id)}/content`;
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new BadRequestException("衣架来源或修订信息不完整");
  return value;
}
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message).join("；"),
    );
  return result.data;
}
type ItemRecord = WardrobeItem & { revisions: WardrobeRevision[] };
type OutfitRecord = WardrobeOutfit & { snapshots: WardrobeOutfitSnapshot[] };
type RevisionPayload = Pick<
  WardrobeRevisionView,
  | "name"
  | "category"
  | "display"
  | "anchor"
  | "imageBounds"
  | "presentation"
  | "reviewed"
  | "sourceKind"
  | "generatedCompletion"
  | "materialProcessing"
>;
type SnapshotPayload = {
  name: string;
  items: OutfitSnapshotItem[];
  prompt: string;
  layeringConfirmed: boolean;
};

@Injectable()
export class WardrobeService implements OnModuleInit, OnModuleDestroy {
  private readonly imageBoundsCache = new Map<
    string,
    Promise<WardrobeImageBounds>
  >();
  private recoveryTimer: ReturnType<typeof setInterval> | undefined;
  private recovering = false;
  constructor(
    @Inject(WARDROBE_DB) private readonly db: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
    @Inject(GenerationService) private readonly generation: GenerationService,
  ) {}

  onModuleInit() {
    this.recoveryTimer = setInterval(() => {
      void this.recoverPending();
    }, 15_000);
    this.recoveryTimer.unref();
  }
  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }
  async recoverPending(): Promise<void> {
    if (this.recovering || !wardrobeCapabilities().enabled) return;
    this.recovering = true;
    try {
      const [preparations, runs] = await Promise.all([
        this.db.wardrobePreparation.findMany({
          where: {
            taskId: null,
            ready: false,
            error: null,
            createdAt: { lt: new Date(Date.now() - 30_000) },
          },
          take: 10,
        }),
        this.db.wardrobeTryOn.findMany({
          where: {
            taskId: null,
            error: null,
            createdAt: { lt: new Date(Date.now() - 30_000) },
          },
          take: 10,
        }),
      ]);
      for (const item of preparations)
        await this.prepare(item.userId, item.projectId, item.input).catch(
          () => {},
        );
      for (const run of runs)
        await this.tryOn(run.userId, run.projectId, {
          requestKey: run.requestKey,
          snapshotId: run.snapshotId,
          modelAssetId: run.modelAssetId,
        }).catch(() => {});
    } catch {
      /* Durable rows remain pending when infrastructure cannot be read. */
    } finally {
      this.recovering = false;
    }
  }

  async summary(userId: string, projectId: string): Promise<WardrobeSummary> {
    const permission = await this.access.require(userId, projectId);
    const [items, preparations, outfits, runs] = await Promise.all([
      this.db.wardrobeItem.findMany({
        where: { projectId },
        include: { revisions: { orderBy: { version: "desc" } } },
        orderBy: { updatedAt: "desc" },
      }),
      this.db.wardrobePreparation.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.wardrobeOutfit.findMany({
        where: { projectId, isTrial: false },
        include: { snapshots: { orderBy: { version: "desc" } } },
        orderBy: { updatedAt: "desc" },
      }),
      this.db.wardrobeTryOn.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return {
      projectId,
      canEdit: permission.capabilities.edit && !permission.archived,
      capabilities: wardrobeCapabilities(),
      items: items.map((item) => this.itemView(item)),
      preparations: await Promise.all(
        preparations.map((item) => this.preparationView(item)),
      ),
      outfits: outfits.map((item) => this.outfitView(item)),
      tryOns: await Promise.all(runs.map((run) => this.tryOnView(run))),
    };
  }

  async prepare(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<WardrobePreparationView> {
    await this.edit(userId, projectId);
    const input = parse(wardrobePrepareSchema, body);
    let presentationDisplay: WardrobeDisplay | undefined;
    if (input.presentation) {
      const revision = await this.db.wardrobeRevision.findFirst({
        where: {
          id: input.presentation.revisionId,
          item: { projectId, archived: false },
        },
      });
      if (!revision) throw new NotFoundException("侧挂图对应的单品修订不存在");
      const front = this.revisionView(revision);
      presentationDisplay = front.display;
      await this.assets(projectId, [front.assetId]);
      if (input.category !== front.category || input.region)
        throw new BadRequestException(
          "侧挂展示图需沿用单品类别，以完整单品准备",
        );
      if (input.presentation.repairPreparationId) {
        if (
          input.mode !== "extract" ||
          input.sourceKind !== "isolated" ||
          input.referenceAssetIds.length
        )
          throw new BadRequestException(
            "侧挂修正只能以已有完整侧挂候选提取，不可附加参考或重新生成视角",
          );
        const original = await this.db.wardrobePreparation.findFirst({
          where: {
            id: input.presentation.repairPreparationId,
            projectId,
          },
        });
        if (!original)
          throw new NotFoundException("待修正的侧挂准备记录不存在");
        const originalInput = parse(wardrobePrepareSchema, original.input);
        const originalView = await this.preparationView(original);
        if (
          originalInput.presentation?.revisionId !== front.id ||
          originalInput.presentation.orientation !==
            input.presentation.orientation ||
          originalInput.category !== front.category ||
          originalView.status !== "ready" ||
          !originalView.candidates.some(
            (candidate) => candidate.assetId === input.sourceAssetId,
          ) ||
          input.sourceAssetId === front.assetId
        )
          throw new BadRequestException(
            "请选择当前单品修订及方向下已完成的侧挂候选进行修正",
          );
      } else if (input.mode === "extract") {
        throw new BadRequestException("侧挂修正必须指定原侧挂准备记录");
      }
      if (
        input.mode === "complete" &&
        (input.sourceAssetId !== front.assetId ||
          input.sourceKind !== "isolated")
      )
        throw new BadRequestException("侧挂候选必须以已确认的正面单品为来源");
      if (input.mode === "existing" && input.sourceAssetId === front.assetId)
        throw new BadRequestException(
          "请选择独立的侧挂展示图，不能将正面图当作侧挂图",
        );
    }
    if (input.mode !== "existing" && !wardrobeCapabilities().preparationEnabled)
      throw new ServiceUnavailableException("单品生成准备当前未启用");
    await this.assets(projectId, [
      input.sourceAssetId,
      ...input.referenceAssetIds,
    ]);
    if (input.styleRevisionId)
      await this.styleSource(
        projectId,
        input.styleRevisionId,
        input.sourceAssetId,
      );
    const row = await this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "prepare", input },
      async (tx) => {
        return tx.wardrobePreparation.create({
          data: {
            projectId,
            userId,
            requestKey: input.requestKey,
            fingerprint: digest(input),
            input: json(input),
          },
        });
      },
    );
    const preparation = await this.db.wardrobePreparation.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (preparation.taskId || preparation.error || preparation.ready)
      return this.preparationView(preparation);
    try {
      if (input.mode === "existing") {
        const [original] = await this.assets(projectId, [input.sourceAssetId]);
        await this.assertNotMaterialProbe(
          required(original).generationTaskId,
          input.sourceAssetId,
        );
      }
      const sourceId = input.region
        ? await this.cropSource(userId, projectId, preparation, input)
        : input.sourceAssetId;
      if (input.mode === "existing") {
        const [source] = await this.assets(projectId, [sourceId]);
        await this.assertNotMaterialProbe(
          required(source).generationTaskId,
          sourceId,
        );
        await assertTransparentGarment(
          await readWardrobeImage(this.storage, required(source).url),
        );
        await this.db.wardrobePreparation.update({
          where: { id: preparation.id },
          data: { ready: true, error: null },
        });
      } else {
        const task = await this.dispatch(
          userId,
          {
            projectId,
            sourceAssetIds: [sourceId, ...input.referenceAssetIds],
            prompt: preparationPrompt(input, presentationDisplay),
            transparent: true,
          },
          `wardrobe-prepare:${preparation.id}`,
        );
        await this.db.wardrobePreparation.update({
          where: { id: preparation.id },
          data: { taskId: task.taskId, error: null },
        });
      }
    } catch (error) {
      await this.db.wardrobePreparation.updateMany({
        where: { id: preparation.id, taskId: null, ready: false },
        data: {
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "单品准备失败",
        },
      });
    }
    return this.preparationView(
      await this.db.wardrobePreparation.findUniqueOrThrow({
        where: { id: preparation.id },
      }),
    );
  }

  /** Persist the user's selected region without thumbnail or visual-analysis jobs. */
  async registerMaterialMask(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<{ assetId: string; url: string }> {
    await this.edit(userId, projectId);
    const input = parse(wardrobeMaterialMaskSchema, body);
    const source = required(
      (await this.assets(projectId, [input.sourceAssetId]))[0],
    );
    const id = digest({
      projectId,
      sourceAssetId: source.id,
      sha256: input.sha256,
      tool: "wardrobe-material-mask",
    });
    const existing = await this.db.designAsset.findFirst({
      where: { id, projectId, archivedAt: null, parentAssetId: source.id },
    });
    if (existing) {
      await this.mutate(
        userId,
        projectId,
        `material-mask-intent:${input.requestKey}`,
        { action: "material-mask-intent", input },
        async () => ({ accepted: true }),
      );
      return { assetId: id, url: assetUrl(id) };
    }
    // Never accept an arbitrary URL/key: this is the same actor namespace used
    // by GenerationMaskService.sign. Permanent bytes use a different key.
    const temporaryUrl = `s3://temporary/masks/${userId}/${input.maskId}.png`;
    const [sourceBytes, maskBytes] = await Promise.all([
      readWardrobeImage(this.storage, source.url),
      readWardrobeImage(this.storage, temporaryUrl),
    ]);
    if (createHash("sha256").update(maskBytes).digest("hex") !== input.sha256)
      throw new BadRequestException("选择区域的文件摘要不一致，请重新上传");
    await this.validateMaterialMask(sourceBytes, maskBytes);
    await this.mutate(
      userId,
      projectId,
      `material-mask-intent:${input.requestKey}`,
      { action: "material-mask-intent", input },
      async () => ({ accepted: true }),
    );
    await this.storeDerived(
      userId,
      projectId,
      id,
      maskBytes,
      source.id,
      "wardrobe-material-mask",
      [source.id],
      {
        maskId: input.maskId,
        sha256: input.sha256,
        selectionSource: "user-painted",
      },
    );
    return { assetId: id, url: assetUrl(id) };
  }

  /** Paid only on this explicit request; the returned image is an intermediate, not a garment. */
  async createMaterialProbe(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<{ taskId: string }> {
    const permission = await this.edit(userId, projectId);
    if (!wardrobeCapabilities().preparationEnabled)
      throw new ServiceUnavailableException("单品生成准备当前未启用");
    const input = parse(wardrobeMaterialProbeSchema, body);
    const operation = input.operation ?? "transparency";
    const [source, mask] = await this.assets(projectId, [
      input.sourceAssetId,
      input.maskAssetId,
    ]);
    const sourceAsset = required(source);
    const maskAsset = required(mask);
    const [sourceBytes, maskBytes] = await Promise.all([
      readWardrobeImage(this.storage, sourceAsset.url),
      readWardrobeImage(this.storage, maskAsset.url),
    ]);
    const dimensions = await this.validateMaterialMask(
      sourceBytes,
      maskBytes,
      operation,
    );
    await this.mutate(
      userId,
      projectId,
      `material-probe-intent:${input.requestKey}`,
      { action: "material-probe-intent", input },
      async () => ({ accepted: true }),
    );
    const key = `wardrobe-material-probe:${input.requestKey}`;
    const taskId = createHash("sha256")
      .update(
        `${permission.ownerId}\0${userId === permission.ownerId ? key : `${userId}:${key}`}`,
      )
      .digest("hex");
    const existing = await this.db.generationTask.findFirst({
      where: { id: taskId, projectId },
    });
    if (existing) {
      const compiled = existing.compiledPrompt as {
        notes?: string[];
        request?: { referenceImageUrl?: string; maskImageUrl?: string };
      } | null;
      if (
        existing.parentAssetId !== sourceAsset.id ||
        compiled?.request?.referenceImageUrl !== sourceAsset.url ||
        compiled.request.maskImageUrl !== maskAsset.url ||
        !compiled.notes?.includes("wardrobe-material-alpha-probe:v1") ||
        compiled.notes.includes("wardrobe-masked-correction-probe:v1") !==
          (operation === "correction")
      )
        throw new ConflictException("请求键对应另一真实素材处理任务");
      if (existing.status === "QUEUED")
        await this.generation.resumeQueuedTask(userId, existing.id);
      return { taskId: existing.id };
    }
    const referenceAssets = [sourceAsset];
    let guideId: string | undefined;
    if (operation === "correction") {
      const guide = await createCorrectionSelectionGuide(
        sourceBytes,
        maskBytes,
      );
      const hash = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      guideId = digest({
        tool: "wardrobe-correction-guide",
        projectId,
        sourceAssetId: sourceAsset.id,
        maskAssetId: maskAsset.id,
        algorithm: guide.algorithm,
        sourceSha256: hash(sourceBytes),
        maskSha256: hash(maskBytes),
      });
      await this.storeDerived(
        userId,
        projectId,
        guideId,
        guide.bytes,
        sourceAsset.id,
        "wardrobe-correction-guide",
        [sourceAsset.id, maskAsset.id],
        {
          algorithm: guide.algorithm,
          opacity: String(guide.opacity),
          color: guide.color,
          sourceSha256: hash(sourceBytes),
          maskSha256: hash(maskBytes),
          guideSha256: hash(guide.bytes),
          stats: JSON.stringify(guide.stats),
          referenceOnly: "true",
        },
      );
      referenceAssets.push(
        required((await this.assets(projectId, [guideId]))[0]),
      );
    }
    if (input.detailRegion) {
      const detailId = digest({
        tool: "wardrobe-material-detail",
        projectId,
        sourceAssetId: sourceAsset.id,
        region: input.detailRegion,
      });
      await this.storeDerived(
        userId,
        projectId,
        detailId,
        await cropWardrobeImage(sourceBytes, input.detailRegion),
        sourceAsset.id,
        "wardrobe-material-detail",
        [sourceAsset.id],
        { region: JSON.stringify(input.detailRegion) },
      );
      referenceAssets.push(
        required((await this.assets(projectId, [detailId]))[0]),
      );
    }
    const prompt =
      operation === "correction"
        ? [
            `局部修正服装内部细节或织纹。单品：${input.name}；类别：${input.category}。`,
            "第一张完整单品是唯一款式、位置、几何和材质依据。第二张是同一原图叠加品红选区的位置指引，原尺寸原构图，品红仅代表允许编辑的位置与权重，不是服装颜色、印花、缝线或新设计。若有第三张，它仅是同源原像素细节。",
            "严格将用户要求的修改放在第二图标示的区域内，同时遵守第一图对应的真实蒙版。不要复制品红叠色、边框或任何标记到输出，不要从指引推断新结构线；未标示区域不修改。",
            "只按用户明确说明修正蒙版透明区域内已有服装的内部RGB细节。不要改变外轮廓、画布、衣物位置、透明区域、领肩袖口或蒙版外内容，不生成新身体部件或未知设计。",
            "不要把颜色修正变成全图重绘，不增加文字、标记、棋盘格或绿色抠像底。原图alpha和受保护RGBA由后续确定性处理保留；本任务不能扩大、补长、移动服装轮廓。",
            "输出为待处理的局部修正中间PNG，仍需和原图比对并人工核对。",
            input.notes,
          ].join("\n")
        : [
            `局部修复浅色蕾丝或网纱的透射信息。单品：${input.name}；类别：${input.category}。`,
            "第一张完整单品是唯一款式与几何依据；若有第二张，它只来自同一原图的原像素细节，指导原有连续细网结构。",
            "仅修改蒙版透明区域。在所有花瓣、花茎之间保留覆盖完整袖面的连续细密网纱；每根网丝彼此相连，不能形成缺网的大洞。",
            "只把细网丝之间真正的微小孔隙设为均匀纯绿色 RGB(0,255,0)。网丝、花瓣、花茎保留原色和原有像素位置，不涂绿、不减少、不重画花纹。",
            "只有网孔后方确实露出空背景时才设绿色；若薄纱后面重叠着实体衣身、内衬或其他衣片，保留后方实体的遮挡，不能透穿整件服装。侧挂袖子覆盖衣身的部分不等于露空的袖网。",
            "实体内衬、领口、袖口、衣身与所有蒙版外内容不变。保留轮廓、自然垂坠、大小、位置和画布尺寸。",
            "输出为处理中间图的 opaque PNG；图像中不要添加标签、文字、图例、水印、棋盘格、背景渐变或光晕。",
            input.notes,
          ]
            .filter(Boolean)
            .join("\n");
    return this.generation.createFromAgent(
      userId,
      {
        projectId,
        parentAssetId: sourceAsset.id,
        taskType: "inpaint",
        prompt,
        referenceImageUrl: sourceAsset.url,
        referenceImageUrls: referenceAssets.map((asset) => asset.url),
        maskImageUrl: maskAsset.url,
        width: dimensions.width,
        height: dimensions.height,
        background: "opaque",
        outputFormat: "png",
        quality: "high",
      },
      `wardrobe-material-probe:${input.requestKey}`,
      prompt,
      {
        version: 1,
        mode: "board_guided",
        positivePrompt: prompt,
        negativePrompt: "",
        sources: [
          ...referenceAssets.map((asset, index) => ({
            assetId: asset.id,
            elementId: asset.id,
            role: index ? "detail_ref" : "edit_source",
            title:
              asset.id === guideId
                ? "编辑位置指引（非服装设计或材质）"
                : index
                  ? operation === "correction"
                    ? "原图细节"
                    : "原图网纱细节"
                  : "待修复单品",
          })),
          {
            assetId: maskAsset.id,
            elementId: maskAsset.id,
            role: "edit_mask",
            title:
              operation === "correction"
                ? "用户选定的细节区域"
                : "用户选定的透射区域",
          },
        ],
        notes: [
          "wardrobe-material-alpha-probe:v1",
          ...(operation === "correction"
            ? [
                "wardrobe-masked-correction-probe:v1",
                `wardrobe-correction-guide:${CORRECTION_GUIDE_ALGORITHM}`,
              ]
            : []),
          "处理中间素材不能直接确认为衣架单品；确定性处理后仍须人工核对。",
        ],
        palette: [],
        paletteReferences: [],
        styleReferences: [],
        silhouetteReferences: [],
        fabricReferences: [],
        fabricInputs: [],
        patternReferences: [],
        detailReferences: [],
        enhancement: "keywords",
        avoidLabels: [],
      },
    );
  }

  /** Deterministic processing, no provider request. Raw outputs and all source bytes remain intact. */
  async deriveMaterialCandidate(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<WardrobePreparationView> {
    await this.edit(userId, projectId);
    const input = parse(wardrobeMaterialAlphaSchema, body);
    const operation = input.operation ?? "transparency";
    const [source, raw, mask] = await this.assets(projectId, [
      input.sourceAssetId,
      input.rawAssetId,
      input.maskAssetId,
    ]);
    const original = required(source);
    const probe = required(raw);
    const selection = required(mask);
    let presentation: WardrobePrepareInput["presentation"];
    if (input.sidePreparationId) {
      const side = await this.db.wardrobePreparation.findFirst({
        where: { id: input.sidePreparationId, projectId },
      });
      if (!side) throw new NotFoundException("透明修复对应的侧挂准备不存在");
      const sideInput = parse(wardrobePrepareSchema, side.input);
      const sideView = await this.preparationView(side);
      if (
        !sideInput.presentation ||
        sideInput.category !== input.category ||
        sideView.status !== "ready" ||
        !sideView.candidates.some(
          (candidate) => candidate.assetId === original.id,
        )
      )
        throw new BadRequestException(
          "请选择同类别已完成的侧挂候选修复透明材质",
        );
      const revision = await this.db.wardrobeRevision.findFirst({
        where: {
          id: sideInput.presentation.revisionId,
          item: { projectId, archived: false },
        },
      });
      if (!revision)
        throw new NotFoundException("侧挂修复对应的单品修订不存在");
      const front = this.revisionView(revision);
      if (front.category !== input.category || front.assetId === original.id)
        throw new BadRequestException(
          "侧挂透明修复不能使用正面图或更改单品类别",
        );
      await this.assets(projectId, [front.assetId]);
      presentation = {
        view: "side",
        revisionId: revision.id,
        orientation: sideInput.presentation.orientation,
      };
    }
    const task = probe.generationTaskId
      ? await this.db.generationTask.findFirst({
          where: {
            id: probe.generationTaskId,
            projectId,
            status: "SUCCEEDED",
            taskType: "inpaint",
            parentAssetId: original.id,
          },
        })
      : null;
    const frozen = task?.compiledPrompt as {
      notes?: string[];
      request?: {
        referenceImageUrl?: string;
        referenceImageUrls?: string[];
        maskImageUrl?: string;
      };
    } | null;
    if (
      !task ||
      probe.parentAssetId !== original.id ||
      frozen?.request?.referenceImageUrl !== original.url ||
      frozen.request.referenceImageUrls?.[0] !== original.url ||
      frozen.request.maskImageUrl !== selection.url
    )
      throw new BadRequestException(
        "素材修复必须对应已完成局部编辑的真实原图、首张参考和蒙版",
      );
    const correctionProbe =
      frozen?.notes?.includes("wardrobe-masked-correction-probe:v1") === true;
    if ((operation === "correction") !== correctionProbe)
      throw new BadRequestException(
        "处理方式与真实中间任务不一致，请使用对应的修正或透明候选",
      );
    // Algorithm upgrades never rewrite a completed request's historical asset.
    const previous = await this.db.wardrobePreparation.findUnique({
      where: {
        projectId_userId_requestKey: {
          projectId,
          userId,
          requestKey: input.requestKey,
        },
      },
    });
    if (previous) {
      await this.mutate(
        userId,
        projectId,
        `material-alpha-intent:${input.requestKey}`,
        { action: "material-alpha-intent", input },
        async () => ({ accepted: true }),
      );
      const oldInput = parse(wardrobePrepareSchema, previous.input);
      await this.assets(projectId, [oldInput.sourceAssetId]);
      const oldProcessing = await this.materialProcessing(
        oldInput.sourceAssetId,
      );
      if (
        oldInput.mode !== "existing" ||
        !oldProcessing ||
        oldProcessing.sourceAssetId !== original.id ||
        oldProcessing.rawAssetId !== probe.id ||
        oldProcessing.maskAssetId !== selection.id ||
        oldProcessing.kind !==
          (operation === "correction" ? "masked-edit" : "material-alpha")
      )
        throw new ConflictException("请求键对应另一素材准备，请使用新的请求键");
      return this.preparationView(previous);
    }
    const [sourceBytes, rawBytes, maskBytes] = await Promise.all([
      readWardrobeImage(this.storage, original.url),
      readWardrobeImage(this.storage, probe.url),
      readWardrobeImage(this.storage, selection.url),
    ]);
    await this.validateMaterialMask(sourceBytes, maskBytes, operation);
    const decoded = await Promise.all(
      [sourceBytes, rawBytes, maskBytes].map(async (bytes) => {
        const { data, info } = await sharp(bytes, {
          limitInputPixels: 4_194_304,
        })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        return { data, width: info.width, height: info.height };
      }),
    );
    let derived:
      | ReturnType<typeof deriveMaterialAlpha>
      | ReturnType<typeof deriveMaskedProviderRgbInterior>;
    try {
      derived = (
        operation === "correction"
          ? deriveMaskedProviderRgbInterior
          : deriveMaterialAlpha
      )({
        source: required(decoded[0]),
        probe: required(decoded[1]),
        mask: required(decoded[2]),
      });
    } catch {
      throw new BadRequestException("原图、中间图与选择区域的像素尺寸必须一致");
    }
    if (
      !("changedRgbPixels" in derived.stats
        ? derived.stats.changedRgbPixels
        : derived.stats.changedAlphaPixels)
    )
      throw new BadRequestException(
        operation === "correction"
          ? "此候选未在可见选区产生RGB修正，请保留原图并重新准备"
          : "此候选未产生可用的透射信息，请保留原图并重新准备",
      );
    const bytes = await sharp(Buffer.from(derived.data), {
      raw: { width: derived.width, height: derived.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const sha = (value: Buffer) =>
      createHash("sha256").update(value).digest("hex");
    const processing: WardrobeMaterialProcessing = {
      ...(operation === "correction"
        ? {
            kind: "masked-edit" as const,
            algorithm: MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM,
            alphaThreshold: MASKED_RGB_ALPHA_THRESHOLD,
            interiorRadius: MASKED_RGB_INTERIOR_RADIUS,
          }
        : {
            kind: "material-alpha" as const,
            algorithm: MATERIAL_ALPHA_ALGORITHM,
          }),
      sourceAssetId: original.id,
      rawAssetId: probe.id,
      maskAssetId: selection.id,
      sourceSha256: sha(sourceBytes),
      rawSha256: sha(rawBytes),
      maskSha256: sha(maskBytes),
      derivedSha256: sha(bytes),
    };
    // Reserve the semantic request before storing an asset. A conflicting reuse
    // cannot leave an extra image behind, even when two requests race.
    await this.mutate(
      userId,
      projectId,
      `material-alpha-intent:${input.requestKey}`,
      { action: "material-alpha-intent", input },
      async () => ({ accepted: true }),
    );
    const id = digest({ projectId, processing });
    await this.storeDerived(
      userId,
      projectId,
      id,
      bytes,
      probe.id,
      operation === "correction"
        ? "wardrobe-masked-edit"
        : "wardrobe-material-alpha",
      [original.id, probe.id, selection.id],
      {
        processing: JSON.stringify(processing),
        stats: JSON.stringify(derived.stats),
        reviewRequired: "true",
      },
    );
    return this.prepare(userId, projectId, {
      requestKey: input.requestKey,
      sourceAssetId: id,
      name: input.name,
      category: input.category,
      sourceKind: "isolated",
      mode: "existing",
      referenceAssetIds: [],
      notes:
        operation === "correction"
          ? "局部细节修正候选；原图全部alpha、半透明边缘、2像素轮廓保护带及选区外RGBA保留，仅处理不透明面料内部；模型中间图分别保留，尚需细节比对及人工确认。"
          : "透明材质修复候选；原图与模型中间图分别保留，尚需三底核对及人工确认。",
      ...(presentation ? { presentation } : {}),
    });
  }

  private async validateMaterialMask(
    source: Buffer,
    mask: Buffer,
    operation?: "transparency" | "correction",
  ) {
    const bounds = await assertTransparentGarment(source);
    const metadata = await sharp(mask, {
      limitInputPixels: 4_194_304,
    }).metadata();
    if (
      bounds.width * bounds.height > 4_194_304 ||
      mask.length >= 4 * 1024 * 1024 ||
      metadata.format !== "png" ||
      !metadata.hasAlpha ||
      metadata.width !== bounds.width ||
      metadata.height !== bounds.height
    )
      throw new BadRequestException(
        "透明修复需同尺寸 PNG 选择区域，小于 4 MB，原图不超过 400 万像素",
      );
    const alpha = await sharp(mask).extractChannel("alpha").raw().toBuffer();
    if (
      !alpha.some((value) => value === 0) ||
      !alpha.some((value) => value === 255)
    )
      throw new BadRequestException("请同时保留需要修复的区域和受保护区域");
    const rgba = await sharp(source).ensureAlpha().raw().toBuffer();
    if (operation === "correction") {
      const maskRgba = await sharp(mask).ensureAlpha().raw().toBuffer();
      const { stats } = inspectMaskedRgbInterior({
        source: { width: bounds.width, height: bounds.height, data: rgba },
        mask: { width: bounds.width, height: bounds.height, data: maskRgba },
      });
      if (!stats.editablePixels)
        throw new BadRequestException(
          "所选区域没有可修正的衣料内部像素；半透明边缘及2像素轮廓保护带不会编辑",
        );
    }
    for (
      let pixel = 0;
      operation === "transparency" && pixel < alpha.length;
      pixel++
    ) {
      const offset = pixel * 4;
      if (
        required(alpha[pixel]) < 255 &&
        required(rgba[offset + 3]) > 16 &&
        required(rgba[offset + 1]) >
          Math.max(required(rgba[offset]), required(rgba[offset + 2])) + 16
      )
        throw new BadRequestException(
          "当前透明修复适用于浅色蕾丝或网纱；所选区域含绿色织物，请改用普通候选修正",
        );
    }
    return bounds;
  }

  private async materialProcessing(
    assetId: string,
  ): Promise<WardrobeMaterialProcessing | undefined> {
    const step = await this.db.designStep.findUnique({
      where: { outputAssetId: assetId },
    });
    if (
      !step ||
      !["wardrobe-material-alpha", "wardrobe-masked-edit"].includes(step.tool)
    )
      return undefined;
    const snapshot = step.inputSnapshot as {
      parameters?: { processing?: string };
    };
    if (!snapshot.parameters?.processing) return undefined;
    return JSON.parse(
      snapshot.parameters.processing,
    ) as WardrobeMaterialProcessing;
  }

  private async assertNotMaterialProbe(
    taskId: string | null,
    assetId?: string,
  ): Promise<void> {
    if (
      assetId &&
      (await this.db.designStep.findFirst({
        where: { outputAssetId: assetId, tool: "wardrobe-correction-guide" },
      }))
    )
      throw new BadRequestException(
        "编辑位置指引仅供生成参考，不能确认为衣架单品",
      );
    if (!taskId) return;
    const task = await this.db.generationTask.findUnique({
      where: { id: taskId },
      select: { compiledPrompt: true },
    });
    const compiled = task?.compiledPrompt as { notes?: string[] } | null;
    if (compiled?.notes?.includes("wardrobe-material-alpha-probe:v1"))
      throw new BadRequestException(
        "透明修复中间图不能直接入架，请先完成候选处理并人工核对",
      );
  }

  async confirm(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<WardrobeItemView> {
    await this.edit(userId, projectId);
    const input = parse(wardrobeConfirmSchema, body);
    const preparation = await this.db.wardrobePreparation.findFirst({
      where: { id: input.preparationId, projectId },
    });
    if (!preparation) throw new NotFoundException("单品准备记录不存在");
    const candidate = await this.preparationView(preparation);
    if (
      candidate.status !== "ready" ||
      !candidate.candidates.some((item) => item.assetId === input.assetId)
    )
      throw new BadRequestException("请选择本次准备中已完成的真实候选");
    const [asset] = await this.assets(projectId, [input.assetId]);
    await this.assertNotMaterialProbe(
      required(asset).generationTaskId,
      input.assetId,
    );
    const imageBounds = await assertTransparentGarment(
      await readWardrobeImage(this.storage, required(asset).url),
    );
    const prepared = parse(wardrobePrepareSchema, preparation.input);
    if (prepared.presentation)
      throw new BadRequestException(
        "侧挂候选只能确认到原单品的展示修订，不能替换试穿正面图",
      );
    await this.assets(projectId, [prepared.sourceAssetId]);
    if (prepared.styleRevisionId)
      await this.styleSource(
        projectId,
        prepared.styleRevisionId,
        prepared.sourceAssetId,
      );
    const generatedCompletion =
      prepared.mode === "complete" ||
      (await this.hasCompletionSource(projectId, prepared.sourceAssetId));
    const materialProcessing = await this.materialProcessing(input.assetId);
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "confirm", input },
      async (tx) => {
        let item: WardrobeItem;
        if (input.itemId) {
          if (!input.expectedVersion)
            throw new BadRequestException("修订单品需要当前版本号");
          const changed = await tx.wardrobeItem.updateMany({
            where: {
              id: input.itemId,
              projectId,
              version: input.expectedVersion,
            },
            data: { version: { increment: 1 }, name: input.name },
          });
          if (!changed.count)
            throw new ConflictException("单品已被修改，请刷新后重试");
          item = await tx.wardrobeItem.findUniqueOrThrow({
            where: { id: input.itemId },
          });
        } else
          item = await tx.wardrobeItem.create({
            data: { projectId, name: input.name },
          });
        await tx.wardrobeRevision.create({
          data: {
            itemId: item.id,
            version: item.version,
            sourceAssetId: prepared.sourceAssetId,
            assetId: input.assetId,
            styleRevisionId: prepared.styleRevisionId ?? null,
            payload: json({
              name: input.name,
              category: input.category,
              display: input.display,
              anchor: input.anchor,
              imageBounds,
              reviewed: true,
              sourceKind: prepared.sourceKind,
              generatedCompletion,
              ...(materialProcessing ? { materialProcessing } : {}),
            } satisfies RevisionPayload),
          },
        });
        return this.itemView(
          await tx.wardrobeItem.findUniqueOrThrow({
            where: { id: item.id },
            include: { revisions: { orderBy: { version: "desc" } } },
          }),
        );
      },
    );
  }

  async updatePresentation(
    userId: string,
    projectId: string,
    itemId: string,
    body: unknown,
  ): Promise<WardrobeItemView> {
    await this.edit(userId, projectId);
    const input = parse(wardrobePresentationSchema, body);
    const base = await this.db.wardrobeRevision.findFirst({
      where: { id: input.revisionId, itemId, item: { projectId } },
    });
    if (!base) throw new NotFoundException("展示修订对应的单品不存在");
    const front = this.revisionView(base);
    await this.assets(projectId, [front.assetId, front.sourceAssetId]);
    const presentation = { ...front.presentation };
    if (input.supportWidthRatio !== undefined)
      presentation.supportWidthRatio = input.supportWidthRatio;
    if (input.shelfDepthRatio !== undefined)
      presentation.shelfDepthRatio = input.shelfDepthRatio;
    if (input.sideDisplay === null) delete presentation.sideDisplay;
    else if (input.sideDisplay) {
      const row = await this.db.wardrobePreparation.findFirst({
        where: { id: input.sideDisplay.preparationId, projectId },
      });
      if (!row) throw new NotFoundException("侧挂准备记录不存在");
      const prepared = parse(wardrobePrepareSchema, row.input);
      const candidate = await this.preparationView(row);
      if (
        prepared.presentation?.revisionId !== base.id ||
        prepared.category !== front.category
      )
        throw new BadRequestException("侧挂候选不属于当前单品修订");
      if (
        candidate.status !== "ready" ||
        !candidate.candidates.some(
          (asset) => asset.assetId === input.sideDisplay?.assetId,
        )
      )
        throw new BadRequestException("请选择已完成的侧挂候选并核对后确认");
      if (input.sideDisplay.assetId === front.assetId)
        throw new BadRequestException("侧挂展示素材不能与试穿正面图相同");
      const [asset] = await this.assets(projectId, [input.sideDisplay.assetId]);
      await this.assertNotMaterialProbe(
        required(asset).generationTaskId,
        input.sideDisplay.assetId,
      );
      const materialProcessing = await this.materialProcessing(
        required(asset).id,
      );
      presentation.sideDisplay = {
        assetId: input.sideDisplay.assetId,
        url: assetUrl(input.sideDisplay.assetId),
        imageBounds: await assertTransparentGarment(
          await readWardrobeImage(this.storage, required(asset).url),
        ),
        anchor: input.sideDisplay.anchor,
        orientation: prepared.presentation.orientation,
        source:
          prepared.mode !== "existing" ||
          required(asset).generationTaskId ||
          materialProcessing
            ? "generated"
            : "uploaded",
        preparationId: row.id,
        reviewed: true,
        ...(materialProcessing ? { materialProcessing } : {}),
      };
    }
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "presentation", itemId, input },
      async (tx) => {
        const current = await tx.wardrobeItem.findFirst({
          where: { id: itemId, projectId, archived: false },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        });
        if (!current || current.revisions[0]?.id !== base.id)
          throw new ConflictException("单品已更新，请重新核对当前修订");
        const changed = await tx.wardrobeItem.updateMany({
          where: {
            id: itemId,
            projectId,
            version: input.expectedVersion,
            archived: false,
          },
          data: { version: { increment: 1 } },
        });
        if (!changed.count)
          throw new ConflictException("单品已被修改，请刷新后重试");
        // Persist a new immutable display revision; the canonical front and original design remain unchanged.
        await tx.wardrobeRevision.create({
          data: {
            itemId,
            version: input.expectedVersion + 1,
            sourceAssetId: base.sourceAssetId,
            assetId: base.assetId,
            styleRevisionId: base.styleRevisionId,
            payload: json({
              ...(base.payload as unknown as RevisionPayload),
              ...(input.frontAnchor ? { anchor: input.frontAnchor } : {}),
              presentation,
            }),
          },
        });
        return this.itemView(
          await tx.wardrobeItem.findUniqueOrThrow({
            where: { id: itemId },
            include: { revisions: { orderBy: { version: "desc" } } },
          }),
        );
      },
    );
  }

  async getImageBounds(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<WardrobeImageBounds> {
    // Never let the pixel cache bypass current project permission or asset archival.
    await this.access.require(userId, projectId, "read");
    const [asset] = await this.assets(projectId, [assetId]);
    const cacheKey = `${projectId}:${assetId}`;
    const cached = this.imageBoundsCache.get(cacheKey);
    if (cached) return cached;
    const pending = readWardrobeImage(this.storage, required(asset).url).then(
      assertTransparentGarment,
    );
    if (this.imageBoundsCache.size >= 64) {
      const oldest = this.imageBoundsCache.keys().next().value;
      if (oldest) this.imageBoundsCache.delete(oldest);
    }
    this.imageBoundsCache.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.imageBoundsCache.get(cacheKey) === pending)
        this.imageBoundsCache.delete(cacheKey);
    });
    return pending;
  }

  async archive(
    userId: string,
    projectId: string,
    itemId: string,
    body: unknown,
  ): Promise<WardrobeItemView> {
    await this.edit(userId, projectId);
    const input = parse(wardrobeArchiveSchema, body);
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "archive", itemId, input },
      async (tx) => {
        const result = await tx.wardrobeItem.updateMany({
          where: { id: itemId, projectId, version: input.expectedVersion },
          data: { archived: input.archived, version: { increment: 1 } },
        });
        if (!result.count)
          throw new ConflictException("单品已被修改，请刷新后重试");
        return this.itemView(
          await tx.wardrobeItem.findUniqueOrThrow({
            where: { id: itemId },
            include: { revisions: { orderBy: { version: "desc" } } },
          }),
        );
      },
    );
  }

  async saveOutfit(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<OutfitView> {
    return this.saveOutfitVersion(userId, projectId, body);
  }

  async saveTrialSnapshot(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<OutfitSnapshotView> {
    const { baseSnapshotId, ...draft } = parse(outfitTrialSchema, body);
    const result = await this.saveOutfitVersion(userId, projectId, draft, {
      trial: true,
      ...(baseSnapshotId ? { baseSnapshotId } : {}),
    });
    return result.currentSnapshot;
  }

  private async saveOutfitVersion(
    userId: string,
    projectId: string,
    body: unknown,
    options: { trial?: boolean; baseSnapshotId?: string } = {},
  ): Promise<OutfitView> {
    await this.edit(userId, projectId);
    const input = parse(outfitSaveSchema, body);
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      {
        action: options.trial ? "trial-snapshot" : "outfit",
        input,
        ...(options.baseSnapshotId
          ? { baseSnapshotId: options.baseSnapshotId }
          : {}),
      },
      async (tx) => {
        const previous = input.outfitId
          ? await tx.wardrobeOutfit.findFirst({
              where: { id: input.outfitId, projectId, isTrial: false },
              include: { snapshots: { orderBy: { version: "desc" }, take: 1 } },
            })
          : null;
        const base = options.baseSnapshotId
          ? await tx.wardrobeOutfitSnapshot.findFirst({
              where: { id: options.baseSnapshotId, outfit: { projectId } },
            })
          : null;
        if (options.baseSnapshotId && !base)
          throw new NotFoundException("来源搭配快照不存在");
        const retained = new Set(
          base
            ? (base.payload as unknown as SnapshotPayload).items.map(
                (item) => item.id,
              )
            : previous?.snapshots[0]
              ? (
                  previous.snapshots[0].payload as unknown as SnapshotPayload
                ).items.map((item) => item.id)
              : [],
        );
        const revisions = await tx.wardrobeRevision.findMany({
          where: {
            id: { in: input.items.map((item) => item.revisionId) },
            item: { projectId },
          },
          include: { item: true },
        });
        if (
          revisions.length !== input.items.length ||
          revisions.some(
            (revision) => revision.item.archived && !retained.has(revision.id),
          )
        )
          throw new BadRequestException(
            "不能向搭配新增已归档或非本项目的单品；原有归档单品可以保留",
          );
        const items: OutfitSnapshotItem[] = input.items
          .map((selection) => ({
            ...this.revisionView(
              required(
                revisions.find((item) => item.id === selection.revisionId),
              ),
            ),
            layer: selection.layer,
            wearNote: selection.wearNote,
          }))
          .sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id));
        assertOutfitItems(items, input.layeringConfirmed);
        const ids = [
          ...new Set(
            items.flatMap((item) => [item.assetId, item.sourceAssetId]),
          ),
        ];
        if (
          (await tx.designAsset.count({
            where: { id: { in: ids }, projectId, archivedAt: null },
          })) !== ids.length
        )
          throw new BadRequestException("搭配引用的图片已移除");
        let outfit: WardrobeOutfit;
        if (input.outfitId) {
          const result = await tx.wardrobeOutfit.updateMany({
            where: {
              id: input.outfitId,
              projectId,
              isTrial: false,
              version: required(input.expectedVersion),
            },
            data: { version: { increment: 1 }, name: input.name },
          });
          if (!result.count)
            throw new ConflictException("搭配已被修改，请刷新后重试");
          outfit = await tx.wardrobeOutfit.findUniqueOrThrow({
            where: { id: input.outfitId },
          });
        } else
          outfit = await tx.wardrobeOutfit.create({
            data: {
              projectId,
              name: input.name,
              isTrial: options.trial === true,
            },
          });
        await tx.wardrobeOutfitSnapshot.create({
          data: {
            outfitId: outfit.id,
            version: outfit.version,
            payload: json({
              name: input.name,
              items,
              prompt: outfitPrompt(items),
              layeringConfirmed: input.layeringConfirmed,
            } satisfies SnapshotPayload),
          },
        });
        return this.outfitView(
          await tx.wardrobeOutfit.findUniqueOrThrow({
            where: { id: outfit.id },
            include: { snapshots: { orderBy: { version: "desc" } } },
          }),
        );
      },
    );
  }

  async getSnapshot(
    userId: string,
    projectId: string,
    snapshotId: string,
  ): Promise<OutfitSnapshotView> {
    await this.access.require(userId, projectId);
    const row = await this.db.wardrobeOutfitSnapshot.findFirst({
      where: { id: snapshotId, outfit: { projectId } },
    });
    if (!row) throw new NotFoundException("搭配快照不存在");
    const result = this.snapshotView(row, projectId);
    await this.assets(
      projectId,
      result.items
        .flatMap((item) => [item.assetId, item.sourceAssetId])
        .concat(result.referenceAssetId ? [result.referenceAssetId] : []),
    );
    return result;
  }

  async reference(
    userId: string,
    projectId: string,
    snapshotId: string,
    body: unknown,
  ): Promise<OutfitSnapshotView> {
    await this.edit(userId, projectId);
    const input = parse(outfitReferenceSchema, body);
    const snapshot = await this.getSnapshot(userId, projectId, snapshotId);
    if (snapshot.referenceAssetId)
      return this.mutate(
        userId,
        projectId,
        input.requestKey,
        { action: "reference", snapshotId },
        async () => snapshot,
      );
    const images = await this.assets(
      projectId,
      snapshot.items.map((item) => item.assetId),
    );
    const bytes = await composeOutfitReference(
      await Promise.all(
        snapshot.items.map(async (item) => ({
          bytes: await readWardrobeImage(
            this.storage,
            required(images.find((asset) => asset.id === item.assetId)).url,
          ),
          category: item.category,
          layer: item.layer,
        })),
      ),
    );
    const assetId = digest(
      `wardrobe-reference:${snapshotId}:${OUTFIT_REFERENCE_LAYOUT}`,
    );
    await this.storeDerived(
      userId,
      projectId,
      assetId,
      bytes,
      null,
      "wardrobe-reference",
      snapshot.items.flatMap((item) => [item.assetId, item.sourceAssetId]),
      {
        outfitSnapshotId: snapshotId,
        composition: OUTFIT_REFERENCE_LAYOUT,
        items: JSON.stringify(
          snapshot.items.map((item) => ({
            revisionId: item.id,
            category: item.category,
            layer: item.layer,
          })),
        ),
      },
    );
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "reference", snapshotId },
      async (tx) => {
        const row = await tx.wardrobeOutfitSnapshot.update({
          where: { id: snapshotId },
          data: { referenceAssetId: assetId },
        });
        return this.snapshotView(row, projectId);
      },
    );
  }

  async tryOn(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<WardrobeTryOnView> {
    await this.edit(userId, projectId);
    if (!wardrobeCapabilities().staticTryOnEnabled)
      throw new ServiceUnavailableException("模特试穿当前未启用");
    const input = parse(outfitTryOnSchema, body);
    const snapshot = await this.getSnapshot(
      userId,
      projectId,
      input.snapshotId,
    );
    await this.assets(projectId, [input.modelAssetId]);
    const row = await this.mutate(
      userId,
      projectId,
      input.requestKey,
      { action: "tryon", input },
      (tx) =>
        tx.wardrobeTryOn.create({
          data: {
            projectId,
            userId,
            requestKey: input.requestKey,
            fingerprint: digest(input),
            snapshotId: input.snapshotId,
            modelAssetId: input.modelAssetId,
          },
        }),
    );
    let run = await this.db.wardrobeTryOn.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (!run.taskId && !run.error) {
      try {
        const task = await this.dispatch(
          userId,
          {
            projectId,
            sourceAssetIds: [
              input.modelAssetId,
              ...snapshot.items.map((item) => item.assetId),
            ],
            prompt: snapshot.prompt,
            snapshotId: snapshot.id,
          },
          `wardrobe-tryon:${run.id}`,
        );
        await this.db.wardrobeTryOn.update({
          where: { id: run.id },
          data: { taskId: task.taskId, error: null },
        });
      } catch (error) {
        await this.db.wardrobeTryOn.updateMany({
          where: { id: run.id, taskId: null },
          data: {
            error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "模特试穿失败",
          },
        });
      }
      run = await this.db.wardrobeTryOn.findUniqueOrThrow({
        where: { id: run.id },
      });
    }
    return this.tryOnView(run);
  }

  private async edit(userId: string, projectId: string) {
    const permission = await this.access.require(userId, projectId, "edit");
    if (permission.archived)
      throw new ConflictException("归档项目不能修改衣架");
    if (!wardrobeCapabilities().enabled)
      throw new ServiceUnavailableException("衣架当前未启用");
    return permission;
  }
  private async dispatch(
    userId: string,
    input: Parameters<GenerationService["createForWardrobe"]>[1],
    key: string,
  ): Promise<{ taskId: string }> {
    try {
      return await this.generation.createForWardrobe(userId, input, key);
    } catch (error) {
      // Admission can commit before queue dispatch fails. Reconcile by the same durable task key.
      const permission = await this.access.require(
        userId,
        input.projectId,
        "edit",
      );
      const taskId = createHash("sha256")
        .update(
          `${permission.ownerId}\0${userId === permission.ownerId ? key : `${userId}:${key}`}`,
        )
        .digest("hex");
      if (
        await this.db.generationTask.findFirst({
          where: { id: taskId, projectId: input.projectId },
        })
      )
        return { taskId };
      throw error;
    }
  }
  private async assets(projectId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const assets = await this.db.designAsset.findMany({
      where: { id: { in: unique }, projectId, archivedAt: null },
    });
    if (assets.length !== unique.length)
      throw new NotFoundException("素材已移除或不属于当前项目");
    return unique.map((id) =>
      required(assets.find((asset) => asset.id === id)),
    );
  }
  private async styleSource(
    projectId: string,
    revisionId: string,
    sourceId: string,
  ) {
    const revision = await this.db.styleRevision.findFirst({
      where: { id: revisionId, style: { projectId } },
    });
    const views =
      revision?.payload &&
      typeof revision.payload === "object" &&
      !Array.isArray(revision.payload)
        ? revision.payload.views
        : [];
    if (
      !revision ||
      (revision.sourceAssetId !== sourceId &&
        !(
          Array.isArray(views) &&
          views.some(
            (view) =>
              view &&
              typeof view === "object" &&
              !Array.isArray(view) &&
              view.assetId === sourceId,
          )
        ))
    )
      throw new BadRequestException("来源图片不属于指定的款式修订");
  }
  private async mutate<T>(
    userId: string,
    projectId: string,
    key: string,
    payload: unknown,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const fingerprint = digest(payload);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}), hashtext(${userId + key}))`;
        const permission = await this.access.require(
          userId,
          projectId,
          "edit",
          tx,
        );
        if (permission.archived)
          throw new ConflictException("归档项目不能修改衣架");
        const previous = await tx.wardrobeMutation.findUnique({
          where: {
            projectId_userId_requestKey: { projectId, userId, requestKey: key },
          },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ConflictException("请求标识已用于其他衣架操作");
          return previous.result as T;
        }
        const result = await operation(tx);
        await tx.wardrobeMutation.create({
          data: {
            projectId,
            userId,
            requestKey: key,
            fingerprint,
            result: json(result),
          },
        });
        return result;
      },
      { timeout: 15_000 },
    );
  }
  private revisionView(row: WardrobeRevision): WardrobeRevisionView {
    return {
      ...(row.payload as unknown as RevisionPayload),
      id: row.id,
      itemId: row.itemId,
      version: row.version,
      sourceAssetId: row.sourceAssetId,
      assetId: row.assetId,
      ...(row.styleRevisionId ? { styleRevisionId: row.styleRevisionId } : {}),
      url: assetUrl(row.assetId),
      createdAt: row.createdAt.toISOString(),
    };
  }
  private itemView(row: ItemRecord): WardrobeItemView {
    const revisions = row.revisions.map((revision) =>
      this.revisionView(revision),
    );
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      archived: row.archived,
      version: row.version,
      currentRevision: required(revisions[0]),
      revisions,
    };
  }
  private snapshotView(
    row: WardrobeOutfitSnapshot,
    projectId: string,
  ): OutfitSnapshotView {
    return {
      ...(row.payload as unknown as SnapshotPayload),
      id: row.id,
      outfitId: row.outfitId,
      projectId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      ...(row.referenceAssetId
        ? {
            referenceAssetId: row.referenceAssetId,
            referenceUrl: assetUrl(row.referenceAssetId),
          }
        : {}),
    };
  }
  private outfitView(row: OutfitRecord): OutfitView {
    const snapshots = row.snapshots.map((snapshot) =>
      this.snapshotView(snapshot, row.projectId),
    );
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      version: row.version,
      currentSnapshot: required(snapshots[0]),
      snapshots,
    };
  }
  private async taskResult(
    projectId: string,
    taskId: string | null,
    error: string | null,
  ): Promise<{
    status: WardrobeTryOnView["status"];
    error: string | null;
    results: { assetId: string; url: string }[];
  }> {
    if (error) return { status: "failed", error, results: [] };
    if (!taskId) return { status: "queued", error: null, results: [] };
    const task = await this.db.generationTask.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task)
      return { status: "failed", error: "生成任务记录不存在", results: [] };
    const results = (
      await this.db.designAsset.findMany({
        where: { generationTaskId: taskId, projectId, archivedAt: null },
        orderBy: { createdAt: "asc" },
      })
    ).map((asset) => ({ assetId: asset.id, url: assetUrl(asset.id) }));
    const status =
      task.status === "CANCELED"
        ? "canceled"
        : task.status === "FAILED" || task.status === "MODERATION_FAILED"
          ? "failed"
          : task.status === "SUCCEEDED"
            ? results.length
              ? "ready"
              : "failed"
            : task.status === "QUEUED"
              ? "queued"
              : "running";
    return {
      status,
      error:
        status === "failed" ? "生成未成功，请查看任务详情后重新准备" : null,
      results,
    };
  }
  private async preparationView(
    row: WardrobePreparation,
  ): Promise<WardrobePreparationView> {
    const input = parse(wardrobePrepareSchema, row.input);
    const materialProcessing =
      input.mode === "existing"
        ? await this.materialProcessing(input.sourceAssetId)
        : undefined;
    const result =
      input.mode === "existing" && row.ready && !row.error
        ? {
            status: "ready" as const,
            error: null,
            results: [
              {
                assetId: input.region
                  ? digest(`wardrobe-crop:${row.id}`)
                  : input.sourceAssetId,
                url: assetUrl(
                  input.region
                    ? digest(`wardrobe-crop:${row.id}`)
                    : input.sourceAssetId,
                ),
              },
            ],
          }
        : await this.taskResult(row.projectId, row.taskId, row.error);
    return {
      id: row.id,
      projectId: row.projectId,
      sourceAssetId: input.sourceAssetId,
      name: input.name,
      category: input.category,
      sourceKind: input.sourceKind,
      mode: input.mode,
      ...(materialProcessing ? { materialProcessing } : {}),
      ...(input.presentation
        ? {
            presentation: {
              view: input.presentation.view,
              revisionId: input.presentation.revisionId,
              orientation: input.presentation.orientation,
              ...(input.presentation.repairPreparationId
                ? {
                    repairPreparationId: input.presentation.repairPreparationId,
                  }
                : {}),
            },
          }
        : {}),
      status: result.status,
      taskId: row.taskId,
      error: result.error,
      candidates: result.results,
      createdAt: row.createdAt.toISOString(),
    };
  }
  private async tryOnView(row: WardrobeTryOn): Promise<WardrobeTryOnView> {
    return {
      id: row.id,
      snapshotId: row.snapshotId,
      modelAssetId: row.modelAssetId,
      taskId: row.taskId,
      ...(await this.taskResult(row.projectId, row.taskId, row.error)),
      createdAt: row.createdAt.toISOString(),
    };
  }
  private async hasCompletionSource(
    projectId: string,
    sourceAssetId: string,
  ): Promise<boolean> {
    // Extraction, cropping and re-importing an existing project asset must not
    // erase the disclosure that its ancestor was a generated completion.
    const visited = new Set<string>();
    let current: string | null = sourceAssetId;
    while (current) {
      if (visited.has(current) || visited.size >= 256)
        throw new BadRequestException("单品来源链异常，无法核对生成补全记录");
      visited.add(current);
      const asset: {
        parentAssetId: string | null;
        generationTaskId: string | null;
        wardrobeDisplays: { payload: Prisma.JsonValue }[];
      } | null = await this.db.designAsset.findFirst({
        where: { id: current, projectId },
        select: {
          parentAssetId: true,
          generationTaskId: true,
          wardrobeDisplays: {
            where: { item: { projectId } },
            select: { payload: true },
          },
        },
      });
      if (!asset)
        throw new BadRequestException("单品来源链不完整，无法核对生成补全记录");
      if (
        asset.wardrobeDisplays.some(
          (revision) =>
            (revision.payload as unknown as RevisionPayload)
              .generatedCompletion === true,
        )
      )
        return true;
      if (asset.generationTaskId) {
        const preparations = await this.db.wardrobePreparation.findMany({
          where: { projectId, taskId: asset.generationTaskId },
          select: { input: true },
        });
        if (
          preparations.some((row) => {
            const parsed = wardrobePrepareSchema.safeParse(row.input);
            return (
              parsed.success &&
              parsed.data.mode === "complete" &&
              !parsed.data.presentation
            );
          })
        )
          return true;
      }
      current = asset.parentAssetId;
    }
    return false;
  }
  private async cropSource(
    userId: string,
    projectId: string,
    preparation: WardrobePreparation,
    input: z.output<typeof wardrobePrepareSchema>,
  ): Promise<string> {
    const id = digest(`wardrobe-crop:${preparation.id}`);
    if (await this.db.designAsset.findUnique({ where: { id } })) return id;
    const [source] = await this.assets(projectId, [input.sourceAssetId]);
    const bytes = await cropWardrobeImage(
      await readWardrobeImage(this.storage, required(source).url),
      required(input.region),
    );
    await this.storeDerived(
      userId,
      projectId,
      id,
      bytes,
      input.sourceAssetId,
      "wardrobe-crop",
      [input.sourceAssetId],
      { region: JSON.stringify(input.region) },
    );
    return id;
  }
  private async storeDerived(
    userId: string,
    projectId: string,
    id: string,
    bytes: Buffer,
    parentAssetId: string | null,
    tool: string,
    sourceIds: string[],
    parameters: Record<string, string>,
  ): Promise<void> {
    if (await this.db.designAsset.findUnique({ where: { id } })) return;
    const key = `wardrobe/${projectId}/${id}.png`;
    await this.storage.uploadBuffer(
      key,
      bytes,
      "image/png",
      createHash("sha256").update(bytes).digest("base64"),
    );
    const metadata = await sharp(bytes).metadata();
    const parent = parentAssetId
      ? await this.db.designAsset.findUniqueOrThrow({
          where: { id: parentAssetId },
        })
      : null;
    await this.db.$transaction(async (tx) => {
      const permission = await this.access.require(
        userId,
        projectId,
        "edit",
        tx,
      );
      if (permission.archived)
        throw new ConflictException("归档项目不能新增衣架素材");
      await tx.designAsset.upsert({
        where: { id },
        update: {},
        create: {
          id,
          projectId,
          parentAssetId,
          rootAssetId: parent?.rootAssetId ?? id,
          operation: DesignAssetOperation.GENERATED,
          url: `s3://${key}`,
          thumbnailUrl: `s3://${key}`,
          width: required(metadata.width),
          height: required(metadata.height),
          designStep: {
            create: {
              projectId,
              actor: "wardrobe",
              tool,
              intent:
                tool === "wardrobe-reference"
                  ? "合成已确认单品参考图"
                  : tool === "wardrobe-material-alpha"
                    ? "以局部透射信息派生透明候选；原图色彩与保护区域保留，待人工核对"
                    : tool === "wardrobe-masked-edit"
                      ? "保留原图alpha及保护区域的局部RGB修正候选，待人工核对"
                      : tool === "wardrobe-correction-guide"
                        ? "同源蒙版有效选区的位置指引，仅生成参考，不是服装设计或陈列素材"
                        : tool === "wardrobe-material-detail"
                          ? "从完整原图保留原像素裁出网纱细节参考"
                          : tool === "wardrobe-material-mask"
                            ? "保存用户涂选的材质修复区域，不触发素材分析或生成"
                            : "保留原图并裁出目标单品",
              inputSnapshot: json({
                version: 1,
                sources: [...new Set(sourceIds)].map((assetId) => ({
                  assetId,
                  elementId: assetId,
                  role: "garment_ref",
                  title: "单品来源",
                })),
                constraints: {
                  palette: [],
                  notes: [],
                  avoidLabels: [],
                  fabricTerms: [],
                },
                parameters,
              }),
            },
          },
        },
      });
    });
  }
}
