import {
  Prisma,
  type PrismaClient,
  type RunwayMedia,
  type RunwayRun,
  type RunwayShow,
} from "@fashion/db";
import {
  RUNWAY_STAGES,
  runwayActionSchema,
  runwayCancelSchema,
  runwayCreateShowSchema,
  runwayDraftSchema,
  runwayForkSchema,
  runwayStartSchema,
  runwayUpdateShowSchema,
  type RunwayCapabilities,
  type RunwayDraft,
  type RunwayEventView,
  type RunwayMediaView,
  type RunwayRunView,
  type RunwayShowView,
  type RunwayStage,
} from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { requireProjectFile } from "../files/project-file-access";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { RunwayStorage } from "./runway-storage.service";

export const RUNWAY_DB = Symbol("RUNWAY_DB");
type Transaction = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const conflict = () =>
  new ConflictException({
    code: "RUNWAY_VERSION_CONFLICT",
    message: "服装秀已更新，请刷新后重新操作",
  });
const missing = () =>
  new NotFoundException({
    code: "RUNWAY_NOT_FOUND",
    message: "服装秀记录不存在",
  });
function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "INVALID_RUNWAY_INPUT",
      message: result.error.issues[0]?.message ?? "服装秀参数无效",
    });
  return result.data;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function assertSame(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b))
    throw new ConflictException({
      code: "RUNWAY_REQUEST_KEY_REUSED",
      message: "该操作编号已用于其他请求，请刷新后重试",
    });
}
function requiredValue(value: string | undefined): string {
  if (!value) throw new Error("服装秀媒体记录缺少必填字段");
  return value;
}
function runwayEnabled(): boolean {
  return ["true", "1", "yes"].includes(
    (process.env.RUNWAY_ENABLED ?? "").trim().toLowerCase(),
  );
}
function runwayProviderMode(): "mock" | "live" {
  return process.env.RUNWAY_PROVIDER_MODE?.trim().toLowerCase() === "live"
    ? "live"
    : "mock";
}
const mediaStage: Record<string, RunwayStage> = {
  model: "prepare",
  cloth: "prepare",
  background: "prepare",
  tryon: "tryon",
  storyboard: "storyboard",
  video: "video",
  silent_video: "compose",
  music: "music",
  final_video: "music",
  poster: "compose",
};

@Injectable()
export class RunwayService {
  constructor(
    @Inject(RUNWAY_DB) private readonly database: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(RunwayStorage) private readonly storage: RunwayStorage,
  ) {}

  private enabled() {
    if (!runwayEnabled())
      throw new ServiceUnavailableException({
        code: "RUNWAY_DISABLED",
        message: "服装秀功能尚未启用",
      });
  }
  private async edit(userId: string, projectId: string, tx?: Transaction) {
    this.enabled();
    const access = await this.access.require(userId, projectId, "edit", tx);
    if (access.archived)
      throw new ForbiddenException({
        code: "PROJECT_ARCHIVED",
        message: "请先取消项目归档，再执行服装秀任务",
      });
    return access;
  }
  async capabilities(
    userId: string,
    projectId: string,
  ): Promise<RunwayCapabilities> {
    const access = await this.access.require(userId, projectId, "read");
    const mode = runwayProviderMode();
    const heartbeat = await this.database.runwayWorkerHeartbeat.findFirst({
      where: { mode, updatedAt: { gte: new Date(Date.now() - 35_000) } },
      orderBy: { updatedAt: "desc" },
    });
    return {
      enabled: runwayEnabled(),
      workerOnline: !!heartbeat,
      mode,
      capabilities: Object.fromEntries(
        Object.entries(object(heartbeat?.capabilities)).map(([key, value]) => [
          key,
          value === true,
        ]),
      ),
      canEdit: access.capabilities.edit && !access.archived,
    };
  }
  async list(userId: string, projectId: string): Promise<RunwayShowView[]> {
    await this.access.require(userId, projectId, "read");
    const shows = await this.database.runwayShow.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { media: true },
        },
      },
    });
    return shows.map((show) => this.showView(show));
  }
  async show(
    userId: string,
    projectId: string,
    id: string,
  ): Promise<RunwayShowView> {
    await this.access.require(userId, projectId, "read");
    const show = await this.database.runwayShow.findFirst({
      where: { id, projectId },
      include: {
        runs: { orderBy: { createdAt: "desc" }, include: { media: true } },
      },
    });
    if (!show) throw missing();
    return this.showView(show);
  }
  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<RunwayShowView> {
    await this.edit(userId, projectId);
    const input = parse(runwayCreateShowSchema, body);
    const existing = await this.database.runwayShow.findUnique({
      where: {
        projectId_ownerId_requestKey: {
          projectId,
          ownerId: userId,
          requestKey: input.requestKey,
        },
      },
    });
    if (existing) {
      assertSame(
        object(existing.mutations).create ?? {
          title: existing.title,
          draft: existing.draft,
        },
        { title: input.title, draft: input.draft },
      );
      return this.show(userId, projectId, existing.id);
    }
    try {
      const result = await this.database.runwayShow.create({
        data: {
          projectId,
          ownerId: userId,
          title: input.title,
          draft: json(input.draft),
          requestKey: input.requestKey,
          mutations: json({
            create: { title: input.title, draft: input.draft },
          }),
        },
      });
      return this.show(userId, projectId, result.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return this.create(userId, projectId, body);
      throw error;
    }
  }
  async update(
    userId: string,
    projectId: string,
    showId: string,
    body: unknown,
  ) {
    const input = parse(runwayUpdateShowSchema, body);
    await this.edit(userId, projectId);
    await this.database.$transaction(async (tx) => {
      await this.edit(userId, projectId, tx);
      await tx.$queryRaw`SELECT id FROM runway_shows WHERE id = ${showId} FOR UPDATE`;
      const show = await tx.runwayShow.findFirst({
        where: { id: showId, projectId },
      });
      if (!show) throw missing();
      const mutations = object(show.mutations);
      const mutationKey = `${userId}:${input.requestKey}`;
      if (mutations[mutationKey]) {
        assertSame(mutations[mutationKey], input);
        return;
      }
      if (show.version !== input.expectedVersion) throw conflict();
      await tx.runwayShow.update({
        where: { id: showId },
        data: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.draft ? { draft: json(input.draft) } : {}),
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
          version: { increment: 1 },
          mutations: json({ ...mutations, [mutationKey]: input }),
        },
      });
    });
    return this.show(userId, projectId, showId);
  }
  async run(
    userId: string,
    projectId: string,
    id: string,
  ): Promise<RunwayRunView> {
    await this.access.require(userId, projectId, "read");
    const run = await this.database.runwayRun.findFirst({
      where: { id, projectId },
      include: {
        media: { orderBy: { createdAt: "asc" } },
        attempts: {
          where: { errorCode: { not: null } },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!run) throw missing();
    return {
      ...this.runView(run),
      errorCode: ["FAILED", "NEEDS_ATTENTION"].includes(run.status)
        ? typeof object(run.state).errorCode === "string"
          ? String(object(run.state).errorCode)
          : (run.attempts[0]?.errorCode ?? null)
        : null,
    };
  }
  async start(
    userId: string,
    projectId: string,
    showId: string,
    body: unknown,
  ) {
    const input = parse(runwayStartSchema, body);
    await this.edit(userId, projectId);
    const prior = await this.database.runwayRun.findUnique({
      where: {
        showId_userId_requestKey: {
          showId,
          userId,
          requestKey: input.requestKey,
        },
      },
    });
    if (prior) {
      assertSame(object(prior.modelSnapshot).startRequest, input);
      return this.run(userId, projectId, prior.id);
    }
    const show = await this.database.runwayShow.findFirst({
      where: { id: showId, projectId },
    });
    if (!show) throw missing();
    if (show.archived || show.version !== input.expectedVersion)
      throw conflict();
    const draft = runwayDraftSchema.parse(show.draft);
    const runId = randomUUID();
    const copies: Prisma.RunwayMediaCreateManyInput[] = [];
    try {
      for (const source of draft.inputs)
        copies.push(await this.snapshot(userId, projectId, runId, source));
      let resultId: string = runId;
      await this.database.$transaction(
        async (tx) => {
          await this.edit(userId, projectId, tx);
          await tx.$queryRaw`SELECT id FROM runway_shows WHERE id = ${showId} FOR UPDATE`;
          const repeated = await tx.runwayRun.findUnique({
            where: {
              showId_userId_requestKey: {
                showId,
                userId,
                requestKey: input.requestKey,
              },
            },
          });
          if (repeated) {
            assertSame(object(repeated.modelSnapshot).startRequest, input);
            resultId = repeated.id;
            return;
          }
          const current = await tx.runwayShow.findUnique({
            where: { id: showId },
          });
          if (
            !current ||
            current.archived ||
            current.version !== input.expectedVersion
          )
            throw conflict();
          const mediaByStage: Record<string, string[]> = {};
          for (const copy of copies)
            (mediaByStage[copy.kind] ??= []).push(requiredValue(copy.id));
          await tx.runwayRun.create({
            data: {
              id: runId,
              showId,
              projectId,
              userId,
              requestKey: input.requestKey,
              inputSnapshot: json(draft),
              modelSnapshot: json({
                ...this.modelSnapshot(),
                startRequest: input,
              }),
              state: json({ mediaByStage, approvedStages: [], pairings: [] }),
            },
          });
          if (copies.length) await tx.runwayMedia.createMany({ data: copies });
          await tx.runwayCommand.create({
            data: {
              runId,
              kind: "start",
              payload: json({ ...input, actorUserId: userId }),
              requestKey: input.requestKey,
            },
          });
          await this.event(tx, runId, "queued", { stage: "prepare" });
        },
        { timeout: 30_000 },
      );
      if (resultId !== runId)
        await Promise.all(
          copies.map((copy) =>
            this.storage.delete(copy.objectKey).catch(() => undefined),
          ),
        );
      return this.run(userId, projectId, resultId);
    } catch (error) {
      await Promise.all(
        copies.map((copy) =>
          this.storage.delete(copy.objectKey).catch(() => undefined),
        ),
      );
      throw error;
    }
  }
  async action(
    userId: string,
    projectId: string,
    runId: string,
    body: unknown,
  ) {
    const input = parse(runwayActionSchema, body);
    await this.edit(userId, projectId);
    await this.database.$transaction(async (tx) => {
      await this.edit(userId, projectId, tx);
      const run = await this.lockRun(tx, projectId, runId);
      const existing = await tx.runwayCommand.findUnique({
        where: { runId_requestKey: { runId, requestKey: input.requestKey } },
      });
      if (existing) {
        assertSame(existing.payload, { ...input, actorUserId: userId });
        return;
      }
      if (run.version !== input.expectedVersion) throw conflict();
      const pending = object(run.pendingInput);
      if (
        run.cancelRequestedAt ||
        ["SUCCEEDED", "CANCELED"].includes(run.status)
      )
        throw conflict();
      if (input.kind === "retry") {
        if (!["FAILED", "NEEDS_ATTENTION"].includes(run.status))
          throw conflict();
      } else if (
        input.kind === "keep_silent" &&
        run.stage === "music" &&
        ["FAILED", "NEEDS_ATTENTION"].includes(run.status)
      ) {
        // A valid silent cut survives music failures and may be explicitly kept.
      } else {
        if (
          run.status !== "WAITING_INPUT" ||
          !input.interruptId ||
          pending.interruptId !== input.interruptId
        )
          throw conflict();
        if (input.kind === "pair" && pending.kind !== "pair") throw conflict();
        if (
          ["confirm", "continue", "edit"].includes(input.kind) &&
          pending.kind !== "confirm"
        )
          throw conflict();
        if (input.kind === "keep_silent" && run.stage !== "music")
          throw conflict();
      }
      if (input.kind === "edit") {
        const selected = await tx.runwayMedia.findFirst({
          where: {
            id: requiredValue(input.mediaId),
            runId,
            mimeType: { startsWith: "image/" },
          },
        });
        if (
          !selected ||
          !Array.isArray(pending.mediaIds) ||
          !pending.mediaIds.includes(selected.id)
        )
          throw new BadRequestException({
            code: "RUNWAY_INVALID_MEDIA",
            message: "只能修改当前审核阶段的图片",
          });
      }
      if (input.pairings) {
        const currentMedia = object(object(run.state).mediaByStage);
        const currentModels = Array.isArray(currentMedia.model)
          ? currentMedia.model
          : [];
        const currentClothes = Array.isArray(currentMedia.cloth)
          ? currentMedia.cloth
          : [];
        const media = await tx.runwayMedia.findMany({
          where: {
            runId,
            id: {
              in: input.pairings.flatMap((pair) => [
                pair.modelMediaId,
                pair.clothMediaId,
              ]),
            },
          },
        });
        if (
          new Set(input.pairings.map((pair) => pair.modelMediaId)).size !==
            input.pairings.length ||
          input.pairings.some(
            (pair) =>
              !currentModels.includes(pair.modelMediaId) ||
              !currentClothes.includes(pair.clothMediaId) ||
              !media.some(
                (item) =>
                  item.id === pair.modelMediaId && item.kind === "model",
              ) ||
              !media.some(
                (item) =>
                  item.id === pair.clothMediaId && item.kind === "cloth",
              ),
          )
        )
          throw new BadRequestException({
            code: "RUNWAY_INVALID_PAIRING",
            message: "请为每个出场位置选择有效的模特和服装",
          });
      }
      if (
        await tx.runwayCommand.count({
          where: { runId, status: { in: ["QUEUED", "RUNNING"] } },
        })
      )
        throw conflict();
      await tx.runwayCommand.create({
        data: {
          runId,
          kind: input.kind,
          requestKey: input.requestKey,
          payload: json({ ...input, actorUserId: userId }),
        },
      });
      await tx.runwayRun.update({
        where: { id: runId },
        data: { status: "QUEUED", version: { increment: 1 } },
      });
      await this.event(tx, runId, "queued", {
        action: input.kind,
        stage: run.stage,
      });
    });
    return this.run(userId, projectId, runId);
  }
  async cancel(
    userId: string,
    projectId: string,
    runId: string,
    body: unknown,
  ) {
    const input = parse(runwayCancelSchema, body);
    await this.edit(userId, projectId);
    await this.database.$transaction(async (tx) => {
      await this.edit(userId, projectId, tx);
      const run = await this.lockRun(tx, projectId, runId);
      const prior = await tx.runwayCommand.findUnique({
        where: { runId_requestKey: { runId, requestKey: input.requestKey } },
      });
      if (prior) {
        assertSame(prior.payload, { ...input, actorUserId: userId });
        if (prior.kind !== "cancel") throw conflict();
        return;
      }
      if (
        run.version !== input.expectedVersion ||
        ["SUCCEEDED", "CANCELED"].includes(run.status)
      )
        throw conflict();
      const active = await tx.runwayCommand.count({
        where: { runId, status: "RUNNING" },
      });
      await tx.runwayRun.update({
        where: { id: runId },
        data: {
          cancelRequestedAt: new Date(),
          version: { increment: 1 },
          ...(!active
            ? {
                status: "CANCELED",
                pendingInput: Prisma.DbNull,
                finishedAt: new Date(),
              }
            : {}),
        },
      });
      await tx.runwayCommand.updateMany({
        where: { runId, status: "QUEUED" },
        data: { status: "CANCELED", completedAt: new Date() },
      });
      await tx.runwayCommand.create({
        data: {
          runId,
          kind: "cancel",
          requestKey: input.requestKey,
          payload: json({ ...input, actorUserId: userId }),
          status: "SUCCEEDED",
          completedAt: new Date(),
        },
      });
      await this.event(tx, runId, "cancel_requested", {
        remoteCancellationConfirmed: false,
      });
    });
    return this.run(userId, projectId, runId);
  }
  async fork(userId: string, projectId: string, runId: string, body: unknown) {
    const input = parse(runwayForkSchema, body);
    await this.edit(userId, projectId);
    const source = await this.database.runwayRun.findFirst({
      where: { id: runId, projectId },
      include: { media: true },
    });
    if (!source) throw missing();
    const requestKey = `fork:${runId}:${input.requestKey}`;
    const prior = await this.database.runwayRun.findUnique({
      where: {
        showId_userId_requestKey: { showId: source.showId, userId, requestKey },
      },
    });
    if (prior) {
      assertSame(object(prior.modelSnapshot).forkRequest, input);
      return this.run(userId, projectId, prior.id);
    }
    if (source.version !== input.expectedVersion || input.stage === "finished")
      throw conflict();
    const currentIndex = RUNWAY_STAGES.indexOf(source.stage as RunwayStage);
    const targetIndex = RUNWAY_STAGES.indexOf(input.stage);
    if (targetIndex > currentIndex)
      throw new BadRequestException({
        code: "RUNWAY_STAGE_UNAVAILABLE",
        message: "该阶段尚未执行，无法从此处重跑",
      });
    const newId = randomUUID();
    const state = object(source.state);
    const byStage = object(state.mediaByStage);
    let selectedIndex: number | null = null;
    if (input.mediaId) {
      const selected = source.media.find((media) => media.id === input.mediaId);
      const ordered = byStage[input.stage];
      if (
        !["tryon", "storyboard", "video"].includes(input.stage) ||
        selected?.kind !== input.stage ||
        !Array.isArray(ordered) ||
        !ordered.includes(input.mediaId)
      ) {
        throw new BadRequestException({
          code: "RUNWAY_INVALID_FORK_MEDIA",
          message: "请选择该阶段当前使用的试衣、分镜或视频镜头",
        });
      }
      selectedIndex = ordered.indexOf(input.mediaId);
    }
    const preserved: Record<string, (string | null)[]> = {};
    for (const [kind, values] of Object.entries(byStage)) {
      if (!Array.isArray(values)) continue;
      const beforeTarget =
        RUNWAY_STAGES.indexOf(mediaStage[kind] ?? "finished") < targetIndex;
      const selectiveShots =
        selectedIndex !== null &&
        ["tryon", "storyboard", "video"].includes(kind);
      if (!beforeTarget && !selectiveShots) continue;
      preserved[kind] = values.map((value, index) =>
        selectiveShots && !beforeTarget && index === selectedIndex
          ? null
          : typeof value === "string"
            ? value
            : null,
      );
    }
    const retainedIds = new Set(
      Object.values(preserved).flatMap((values) =>
        values.filter((id): id is string => typeof id === "string"),
      ),
    );
    const retained =
      input.stage === "prepare"
        ? source.media.filter((media) => object(media.source).input === true)
        : [...retainedIds].flatMap((id) => {
            const media = source.media.find((item) => item.id === id);
            return media ? [media] : [];
          });
    const copies: Prisma.RunwayMediaCreateManyInput[] = [];
    const ids = new Map<string, string>();
    try {
      for (const media of retained) {
        const id = randomUUID();
        ids.set(media.id, id);
        const key = `runway/${projectId}/${newId}/${id}`;
        await this.storage.copy(media.objectKey, key);
        copies.push({
          id,
          runId: newId,
          projectId,
          kind: media.kind,
          objectKey: key,
          mimeType: media.mimeType,
          originalName: media.originalName,
          sizeBytes: media.sizeBytes,
          sha256: media.sha256,
          width: media.width,
          height: media.height,
          durationMs: media.durationMs,
          source: json({ ...object(media.source), parentMediaId: media.id }),
        });
      }
      let resultId: string = newId;
      await this.database.$transaction(async (tx) => {
        await this.edit(userId, projectId, tx);
        const current = await this.lockRun(tx, projectId, runId);
        const repeated = await tx.runwayRun.findUnique({
          where: {
            showId_userId_requestKey: {
              showId: source.showId,
              userId,
              requestKey,
            },
          },
        });
        if (repeated) {
          assertSame(object(repeated.modelSnapshot).forkRequest, input);
          resultId = repeated.id;
          return;
        }
        if (current.version !== input.expectedVersion) throw conflict();
        const mediaByStage: Record<string, (string | null)[]> = {};
        if (input.stage === "prepare") {
          for (const media of copies)
            (mediaByStage[media.kind] ??= []).push(requiredValue(media.id));
        } else {
          for (const [kind, values] of Object.entries(preserved))
            mediaByStage[kind] = values.map((id) =>
              id === null ? null : (ids.get(id) ?? null),
            );
        }
        const pairings =
          targetIndex > RUNWAY_STAGES.indexOf("pairing") &&
          Array.isArray(state.pairings)
            ? state.pairings.map((pair) => {
                const p = object(pair);
                return {
                  modelMediaId: ids.get(String(p.modelMediaId)),
                  clothMediaId: ids.get(String(p.clothMediaId)),
                };
              })
            : [];
        const approvedStages = Array.isArray(state.approvedStages)
          ? state.approvedStages.filter(
              (stage) =>
                typeof stage === "string" &&
                RUNWAY_STAGES.indexOf(stage as RunwayStage) < targetIndex,
            )
          : [];
        await tx.runwayRun.create({
          data: {
            id: newId,
            showId: source.showId,
            projectId,
            userId,
            requestKey,
            stage: input.stage,
            parentRunId: runId,
            parentStage: input.stage,
            inputSnapshot: json(source.inputSnapshot),
            modelSnapshot: json({
              ...object(source.modelSnapshot),
              forkRequest: input,
            }),
            state: json({
              mediaByStage,
              pairings,
              approvedStages,
              improvedPrompt: state.improvedPrompt,
              startStage: input.stage,
              ...(selectedIndex !== null
                ? { forkMediaId: input.mediaId, forkIndex: selectedIndex }
                : {}),
            }),
          },
        });
        if (copies.length) await tx.runwayMedia.createMany({ data: copies });
        await tx.runwayCommand.create({
          data: {
            runId: newId,
            kind: "start",
            payload: json({ ...input, actorUserId: userId }),
            requestKey: input.requestKey,
          },
        });
        await this.event(tx, newId, "queued", {
          stage: input.stage,
          parentRunId: runId,
        });
      });
      if (resultId !== newId)
        await Promise.all(
          copies.map((copy) =>
            this.storage.delete(copy.objectKey).catch(() => undefined),
          ),
        );
      return this.run(userId, projectId, resultId);
    } catch (error) {
      await Promise.all(
        copies.map((copy) =>
          this.storage.delete(copy.objectKey).catch(() => undefined),
        ),
      );
      throw error;
    }
  }
  async events(
    userId: string,
    projectId: string,
    runId: string,
    after: number,
  ): Promise<RunwayEventView[]> {
    await this.access.require(userId, projectId, "read");
    if (
      !(await this.database.runwayRun.findFirst({
        where: { id: runId, projectId },
        select: { id: true },
      }))
    )
      throw missing();
    const events = await this.database.runwayEvent.findMany({
      where: { runId, sequence: { gt: after } },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    return events.map((event) => ({
      id: event.id,
      runId,
      sequence: event.sequence,
      type: event.type,
      data: object(event.data),
      createdAt: event.createdAt.toISOString(),
    }));
  }
  async media(
    userId: string,
    projectId: string,
    id: string,
  ): Promise<RunwayMedia> {
    await this.access.require(userId, projectId, "read");
    const media = await this.database.runwayMedia.findFirst({
      where: { id, projectId },
    });
    if (!media) throw missing();
    return media;
  }
  private async lockRun(tx: Transaction, projectId: string, runId: string) {
    await tx.$queryRaw`SELECT id FROM runway_runs WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.runwayRun.findFirst({
      where: { id: runId, projectId },
    });
    if (!run) throw missing();
    return run;
  }
  private async event(
    tx: Transaction,
    runId: string,
    type: string,
    data: unknown,
  ) {
    const run = await tx.runwayRun.update({
      where: { id: runId },
      data: { eventSequence: { increment: 1 } },
    });
    await tx.runwayEvent.create({
      data: { runId, sequence: run.eventSequence, type, data: json(data) },
    });
  }
  private modelSnapshot() {
    return {
      mode: runwayProviderMode(),
      llmModel: process.env.RUNWAY_LLM_MODEL || "openai/gpt-4o",
      imageModel: process.env.RUNWAY_IMAGE_MODEL || "google/gemini-3-pro-image",
      visionModel: process.env.RUNWAY_VISION_MODEL || "gpt-4o",
      videoProvider: "jimeng",
      videoReqKey: process.env.RUNWAY_VIDEO_REQ_KEY || "jimeng_i2v_first_v30",
      musicModel: process.env.RUNWAY_MUSIC_MODEL || "music-2.6",
      pipelineVersion: "runway-v1",
    };
  }
  private async snapshot(
    userId: string,
    projectId: string,
    runId: string,
    source: RunwayDraft["inputs"][number],
  ): Promise<Prisma.RunwayMediaCreateManyInput> {
    let key: string;
    let name: string;
    let width: number | null;
    let height: number | null;
    if (source.sourceType === "file") {
      const file = await requireProjectFile(
        this.database,
        this.access,
        userId,
        source.sourceId,
        projectId,
      );
      if (file.status !== "READY" || !file.mimeType.startsWith("image/"))
        throw new BadRequestException({
          code: "RUNWAY_SOURCE_NOT_READY",
          message: "素材图片尚未处理完成",
        });
      key = file.objectKey;
      name = file.originalName;
      width = file.width;
      height = file.height;
    } else {
      let assetId = source.sourceId;
      if (source.sourceType === "style_revision") {
        const revision = await this.database.styleRevision.findFirst({
          where: { id: source.sourceId, style: { projectId } },
        });
        if (!revision) throw missing();
        assetId = revision.sourceAssetId;
      }
      const asset = await this.database.designAsset.findFirst({
        where: { id: assetId, projectId, archivedAt: null },
        include: { sourceFile: true },
      });
      if (!asset) throw missing();
      if (!asset.url.startsWith("s3://"))
        throw new BadRequestException({
          code: "RUNWAY_SOURCE_STORAGE_REQUIRED",
          message: "请先将该图片上传到项目私有存储，再用于服装秀",
        });
      key = asset.url.slice(5);
      name = `${asset.id}.png`;
      width = asset.width;
      height = asset.height;
    }
    const id = randomUUID();
    const objectKey = `runway/${projectId}/${runId}/inputs/${id}`;
    const copied = await this.storage.copy(key, objectKey, true);
    if (!copied.mimeType.startsWith("image/")) {
      await this.storage.delete(objectKey);
      throw new BadRequestException({
        code: "RUNWAY_INVALID_SOURCE",
        message: "服装秀输入必须为图片",
      });
    }
    return {
      id,
      runId,
      projectId,
      kind: source.kind,
      objectKey,
      originalName: name,
      ...copied,
      sha256: requiredValue(copied.sha256),
      width,
      height,
      source: json({ ...source, input: true }),
    };
  }
  private mediaView(media: RunwayMedia): RunwayMediaView {
    return {
      id: media.id,
      runId: media.runId,
      kind: media.kind as RunwayMediaView["kind"],
      mimeType: media.mimeType,
      originalName: media.originalName,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      source: object(media.source),
      createdAt: media.createdAt.toISOString(),
      contentUrl: `/api/projects/${encodeURIComponent(media.projectId)}/runway/media/${encodeURIComponent(media.id)}/content`,
    };
  }
  private runView(run: RunwayRun & { media: RunwayMedia[] }): RunwayRunView {
    return {
      id: run.id,
      showId: run.showId,
      projectId: run.projectId,
      status: run.status as RunwayRunView["status"],
      stage: run.stage as RunwayStage,
      version: run.version,
      inputSnapshot: runwayDraftSchema.parse(run.inputSnapshot),
      modelSnapshot: object(run.modelSnapshot),
      state: object(run.state),
      pendingInput: run.pendingInput
        ? (object(run.pendingInput) as RunwayRunView["pendingInput"])
        : null,
      parentRunId: run.parentRunId,
      parentStage: run.parentStage,
      cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      media: run.media.map((media) => this.mediaView(media)),
    };
  }
  private showView(
    show: RunwayShow & { runs: (RunwayRun & { media: RunwayMedia[] })[] },
  ): RunwayShowView {
    return {
      id: show.id,
      projectId: show.projectId,
      title: show.title,
      draft: runwayDraftSchema.parse(show.draft),
      version: show.version,
      archived: show.archived,
      createdAt: show.createdAt.toISOString(),
      updatedAt: show.updatedAt.toISOString(),
      runs: show.runs.map((run) => this.runView(run)),
    };
  }
}
