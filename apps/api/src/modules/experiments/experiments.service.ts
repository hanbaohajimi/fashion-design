import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, type PrismaClient } from "@fashion/db";
import {
  type ExperimentCreateInput,
  type ExperimentItemView,
  type ExperimentView,
} from "@fashion/shared";
import { GenerationService } from "../generation/generation.service";
import type { GenerationCreateRequest } from "../generation/generation.schemas";
import { S3FileStorage } from "../files/storage.service";
import { requireProjectFile } from "../files/project-file-access";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

export const EXPERIMENTS_DB = Symbol("EXPERIMENTS_DB");
type Database = Pick<
  PrismaClient,
  | "studioExperiment"
  | "designAsset"
  | "fabric"
  | "generationTask"
  | "fileAsset"
  | "project"
>;
interface FrozenFabric {
  id: string;
  tags: string[];
  details: Prisma.JsonValue | null;
  objectKey: string;
}
interface Item {
  id: string;
  title: string;
  prompt: string;
  status: ExperimentItemView["status"];
  attempt: number;
  taskId: string | null;
  error: string | null;
  color: { name: string; hex: string } | null;
  fabric: FrozenFabric | null;
  request?: GenerationCreateRequest;
  dispatchedAt?: string;
  cancelRequested?: boolean;
}
interface BatchData {
  mode: ExperimentCreateInput["mode"];
  preserve: string;
  width: number;
  height: number;
  quality: ExperimentCreateInput["quality"];
  ownerId: string;
  items: Item[];
}
const terminal = new Set([
  "SUCCEEDED",
  "FAILED",
  "MODERATION_FAILED",
  "CANCELED",
]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const taskKey = (batchId: string, item: Item) =>
  "experiment:" + batchId + ":" + item.id + ":" + item.attempt;
export function experimentCombinations(input: ExperimentCreateInput) {
  return (input.colors.length ? input.colors : [null]).flatMap((color) =>
    (input.fabricIds.length ? input.fabricIds : [null]).flatMap((fabricId) =>
      (input.variations.length ? input.variations : [null]).map(
        (variation) => ({ color, fabricId, variation }),
      ),
    ),
  );
}
export function experimentFingerprint(input: ExperimentCreateInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

@Injectable()
export class ExperimentsService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private recoveryFlight: Promise<void> | undefined;
  private recoveryCursor: string | undefined;
  private stopping = false;
  private readonly logger = new Logger(ExperimentsService.name);
  constructor(
    @Inject(EXPERIMENTS_DB) private readonly db: Database,
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.recover().catch(() =>
        this.logger.warn("实验恢复暂不可用，稍后自动重试"),
      );
    }, 15_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.recoveryFlight;
  }
  async create(
    userId: string,
    projectId: string,
    input: ExperimentCreateInput,
    requestKey: string,
  ): Promise<ExperimentView> {
    const permission = await this.access.require(userId, projectId, "edit");
    const fingerprint = experimentFingerprint(input);
    const existing = await this.db.studioExperiment.findUnique({
      where: { userId_requestKey: { userId, requestKey } },
    });
    if (existing) {
      if (
        existing.projectId !== projectId ||
        existing.fingerprint !== fingerprint
      )
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于其他实验",
        });
      return this.view(existing);
    }
    const source = await this.db.designAsset.findFirst({
      where: { id: input.sourceAssetId, projectId, archivedAt: null },
    });
    if (!source) throw new NotFoundException("母图不存在或不属于当前项目");
    const fabrics = await this.db.fabric.findMany({
      where: {
        id: { in: input.fabricIds },
        status: "active",
      },
      include: { mainFile: true },
    });
    if (fabrics.length !== input.fabricIds.length)
      throw new BadRequestException("部分面料不存在或无权使用");
    for (const fabric of fabrics) {
      if (fabric.scope !== "PRESET" && fabric.ownerId !== userId)
        await requireProjectFile(
          this.db,
          this.access,
          userId,
          fabric.mainFileId,
          projectId,
        );
    }
    const items: Item[] = experimentCombinations(input).map(
      ({ color, fabricId, variation }, i) => {
        const record = fabrics.find((fabric) => fabric.id === fabricId);
        const fabric = record
          ? {
              id: record.id,
              tags: record.tags,
              details:
                record.details &&
                typeof record.details === "object" &&
                !Array.isArray(record.details)
                  ? Object.fromEntries(
                      Object.entries(record.details).filter(
                        ([key]) => key !== "_fiberKeys",
                      ),
                    )
                  : record.details,
              objectKey: record.mainFile.objectKey,
            }
          : null;
        const prompt = [
          input.prompt,
          "Preserve: " + input.preserve,
          color
            ? "Change garment color to " +
              color.name +
              " " +
              color.hex +
              ". Color is a visual target, not a measured color guarantee."
            : "",
          fabric
            ? "Explore the fabric appearance in the attached swatch. Declared material information: " +
              JSON.stringify({ tags: fabric.tags, details: fabric.details })
            : "",
          variation ? "Requested variation: " + variation : "",
          "Produce exactly one image of the same garment. Do not add a collage or labels.",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          id: randomUUID(),
          title:
            [color?.name, record?.tags.join(" / "), variation]
              .filter(Boolean)
              .join(" · ") || "方案 " + (i + 1),
          prompt,
          status: "draft",
          attempt: 0,
          taskId: null,
          error: null,
          color,
          fabric,
        };
      },
    );
    const data: BatchData = {
      mode: input.mode,
      preserve: input.preserve,
      width: input.width,
      height: input.height,
      quality: input.quality,
      ownerId: permission.ownerId,
      items,
    };
    const id = createHash("sha256")
      .update(userId + "\0" + requestKey)
      .digest("hex");
    const record = await this.db.studioExperiment.upsert({
      where: { userId_requestKey: { userId, requestKey } },
      create: {
        id,
        userId,
        projectId,
        sourceAssetId: source.id,
        requestKey,
        fingerprint,
        items: json(data),
      },
      update: {},
    });
    if (record.fingerprint !== fingerprint || record.projectId !== projectId)
      throw new ConflictException("实验请求编号冲突");
    return this.view(record);
  }
  async list(userId: string, projectId: string): Promise<ExperimentView[]> {
    await this.access.require(userId, projectId, "read");
    const records = await this.db.studioExperiment.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 40,
    });
    return Promise.all(records.map((record) => this.view(record)));
  }
  async act(
    userId: string,
    projectId: string,
    batchId: string,
    itemIds: string[],
    action: "submit" | "retry" | "cancel",
  ) {
    await this.access.require(userId, projectId, "edit");
    const record = await this.load(batchId, projectId);
    const data = record.items as unknown as BatchData;
    if (itemIds.some((id) => !data.items.some((item) => item.id === id)))
      throw new BadRequestException("实验单元格不存在");
    if (action === "retry") {
      const tasks = await this.db.generationTask.findMany({
        where: {
          id: {
            in: data.items.flatMap((item) =>
              item.taskId ? [item.taskId] : [],
            ),
          },
        },
        select: { id: true, status: true },
      });
      await this.mutate(batchId, (current) => {
        for (const item of current.items) {
          if (!itemIds.includes(item.id)) continue;
          const status = tasks.find((task) => task.id === item.taskId)?.status;
          if (
            item.status === "not_admitted" ||
            (status && terminal.has(status) && status !== "SUCCEEDED")
          ) {
            item.attempt++;
            item.status = "draft";
            item.taskId = null;
            item.error = null;
            delete item.request;
            delete item.dispatchedAt;
            delete item.cancelRequested;
          }
        }
      });
    }
    if (action === "cancel") {
      // Running remote requests are not promised cancellable; use the existing cancellation protocol.
      // Persist every selected intent before contacting the generation service.
      await this.mutate(batchId, (state) => {
        for (const entry of state.items) {
          if (!itemIds.includes(entry.id)) continue;
          if (entry.status === "draft" || entry.status === "dispatching")
            entry.status = "canceled";
          if (entry.taskId) entry.cancelRequested = true;
        }
      });
      let cancellationError: unknown;
      for (const id of itemIds) {
        try {
          await this.settleCancellation(batchId, id);
        } catch (error) {
          cancellationError ??= error;
        }
      }
      if (cancellationError) throw cancellationError;
    } else {
      for (const id of itemIds) {
        const current = (await this.load(batchId))
          .items as unknown as BatchData;
        const before = current.items.find((item) => item.id === id);
        try {
          await this.dispatch(batchId, id);
        } catch (error) {
          // A preparation failure belongs to this cell; the remaining selected
          // cells must still be attempted. Never overwrite a concurrent claim.
          if (before?.status !== "draft") throw error;
          await this.mutate(batchId, (state) => {
            const entry = state.items.find((item) => item.id === id);
            if (entry?.status !== "draft" || entry.attempt !== before.attempt)
              return false;
            entry.status = "not_admitted";
            entry.error =
              error instanceof Error ? error.message : "任务准备失败，请重试";
            return true;
          });
        }
      }
    }
    return this.view(await this.load(batchId, projectId));
  }
  private async dispatch(batchId: string, itemId: string, recover = false) {
    let record = await this.load(batchId);
    let data = record.items as unknown as BatchData;
    let item = data.items.find((entry) => entry.id === itemId);
    if (
      !item ||
      (item.status !== "draft" && !(recover && item.status === "dispatching"))
    )
      return;
    // Admission is a durable fact. A later permission/source change must not
    // discard an existing task or cause a new attempt to charge the same cell.
    if (recover && (await this.reconcileAdmitted(batchId, item))) return;
    await this.access.require(record.userId, record.projectId, "edit");
    if (item.status === "draft") {
      const source = await this.db.designAsset.findFirst({
        where: {
          id: record.sourceAssetId,
          projectId: record.projectId,
          archivedAt: null,
        },
      });
      if (!source || !source.url.startsWith("s3://"))
        throw new BadRequestException("母图存储不可用，请重新选择");
      const signedSource = await this.storage.createDownloadUrl(
        source.url.slice(5),
        24 * 60 * 60,
      );
      const fabricUrl = item.fabric
        ? await this.storage.createDownloadUrl(
            item.fabric.objectKey,
            24 * 60 * 60,
          )
        : null;
      const request: GenerationCreateRequest = {
        taskType: "i2i",
        projectId: record.projectId,
        parentAssetId: source.id,
        prompt: item.prompt,
        referenceImageUrl: signedSource,
        ...(fabricUrl
          ? {
              referenceImageUrls: [signedSource, fabricUrl],
              referenceImages: [
                {
                  order: 0,
                  role: "style_ref" as const,
                  url: signedSource,
                  weight: 1,
                },
                {
                  order: 1,
                  role: "fabric_texture" as const,
                  url: fabricUrl,
                  weight: 0.7,
                },
              ],
            }
          : {}),
        width: data.width,
        height: data.height,
        quality: data.quality,
        outputFormat: "png",
      };
      const claimed = await this.mutate(batchId, (current) => {
        const entry = current.items.find((value) => value.id === itemId);
        if (entry?.status !== "draft") return false;
        entry.status = "dispatching";
        entry.request = request;
        entry.dispatchedAt = new Date().toISOString();
        entry.taskId = createHash("sha256")
          .update(
            current.ownerId +
              "\0" +
              (record.userId !== current.ownerId ? record.userId + ":" : "") +
              taskKey(batchId, entry),
          )
          .digest("hex");
        return true;
      });
      if (!claimed) return;
      record = await this.load(batchId);
      data = record.items as unknown as BatchData;
      item = data.items.find((entry) => entry.id === itemId);
    }
    if (!item?.request || item.status !== "dispatching") return;
    if (recover && item.taskId) {
      const admitted = await this.db.generationTask.findUnique({
        where: { id: item.taskId },
        select: { id: true },
      });
      if (!admitted) {
        // No task has been admitted yet: refresh expired transport URLs while keeping
        // the immutable source, variation and deterministic task identity.
        const source = await this.db.designAsset.findFirst({
          where: {
            id: record.sourceAssetId,
            projectId: record.projectId,
            archivedAt: null,
          },
        });
        if (!source?.url.startsWith("s3://"))
          throw new BadRequestException("实验母图已不可用");
        const sourceUrl = await this.storage.createDownloadUrl(
          source.url.slice(5),
          24 * 60 * 60,
        );
        const fabricUrl = item.fabric
          ? await this.storage.createDownloadUrl(
              item.fabric.objectKey,
              24 * 60 * 60,
            )
          : null;
        const refreshed = {
          ...item.request,
          referenceImageUrl: sourceUrl,
          ...(fabricUrl
            ? {
                referenceImageUrls: [sourceUrl, fabricUrl],
                referenceImages: [
                  {
                    order: 0,
                    role: "style_ref" as const,
                    url: sourceUrl,
                    weight: 1,
                  },
                  {
                    order: 1,
                    role: "fabric_texture" as const,
                    url: fabricUrl,
                    weight: 0.7,
                  },
                ],
              }
            : {}),
        };
        const attempt = item.attempt;
        await this.mutate(batchId, (current) => {
          const entry = current.items.find((value) => value.id === itemId);
          if (entry?.status !== "dispatching" || entry.attempt !== attempt)
            return false;
          entry.request = refreshed;
          entry.dispatchedAt = new Date().toISOString();
          return true;
        });
        record = await this.load(batchId);
        data = record.items as unknown as BatchData;
        item = data.items.find((entry) => entry.id === itemId);
      }
    }
    if (!item?.request || item.status !== "dispatching") return;
    const attempt = item.attempt;
    try {
      await this.generation.createFromAgent(
        record.userId,
        item.request,
        taskKey(batchId, item),
        item.prompt,
        {
          version: 1,
          mode: "board_guided",
          positivePrompt: item.prompt,
          negativePrompt: "",
          palette: item.color ? [item.color.hex] : [],
          paletteReferences: [],
          styleReferences: [],
          silhouetteReferences: [],
          fabricReferences: [],
          fabricInputs: [],
          patternReferences: [],
          detailReferences: [],
          avoidLabels: [],
          notes: [data.preserve, "experiment initiator: " + record.userId],
          enhancement: "keywords",
          sources: [
            {
              elementId: record.sourceAssetId,
              assetId: record.sourceAssetId,
              role: "source",
              title: "实验母图",
            },
            ...(item.fabric
              ? [
                  {
                    elementId: item.fabric.id,
                    fabricId: item.fabric.id,
                    role: "fabric_texture",
                    title: item.fabric.tags.join(" / "),
                    tags: item.fabric.tags,
                  },
                ]
              : []),
          ],
        },
      );
      await this.settleCancellation(batchId, itemId);
      await this.mutate(batchId, (current) => {
        const entry = current.items.find((value) => value.id === itemId);
        if (entry?.attempt === attempt && entry.status === "dispatching") {
          entry.status = "queued";
          entry.error = null;
        }
      });
    } catch (error) {
      const task = item.taskId
        ? await this.db.generationTask.findUnique({
            where: { id: item.taskId },
            select: { id: true },
          })
        : null;
      await this.mutate(batchId, (current) => {
        const entry = current.items.find((value) => value.id === itemId);
        if (entry?.attempt !== attempt || entry.status !== "dispatching")
          return;
        entry.status = task ? "queued" : "not_admitted";
        entry.error = task
          ? null
          : error instanceof Error
            ? error.message
            : "任务未接纳，请重试";
        if (!task) entry.taskId = null;
      });
    }
  }
  private async reconcileAdmitted(
    batchId: string,
    item: Item,
  ): Promise<boolean> {
    if (!item.taskId) return false;
    const task = await this.db.generationTask.findUnique({
      where: { id: item.taskId },
      select: { id: true },
    });
    if (!task) return false;
    await this.mutate(batchId, (state) => {
      const entry = state.items.find((value) => value.id === item.id);
      if (
        entry?.status !== "dispatching" ||
        entry.attempt !== item.attempt ||
        entry.taskId !== item.taskId
      )
        return false;
      entry.status = "queued";
      entry.error = null;
      return true;
    });
    return true;
  }
  private async settleCancellation(
    batchId: string,
    itemId: string,
  ): Promise<void> {
    const data = (await this.load(batchId)).items as unknown as BatchData;
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item?.cancelRequested || !item.taskId) return;
    try {
      await this.generation.cancel(data.ownerId, item.taskId);
    } catch (error) {
      // Admission may still be in flight in another process. Keep the intent
      // so recovery can cancel that exact identity once the task appears.
      if (error instanceof NotFoundException) return;
      throw error;
    }
    await this.mutate(batchId, (state) => {
      const entry = state.items.find((value) => value.id === itemId);
      if (entry?.attempt !== item.attempt || entry.taskId !== item.taskId)
        return false;
      delete entry.cancelRequested;
      return true;
    });
  }
  private async load(id: string, projectId?: string) {
    const record = await this.db.studioExperiment.findFirst({
      where: { id, ...(projectId ? { projectId } : {}) },
    });
    if (!record) throw new NotFoundException("实验不存在");
    return record;
  }
  private async mutate(
    id: string,
    change: (data: BatchData) => unknown,
  ): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
      const record = await this.load(id);
      const data = clone(record.items as unknown as BatchData);
      if (change(data) === false) return false;
      const updated = await this.db.studioExperiment.updateMany({
        where: { id, version: record.version },
        data: { items: json(data), version: { increment: 1 } },
      });
      if (updated.count) return true;
    }
    throw new ConflictException("实验状态正在更新，请重试");
  }
  private async view(
    record: Awaited<ReturnType<ExperimentsService["load"]>>,
  ): Promise<ExperimentView> {
    const data = record.items as unknown as BatchData;
    const tasks = await this.db.generationTask.findMany({
      where: {
        id: {
          in: data.items.flatMap((item) => (item.taskId ? [item.taskId] : [])),
        },
      },
      select: { id: true, status: true, errorMessage: true },
    });
    const assets = await this.db.designAsset.findMany({
      where: {
        projectId: record.projectId,
        generationTaskId: { in: tasks.map((task) => task.id) },
      },
      select: {
        id: true,
        url: true,
        thumbnailUrl: true,
        generationTaskId: true,
      },
    });
    return {
      id: record.id,
      projectId: record.projectId,
      sourceAssetId: record.sourceAssetId,
      version: record.version,
      mode: data.mode,
      preserve: data.preserve,
      createdAt: record.createdAt.toISOString(),
      items: await Promise.all(
        data.items.map(async (item) => {
          const task = tasks.find((task) => task.id === item.taskId);
          return {
            id: item.id,
            title: item.title,
            prompt: item.prompt,
            status: task
              ? task.status === "MODERATION_FAILED"
                ? "failed"
                : (task.status.toLowerCase() as ExperimentItemView["status"])
              : item.status,
            attempt: item.attempt,
            taskId: item.taskId,
            error: task ? task.errorMessage : item.error,
            color: item.color,
            fabric: item.fabric
              ? {
                  id: item.fabric.id,
                  tags: item.fabric.tags,
                  details: item.fabric.details,
                }
              : null,
            assets: await Promise.all(
              assets
                .filter((asset) => asset.generationTaskId === item.taskId)
                .map(async (asset) => ({
                  id: asset.id,
                  url: await this.url(asset.url),
                  thumbnailUrl: asset.thumbnailUrl
                    ? await this.url(asset.thumbnailUrl)
                    : null,
                })),
            ),
          };
        }),
      ),
    };
  }
  private url(value: string) {
    return value.startsWith("s3://")
      ? this.storage.createDownloadUrl(value.slice(5), 60)
      : Promise.resolve(value);
  }
  private recover(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.recoveryFlight ??= this.recoverBatch().finally(() => {
      this.recoveryFlight = undefined;
    });
    return this.recoveryFlight;
  }
  private async recoverBatch() {
    const records = await this.db.studioExperiment.findMany({
      where: {
        OR: [
          {
            items: {
              path: ["items"],
              array_contains: [{ status: "dispatching" }],
            },
          },
          {
            items: {
              path: ["items"],
              array_contains: [{ cancelRequested: true }],
            },
          },
        ],
        ...(this.recoveryCursor ? { id: { gt: this.recoveryCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    this.recoveryCursor =
      records.length === 100 ? records.at(-1)?.id : undefined;
    for (const record of records) {
      const data = record.items as unknown as BatchData;
      for (const item of data.items) {
        if (this.stopping) return;
        if (item.cancelRequested) {
          await this.settleCancellation(record.id, item.id).catch(() =>
            this.logger.warn("实验取消等待重试：" + record.id + "/" + item.id),
          );
          continue;
        }
        if (
          item.status === "dispatching" &&
          Date.now() - new Date(item.dispatchedAt ?? 0).getTime() > 30_000
        )
          await this.dispatch(record.id, item.id, true).catch(
            async (error: unknown) => {
              this.logger.warn(
                "实验分发恢复未完成：" + record.id + "/" + item.id,
              );
              if (
                error instanceof BadRequestException ||
                error instanceof NotFoundException ||
                error instanceof ForbiddenException
              ) {
                if (await this.reconcileAdmitted(record.id, item)) return;
                await this.mutate(record.id, (state) => {
                  const entry = state.items.find(
                    (value) => value.id === item.id,
                  );
                  if (
                    entry?.status !== "dispatching" ||
                    entry.attempt !== item.attempt
                  )
                    return false;
                  entry.status = "not_admitted";
                  entry.taskId = null;
                  entry.error =
                    "原执行账号权限或参考图已不可用，请重新确认后重试";
                  return true;
                });
              }
            },
          );
      }
    }
  }
}
