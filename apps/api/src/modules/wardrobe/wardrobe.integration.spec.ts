import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma, Prisma, DesignAssetOperation } from "@fashion/db";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { deriveMaskedProviderRgb } from "@fashion/ai";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { StudioService } from "../studio/studio.service";
import { WardrobeService } from "./wardrobe.service";

describe.skipIf(process.env.RUN_WARDROBE_LOCAL_INTEGRATION !== "1")(
  "衣架真实隔离 PostgreSQL / MinIO（不调用供应商）",
  () => {
    const storage = new S3FileStorage();
    const access = new ProjectAccessPolicy(prisma);
    const generation = {
      createForWardrobe: vi.fn(),
      createFromAgent: vi.fn(),
      resumeQueuedTask: vi.fn(),
    };
    const service = new WardrobeService(
      prisma,
      access,
      storage,
      generation as never,
    );
    let userId: string;
    let viewerId: string;
    let editorId: string;
    let workspaceId: string;
    let projectId: string;
    let otherProjectId: string;
    let assetId: string;
    let opaqueAssetId: string;
    let foreignAssetId: string;
    const keys: string[] = [];
    const requestKey = () => randomUUID();
    const gate = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const source = () => ({
      requestKey: requestKey(),
      sourceAssetId: assetId,
      name: "原始上装",
      category: "top",
      sourceKind: "isolated",
      mode: "existing",
    });
    async function asset(project: string, opaque = false) {
      const id = randomUUID();
      const key = `wardrobe-verify/${id}.png`;
      const center = await sharp({
        create: { width: 24, height: 24, channels: 4, background: "green" },
      })
        .png()
        .toBuffer();
      const bytes = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: opaque ? "white" : { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: center, top: 20, left: 20 }])
        .png()
        .toBuffer();
      await storage.uploadBuffer(
        key,
        bytes,
        "image/png",
        createHash("sha256").update(bytes).digest("base64"),
      );
      keys.push(key);
      await prisma.designAsset.create({
        data: {
          id,
          rootAssetId: id,
          projectId: project,
          operation: DesignAssetOperation.GENERATED,
          url: `s3://${key}`,
          width: 64,
          height: 64,
        },
      });
      return id;
    }
    async function materialImage(bytes: Buffer, project = projectId) {
      const id = randomUUID();
      const key = `wardrobe-verify/${id}.png`;
      await storage.uploadBuffer(
        key,
        bytes,
        "image/png",
        createHash("sha256").update(bytes).digest("base64"),
      );
      keys.push(key);
      return prisma.designAsset.create({
        data: {
          id,
          projectId: project,
          rootAssetId: id,
          operation: DesignAssetOperation.IMPORTED,
          url: `s3://${key}`,
        },
      });
    }
    async function materialFixture(edgeEdit = false) {
      const pixels = Buffer.alloc(256 * 256 * 4);
      const maskPixels = Buffer.alloc(pixels.length, 255);
      for (let y = 32; y < 224; y++)
        for (let x = 64; x < 192; x++) {
          const offset = (y * 256 + x) * 4;
          pixels.set([240, 230, 210, 253], offset);
          if (x >= 80 && x < 112 && y >= 64 && y < 192)
            maskPixels[offset + 3] = x === 80 ? 128 : 0;
        }
      if (edgeEdit) {
        maskPixels.fill(0);
        maskPixels[3] = 255;
        pixels[(100 * 256 + 100) * 4 + 3] = 120;
      }
      const rawPixels = Buffer.from(pixels);
      for (let offset = 0; offset < pixels.length; offset += 4)
        if (maskPixels[offset + 3] !== 255)
          rawPixels.set(edgeEdit ? [0, 0, 0, 255] : [80, 240, 40, 255], offset);
      const png = (data: Buffer) =>
        sharp(data, { raw: { width: 256, height: 256, channels: 4 } })
          .png()
          .toBuffer();
      const [sourceBytes, rawBytes, maskBytes] = await Promise.all([
        png(pixels),
        png(rawPixels),
        png(maskPixels),
      ]);
      const [original, raw, mask] = await Promise.all([
        materialImage(sourceBytes),
        materialImage(rawBytes),
        materialImage(maskBytes),
      ]);
      const complete = await prisma.generationTask.create({
        data: {
          userId,
          projectId,
          taskType: "i2i",
          status: "SUCCEEDED",
          input: {},
        },
      });
      await prisma.wardrobePreparation.create({
        data: {
          userId,
          projectId,
          requestKey: requestKey(),
          fingerprint: randomUUID(),
          taskId: complete.id,
          input: {
            ...source(),
            sourceAssetId: assetId,
            sourceKind: "sketch",
            mode: "complete",
          },
        },
      });
      await prisma.designAsset.update({
        where: { id: original.id },
        data: {
          parentAssetId: assetId,
          rootAssetId: assetId,
          generationTaskId: complete.id,
        },
      });
      const frozenRequest = {
        referenceImageUrl: original.url,
        referenceImageUrls: [original.url],
        maskImageUrl: mask.url,
      };
      const task = await prisma.generationTask.create({
        data: {
          userId,
          projectId,
          taskType: "inpaint",
          status: "SUCCEEDED",
          parentAssetId: original.id,
          input: {},
          compiledPrompt: {
            request: frozenRequest,
            notes: ["wardrobe-material-alpha-probe:v1"],
          },
        },
      });
      await prisma.designAsset.update({
        where: { id: raw.id },
        data: {
          parentAssetId: original.id,
          rootAssetId: assetId,
          generationTaskId: task.id,
        },
      });
      return {
        original,
        raw,
        mask,
        task,
        frozenRequest,
        sourceBytes,
        rawBytes,
        maskBytes,
        pixels,
        maskPixels,
        input: {
          requestKey: requestKey(),
          sourceAssetId: original.id,
          rawAssetId: raw.id,
          maskAssetId: mask.id,
          name: "浅色蕾丝候选",
          category: "top",
        },
      };
    }
    async function materialSideFixture() {
      const fixture = await materialFixture();
      const frontPreparation = await service.prepare(
        userId,
        projectId,
        source(),
      );
      const front = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: frontPreparation.id,
        assetId,
        name: "透明侧图测试正面",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const side = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId: fixture.original.id,
        presentation: {
          view: "side",
          revisionId: front.currentRevision.id,
          orientation: "right",
        },
      });
      return {
        ...fixture,
        front,
        frontPreparation,
        side,
        input: { ...fixture.input, sidePreparationId: side.id },
      };
    }
    async function markCorrection(
      fixture: Awaited<ReturnType<typeof materialFixture>>,
    ) {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          compiledPrompt: {
            request: fixture.frozenRequest,
            notes: [
              "wardrobe-material-alpha-probe:v1",
              "wardrobe-masked-correction-probe:v1",
            ],
          },
        },
      });
    }
    beforeAll(async () => {
      const url = new URL(
        process.env.WARDROBE_TEST_DATABASE_URL ?? "http://invalid",
      );
      if (
        process.env.DATABASE_URL !== process.env.WARDROBE_TEST_DATABASE_URL ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !url.searchParams.get("schema")?.startsWith("wardrobe_verify_")
      )
        throw new Error("测试必须使用独立本机 wardrobe_verify_ schema");
      if (
        !process.env.S3_ENDPOINT ||
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(process.env.S3_ENDPOINT).hostname,
        )
      )
        throw new Error("测试只允许本机 MinIO");
      userId = (
        await prisma.user.create({
          data: { email: `wardrobe-${randomUUID()}@example.com` },
        })
      ).id;
      viewerId = (
        await prisma.user.create({
          data: { email: `wardrobe-viewer-${randomUUID()}@example.com` },
        })
      ).id;
      editorId = (
        await prisma.user.create({
          data: { email: `wardrobe-editor-${randomUUID()}@example.com` },
        })
      ).id;
      workspaceId = (
        await prisma.workspace.create({
          data: { name: "衣架隔离验证", ownerId: userId },
        })
      ).id;
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: viewerId, role: "VIEWER" },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: editorId, role: "EDITOR" },
      });
      projectId = (
        await prisma.project.create({
          data: { name: "衣架项目", wsId: workspaceId },
        })
      ).id;
      otherProjectId = (
        await prisma.project.create({
          data: { name: "其他项目", wsId: workspaceId },
        })
      ).id;
      assetId = await asset(projectId);
      opaqueAssetId = await asset(projectId, true);
      foreignAssetId = await asset(otherProjectId);
    });
    afterAll(async () => {
      service.onModuleDestroy();
      if (projectId) {
        const derived = await prisma.designAsset.findMany({
          where: { projectId, url: { startsWith: "s3://wardrobe/" } },
        });
        keys.push(...derived.map((item) => item.url.slice(5)));
        await prisma.wardrobeTryOn.deleteMany({ where: { projectId } });
        await prisma.wardrobeOutfit.deleteMany({ where: { projectId } });
        await prisma.wardrobeItem.deleteMany({ where: { projectId } });
      }
      if (workspaceId)
        await prisma.workspace.delete({ where: { id: workspaceId } });
      if (userId) await prisma.user.delete({ where: { id: userId } });
      if (viewerId) await prisma.user.delete({ where: { id: viewerId } });
      if (editorId) await prisma.user.delete({ where: { id: editorId } });
      for (const key of keys) await storage.delete(key);
      await prisma.$disconnect();
    });
    it("从透明原图确认单品、修订、不可变搭配与真实私有参考图；原图不覆盖", async () => {
      const original = await prisma.designAsset.findUniqueOrThrow({
        where: { id: assetId },
      });
      const preparationInput = source();
      const prepared = await service.prepare(
        userId,
        projectId,
        preparationInput,
      );
      expect(prepared.status).toBe("ready");
      expect(
        (await service.prepare(userId, projectId, preparationInput)).id,
      ).toBe(prepared.id);
      const confirm = {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId,
        name: "上装",
        category: "top",
        display: "hanger",
        reviewed: true,
      };
      const item = await service.confirm(userId, projectId, confirm);
      expect(item.currentRevision.imageBounds).toEqual({
        width: 64,
        height: 64,
        x: 20,
        y: 20,
        contentWidth: 24,
        contentHeight: 24,
      });
      expect((await service.confirm(userId, projectId, confirm)).id).toBe(
        item.id,
      );
      const outfitInput = {
        requestKey: requestKey(),
        name: "今日穿搭",
        items: [{ revisionId: item.currentRevision.id, layer: 0 }],
      };
      const outfit = await service.saveOutfit(userId, projectId, outfitInput);
      expect(outfit.currentSnapshot.items[0]?.imageBounds).toEqual(
        item.currentRevision.imageBounds,
      );
      const revised = await service.confirm(userId, projectId, {
        ...confirm,
        requestKey: requestKey(),
        itemId: item.id,
        expectedVersion: item.version,
        name: "修订上装",
      });
      expect(revised.version).toBe(2);
      expect(
        (
          await service.getSnapshot(
            userId,
            projectId,
            outfit.currentSnapshot.id,
          )
        ).items[0]?.name,
      ).toBe("上装");
      const reference = await service.reference(
        userId,
        projectId,
        outfit.currentSnapshot.id,
        { requestKey: requestKey() },
      );
      expect(reference.referenceAssetId).toBeTruthy();
      if (!reference.referenceAssetId) throw new Error("缺少参考图");
      const saved = await prisma.designAsset.findUniqueOrThrow({
        where: { id: reference.referenceAssetId },
      });
      expect((await storage.head(saved.url.slice(5))).contentType).toBe(
        "image/png",
      );
      expect(
        await prisma.designAsset.findUniqueOrThrow({ where: { id: assetId } }),
      ).toEqual(original);
      await expect(
        service.archive(userId, projectId, item.id, {
          requestKey: requestKey(),
          expectedVersion: 1,
          archived: true,
        }),
      ).rejects.toThrow("修改");
      const archived = await service.archive(userId, projectId, item.id, {
        requestKey: requestKey(),
        expectedVersion: 2,
        archived: true,
      });
      expect(archived.archived).toBe(true);
      await expect(
        service.saveOutfit(userId, projectId, {
          ...outfitInput,
          requestKey: requestKey(),
        }),
      ).rejects.toThrow("归档");
      expect(
        (
          await service.getSnapshot(
            userId,
            projectId,
            outfit.currentSnapshot.id,
          )
        ).items,
      ).toHaveLength(1);
      const retained = await service.saveOutfit(userId, projectId, {
        ...outfitInput,
        requestKey: requestKey(),
        outfitId: outfit.id,
        expectedVersion: outfit.version,
        name: "保留历史归档单品",
      });
      expect(retained.currentSnapshot.items[0]?.id).toBe(
        item.currentRevision.id,
      );
      expect(generation.createForWardrobe).not.toHaveBeenCalled();
    });
    it("只读主体边界合并重复存储读取，但缓存不绕过权限与归档；旧修订可补齐", async () => {
      const sourceAssetId = await asset(projectId);
      const original = await prisma.designAsset.findUniqueOrThrow({
        where: { id: sourceAssetId },
      });
      const prepared = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId,
      });
      const item = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId: sourceAssetId,
        name: "透明留白单品",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const expected = {
        width: 64,
        height: 64,
        x: 20,
        y: 20,
        contentWidth: 24,
        contentHeight: 24,
      };
      expect(item.currentRevision.imageBounds).toEqual(expected);
      const revision = await prisma.wardrobeRevision.findUniqueOrThrow({
        where: { id: item.currentRevision.id },
      });
      const legacyPayload = {
        ...(revision.payload as Record<string, unknown>),
      };
      delete legacyPayload.imageBounds;
      await prisma.wardrobeRevision.update({
        where: { id: revision.id },
        data: { payload: JSON.parse(JSON.stringify(legacyPayload)) },
      });
      expect(
        (await service.summary(userId, projectId)).items.find(
          (value) => value.id === item.id,
        )?.currentRevision.imageBounds,
      ).toBeUndefined();
      const calls = generation.createForWardrobe.mock.calls.length;
      const taskCount = await prisma.generationTask.count({
        where: { projectId },
      });
      const read = vi.spyOn(storage, "readPrefix");
      try {
        expect(
          await Promise.all([
            service.getImageBounds(userId, projectId, sourceAssetId),
            service.getImageBounds(viewerId, projectId, sourceAssetId),
          ]),
        ).toEqual([expected, expected]);
        expect(
          await service.getImageBounds(userId, projectId, sourceAssetId),
        ).toEqual(expected);
        expect(read).toHaveBeenCalledTimes(1);
        await expect(
          service.getImageBounds(randomUUID(), projectId, sourceAssetId),
        ).rejects.toThrow("无权访问");
        await expect(
          service.getImageBounds(userId, otherProjectId, sourceAssetId),
        ).rejects.toThrow("素材");
        await prisma.designAsset.update({
          where: { id: sourceAssetId },
          data: { archivedAt: new Date() },
        });
        await expect(
          service.getImageBounds(userId, projectId, sourceAssetId),
        ).rejects.toThrow("素材");
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        read.mockRestore();
        await prisma.designAsset.update({
          where: { id: sourceAssetId },
          data: { archivedAt: null },
        });
      }
      await expect(
        service.getImageBounds(userId, projectId, opaqueAssetId),
      ).rejects.toThrow("透明");
      expect(generation.createForWardrobe.mock.calls).toHaveLength(calls);
      expect(await prisma.generationTask.count({ where: { projectId } })).toBe(
        taskCount,
      );
      expect(
        await prisma.designAsset.findUniqueOrThrow({
          where: { id: sourceAssetId },
        }),
      ).toEqual(original);
    });
    it("拒绝越权、跨项目、假透明及不属于本次准备的候选", async () => {
      await expect(
        service.prepare(viewerId, projectId, source()),
      ).rejects.toThrow();
      await expect(
        service.prepare(userId, projectId, {
          ...source(),
          sourceAssetId: foreignAssetId,
        }),
      ).rejects.toThrow("项目");
      expect(
        (
          await service.prepare(userId, projectId, {
            ...source(),
            sourceAssetId: opaqueAssetId,
          })
        ).status,
      ).toBe("failed");
      const prepared = await service.prepare(userId, projectId, source());
      await expect(
        service.confirm(userId, projectId, {
          requestKey: requestKey(),
          preparationId: prepared.id,
          assetId: opaqueAssetId,
          name: "假候选",
          category: "top",
          display: "hanger",
          reviewed: true,
        }),
      ).rejects.toThrow("真实候选");
    });
    it("并发相同请求只创建一份单品；不同内容复用键明确冲突", async () => {
      const prepared = await service.prepare(userId, projectId, source());
      const input = {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId,
        name: "并发单品",
        category: "hat",
        display: "shelf",
        reviewed: true,
      };
      const [a, b] = await Promise.all([
        service.confirm(userId, projectId, input),
        service.confirm(userId, projectId, input),
      ]);
      expect(a.id).toBe(b.id);
      await expect(
        service.confirm(userId, projectId, { ...input, name: "不同内容" }),
      ).rejects.toThrow("请求标识");
    });
    it("生成任务仅由显式操作创建，取消和审核失败不会伪装成成功", async () => {
      generation.createForWardrobe.mockImplementation(
        async (_userId, input, key) => {
          const id = createHash("sha256")
            .update(`${userId}\0${key}`)
            .digest("hex");
          await prisma.generationTask.upsert({
            where: { id },
            update: {},
            create: {
              id,
              userId,
              projectId,
              taskType: "i2i",
              input,
              status: "QUEUED",
            },
          });
          return { taskId: id };
        },
      );
      const prepared = await service.prepare(userId, projectId, {
        ...source(),
        mode: "extract",
      });
      expect(prepared.status).toBe("queued");
      if (!prepared.taskId) throw new Error("缺少生成任务");
      await prisma.generationTask.update({
        where: { id: prepared.taskId },
        data: { status: "CANCELED" },
      });
      expect(
        (await service.summary(userId, projectId)).preparations.find(
          (item) => item.id === prepared.id,
        )?.status,
      ).toBe("canceled");
      await prisma.generationTask.update({
        where: { id: prepared.taskId },
        data: { status: "MODERATION_FAILED" },
      });
      expect(
        (await service.summary(userId, projectId)).preparations.find(
          (item) => item.id === prepared.id,
        )?.status,
      ).toBe("failed");
    });

    it("任务已接纳但派发报错仍关联原任务，重启补派不重复创建", async () => {
      generation.createForWardrobe.mockImplementation(
        async (_userId, input, key) => {
          const id = createHash("sha256")
            .update(`${userId}\0${key}`)
            .digest("hex");
          await prisma.generationTask.upsert({
            where: { id },
            update: {},
            create: {
              id,
              userId,
              projectId,
              taskType: "i2i",
              input,
              status: "QUEUED",
            },
          });
          throw new Error("mock queue unavailable after durable admission");
        },
      );
      const prepared = await service.prepare(userId, projectId, {
        ...source(),
        mode: "extract",
      });
      expect(prepared.status).toBe("queued");
      expect(prepared.error).toBeNull();
      if (!prepared.taskId) throw new Error("接纳后任务关联丢失");
      await prisma.wardrobePreparation.update({
        where: { id: prepared.id },
        data: { taskId: null, createdAt: new Date(Date.now() - 60_000) },
      });
      await service.recoverPending();
      expect(
        (
          await prisma.wardrobePreparation.findUniqueOrThrow({
            where: { id: prepared.id },
          })
        ).taskId,
      ).toBe(prepared.taskId);
      expect(
        await prisma.generationTask.count({ where: { id: prepared.taskId } }),
      ).toBe(1);
    });

    it.each([
      ["prepare", "failure-first"],
      ["prepare", "success-first"],
      ["prepare-existing", "failure-first"],
      ["prepare-existing", "success-first"],
      ["tryOn", "failure-first"],
      ["tryOn", "success-first"],
    ] as const)("%s 并发 %s 不让失败覆盖已接纳任务", async (kind, order) => {
      const entered = gate();
      const allowSuccess = gate();
      const failureWrite = gate();
      const allowFailureWrite = gate();
      let acceptedTaskId: string | null = null;
      const expectedStatus = kind === "prepare-existing" ? "ready" : "queued";
      const readPrefix = storage.readPrefix.bind(storage);
      const storageSpy =
        kind === "prepare-existing"
          ? vi
              .spyOn(storage, "readPrefix")
              .mockImplementationOnce(async (...args) => {
                entered.resolve();
                await allowSuccess.promise;
                return readPrefix(...args);
              })
              .mockRejectedValueOnce(new Error("并发私有图片读取暂时失败"))
          : undefined;
      if (kind !== "prepare-existing")
        generation.createForWardrobe
          .mockImplementationOnce(async (_userId, input, key) => {
            entered.resolve();
            await allowSuccess.promise;
            acceptedTaskId = createHash("sha256")
              .update(`${userId}\0${key}`)
              .digest("hex");
            await prisma.generationTask.create({
              data: {
                id: acceptedTaskId,
                userId,
                projectId,
                taskType: "i2i",
                input,
                status: "QUEUED",
              },
            });
            return { taskId: acceptedTaskId };
          })
          .mockRejectedValueOnce(new Error("并发请求暂时失败"));
      const delayFailure = async <T>(write: () => PromiseLike<T>) => {
        failureWrite.resolve();
        await allowFailureWrite.promise;
        return await write();
      };
      const prepUpdate = prisma.wardrobePreparation.updateMany.bind(
        prisma.wardrobePreparation,
      );
      const tryOnUpdate = prisma.wardrobeTryOn.updateMany.bind(
        prisma.wardrobeTryOn,
      );
      const prepSpy = vi
        .spyOn(prisma.wardrobePreparation, "updateMany")
        .mockImplementation(
          (args) =>
            delayFailure(() => prepUpdate(args)) as ReturnType<
              typeof prepUpdate
            >,
        );
      const tryOnSpy = vi
        .spyOn(prisma.wardrobeTryOn, "updateMany")
        .mockImplementation(
          (args) =>
            delayFailure(() => tryOnUpdate(args)) as ReturnType<
              typeof tryOnUpdate
            >,
        );
      const outfit = (await service.summary(userId, projectId)).outfits[0];
      if (!outfit) throw new Error("缺少测试搭配");
      const input =
        kind !== "tryOn"
          ? {
              ...source(),
              mode: kind === "prepare-existing" ? "existing" : "extract",
            }
          : {
              requestKey: requestKey(),
              snapshotId: outfit.currentSnapshot.id,
              modelAssetId: opaqueAssetId,
            };
      const start = () =>
        kind !== "tryOn"
          ? service.prepare(userId, projectId, input)
          : service.tryOn(userId, projectId, input);
      const success = start();
      let failure: ReturnType<typeof start> | undefined;
      try {
        await entered.promise;
        failure = start();
        await failureWrite.promise;
        if (order === "failure-first") {
          allowFailureWrite.resolve();
          expect((await failure).status).toBe("failed");
          allowSuccess.resolve();
        } else {
          allowSuccess.resolve();
          expect((await success).status).toBe(expectedStatus);
          allowFailureWrite.resolve();
          const response = await failure;
          expect(response.status).toBe(expectedStatus);
          expect(response.error).toBeNull();
          expect(response.taskId ?? null).toBe(acceptedTaskId);
        }
        const response = await success;
        expect(response.status).toBe(expectedStatus);
        expect(response.error).toBeNull();
        const stored =
          kind !== "tryOn"
            ? await prisma.wardrobePreparation.findUniqueOrThrow({
                where: { id: response.id },
              })
            : await prisma.wardrobeTryOn.findUniqueOrThrow({
                where: { id: response.id },
              });
        expect(stored.taskId).toBe(acceptedTaskId);
        expect(stored.error).toBeNull();
        expect((await start()).status).toBe(expectedStatus);
        if (acceptedTaskId) {
          expect(
            await prisma.generationTask.count({
              where: { id: acceptedTaskId },
            }),
          ).toBe(1);
        } else {
          expect(stored).toMatchObject({ ready: true });
        }
      } finally {
        allowSuccess.resolve();
        allowFailureWrite.resolve();
        await Promise.allSettled([success, ...(failure ? [failure] : [])]);
        prepSpy.mockRestore();
        tryOnSpy.mockRestore();
        storageSpy?.mockRestore();
      }
    });

    it("临时试穿快照不进入已保存搭配；重复请求幂等，旧快照继续可追溯", async () => {
      const before = await service.summary(userId, projectId);
      const outfit = before.outfits[0];
      if (!outfit) throw new Error("缺少测试搭配");
      const calls = generation.createForWardrobe.mock.calls.length;
      const input = {
        requestKey: requestKey(),
        name: "当前未保存搭配",
        baseSnapshotId: outfit.currentSnapshot.id,
        items: outfit.currentSnapshot.items.map((item) => ({
          revisionId: item.id,
          layer: item.layer,
          wearNote: item.wearNote,
        })),
      };
      const snapshot = await service.saveTrialSnapshot(
        userId,
        projectId,
        input,
      );
      expect(
        (await service.saveTrialSnapshot(userId, projectId, input)).id,
      ).toBe(snapshot.id);
      expect(
        (await service.summary(userId, projectId)).outfits.map(
          (item) => item.id,
        ),
      ).toEqual(before.outfits.map((item) => item.id));
      const reference = await service.reference(
        userId,
        projectId,
        snapshot.id,
        { requestKey: requestKey() },
      );
      expect(reference.referenceAssetId).toBeTruthy();
      const next = await service.saveTrialSnapshot(userId, projectId, {
        ...input,
        requestKey: requestKey(),
        name: "后来修改的搭配",
      });
      expect(next.id).not.toBe(snapshot.id);
      expect(
        (await service.getSnapshot(userId, projectId, snapshot.id))
          .referenceAssetId,
      ).toBe(reference.referenceAssetId);
      expect(generation.createForWardrobe.mock.calls).toHaveLength(calls);
    });

    it("静态试穿传入完整不可变搭配并保留明确原始模特；读取和改名不生成", async () => {
      generation.createForWardrobe.mockImplementation(
        async (_userId, input, key) => {
          const id = createHash("sha256")
            .update(`${userId}\0${key}`)
            .digest("hex");
          await prisma.generationTask.upsert({
            where: { id },
            update: {},
            create: {
              id,
              userId,
              projectId,
              taskType: "i2i",
              input,
              status: "QUEUED",
            },
          });
          return { taskId: id };
        },
      );
      const before = generation.createForWardrobe.mock.calls.length;
      const summary = await service.summary(userId, projectId);
      const outfit = summary.outfits[0];
      if (!outfit) throw new Error("缺少测试搭配");
      const renamed = await service.saveOutfit(userId, projectId, {
        requestKey: requestKey(),
        outfitId: outfit.id,
        expectedVersion: outfit.version,
        name: "试穿前改名",
        items: outfit.currentSnapshot.items.map((item) => ({
          revisionId: item.id,
          layer: item.layer,
          wearNote: item.wearNote,
        })),
      });
      expect(generation.createForWardrobe.mock.calls).toHaveLength(before);
      const input = {
        requestKey: requestKey(),
        snapshotId: renamed.currentSnapshot.id,
        modelAssetId: opaqueAssetId,
      };
      const run = await service.tryOn(userId, projectId, input);
      expect(run.status).toBe("queued");
      expect(generation.createForWardrobe).toHaveBeenLastCalledWith(
        userId,
        expect.objectContaining({
          projectId,
          sourceAssetIds: [
            opaqueAssetId,
            ...renamed.currentSnapshot.items.map((item) => item.assetId),
          ],
          snapshotId: renamed.currentSnapshot.id,
        }),
        expect.any(String),
      );
      expect((await service.tryOn(userId, projectId, input)).taskId).toBe(
        run.taskId,
      );
      expect(generation.createForWardrobe.mock.calls).toHaveLength(before + 1);
      await expect(
        service.getSnapshot(userId, otherProjectId, renamed.currentSnapshot.id),
      ).rejects.toThrow("快照不存在");
    });

    it("侧挂候选和托面深度独立核对，展示修订不替换试穿正面、旧搭配或原始设计", async () => {
      const prepared = await service.prepare(userId, projectId, source());
      const item = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId,
        name: "侧挂验证上衣",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const front = item.currentRevision;
      const oldSnapshot = await service.saveTrialSnapshot(userId, projectId, {
        requestKey: requestKey(),
        name: "原有搭配",
        items: [{ revisionId: front.id, layer: 0 }],
      });
      const sideAssetId = await asset(projectId);
      const calls = generation.createForWardrobe.mock.calls.length;
      const side = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId: sideAssetId,
        presentation: {
          view: "side",
          revisionId: front.id,
          orientation: "right",
        },
      });
      expect(side).toMatchObject({
        status: "ready",
        presentation: { revisionId: front.id },
      });
      await expect(
        service.confirm(userId, projectId, {
          requestKey: requestKey(),
          preparationId: side.id,
          assetId: sideAssetId,
          name: "错误前图",
          category: "top",
          display: "hanger",
          reviewed: true,
        }),
      ).rejects.toThrow("不能替换试穿正面图");
      const input = {
        requestKey: requestKey(),
        expectedVersion: item.version,
        revisionId: front.id,
        frontAnchor: { x: 0.51, y: 0.176 },
        supportWidthRatio: 0.48,
        shelfDepthRatio: 48 / 140,
        sideDisplay: {
          preparationId: side.id,
          assetId: sideAssetId,
          anchor: { x: 0.45, y: 0.1 },
          reviewed: true,
        },
      };
      await expect(
        service.updatePresentation(viewerId, projectId, item.id, input),
      ).rejects.toThrow();
      await expect(
        service.updatePresentation(userId, otherProjectId, item.id, input),
      ).rejects.toThrow("不存在");
      const updated = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        input,
      );
      expect(updated.currentRevision).toMatchObject({
        assetId: front.assetId,
        sourceAssetId: front.sourceAssetId,
        anchor: input.frontAnchor,
        presentation: {
          supportWidthRatio: 0.48,
          shelfDepthRatio: 48 / 140,
          sideDisplay: {
            assetId: sideAssetId,
            source: "uploaded",
            reviewed: true,
            orientation: "right",
          },
        },
      });
      expect(updated.currentRevision.id).not.toBe(front.id);
      expect(
        updated.revisions.find((revision) => revision.id === front.id)
          ?.presentation,
      ).toBeUndefined();
      expect(
        (await service.updatePresentation(userId, projectId, item.id, input))
          .currentRevision.id,
      ).toBe(updated.currentRevision.id);
      const previous = await service.getSnapshot(
        userId,
        projectId,
        oldSnapshot.id,
      );
      expect(previous.items[0]?.presentation).toBeUndefined();
      expect(previous.items[0]?.anchor).toEqual(front.anchor);
      const snapshot = await service.saveTrialSnapshot(userId, projectId, {
        requestKey: requestKey(),
        name: "展示更新后的搭配",
        items: [{ revisionId: updated.currentRevision.id, layer: 0 }],
      });
      expect(snapshot.items[0]?.assetId).toBe(front.assetId);
      expect(snapshot.items[0]?.presentation?.sideDisplay?.assetId).toBe(
        sideAssetId,
      );
      expect(snapshot.items[0]?.presentation?.shelfDepthRatio).toBe(48 / 140);
      expect(generation.createForWardrobe.mock.calls).toHaveLength(calls);
      await service.tryOn(userId, projectId, {
        requestKey: requestKey(),
        snapshotId: snapshot.id,
        modelAssetId: opaqueAssetId,
      });
      expect(generation.createForWardrobe).toHaveBeenLastCalledWith(
        userId,
        expect.objectContaining({
          sourceAssetIds: [opaqueAssetId, front.assetId],
        }),
        expect.any(String),
      );
      await expect(
        service.updatePresentation(userId, projectId, item.id, {
          ...input,
          requestKey: requestKey(),
        }),
      ).rejects.toThrow("单品已更新");
      const calibratedWithSide = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: updated.version,
          revisionId: updated.currentRevision.id,
          frontAnchor: { x: 0.5, y: 0.2 },
        },
      );
      expect(calibratedWithSide.currentRevision.presentation).toEqual(
        updated.currentRevision.presentation,
      );
      expect(calibratedWithSide.currentRevision.assetId).toBe(front.assetId);
      const deeperShelf = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: calibratedWithSide.version,
          revisionId: calibratedWithSide.currentRevision.id,
          shelfDepthRatio: 0.4,
        },
      );
      expect(deeperShelf.version).toBe(calibratedWithSide.version + 1);
      expect(deeperShelf.currentRevision.id).not.toBe(
        calibratedWithSide.currentRevision.id,
      );
      expect(deeperShelf.currentRevision).toMatchObject({
        assetId: front.assetId,
        sourceAssetId: front.sourceAssetId,
        anchor: calibratedWithSide.currentRevision.anchor,
        presentation: {
          ...calibratedWithSide.currentRevision.presentation,
          shelfDepthRatio: 0.4,
        },
      });
      expect(
        (await service.getSnapshot(userId, projectId, snapshot.id)).items[0]
          ?.presentation?.shelfDepthRatio,
      ).toBe(48 / 140);
      expect(
        deeperShelf.revisions.find(
          (revision) => revision.id === calibratedWithSide.currentRevision.id,
        )?.presentation?.shelfDepthRatio,
      ).toBe(48 / 140);
      const removed = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: deeperShelf.version,
          revisionId: deeperShelf.currentRevision.id,
          sideDisplay: null,
        },
      );
      expect(removed.currentRevision.presentation?.sideDisplay).toBeUndefined();
      expect(
        (await service.getSnapshot(userId, projectId, snapshot.id)).items[0]
          ?.presentation?.sideDisplay?.assetId,
      ).toBe(sideAssetId);
      const calibration = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: removed.version,
          revisionId: removed.currentRevision.id,
          frontAnchor: { x: 0.5, y: 0.21 },
        },
      );
      expect(calibration.currentRevision).toMatchObject({
        assetId: front.assetId,
        anchor: { x: 0.5, y: 0.21 },
        presentation: { supportWidthRatio: 0.48, shelfDepthRatio: 0.4 },
      });
      await expect(
        service.updatePresentation(userId, projectId, item.id, {
          requestKey: requestKey(),
          expectedVersion: calibration.version,
          revisionId: calibration.currentRevision.id,
          frontAnchor: { x: 0.5, y: 1.01 },
        }),
      ).rejects.toThrow();
    });

    it("确认时拒绝循环或跨项目的祖先来源链，不以未核对来源建立单品", async () => {
      const cyclic = await asset(projectId);
      await prisma.designAsset.update({
        where: { id: cyclic },
        data: { parentAssetId: cyclic },
      });
      const foreignParent = await asset(projectId);
      await prisma.designAsset.update({
        where: { id: foreignParent },
        data: { parentAssetId: foreignAssetId },
      });
      for (const id of [cyclic, foreignParent]) {
        const prepared = await service.prepare(userId, projectId, {
          ...source(),
          sourceAssetId: id,
        });
        await expect(
          service.confirm(userId, projectId, {
            requestKey: requestKey(),
            preparationId: prepared.id,
            assetId: id,
            name: "异常来源",
            category: "top",
            display: "hanger",
            reviewed: true,
          }),
        ).rejects.toThrow("来源链");
        expect(
          await prisma.wardrobeRevision.count({
            where: { assetId: id },
          }),
        ).toBe(0);
      }
    });

    it("侧挂局部修正保留原候选来源，只接受相同修订、方向和已完成的候选", async () => {
      const prepared = await service.prepare(userId, projectId, source());
      const item = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId,
        name: "侧挂透明修正",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const originalAssetId = await asset(projectId);
      const presentation = {
        view: "side",
        revisionId: item.currentRevision.id,
        orientation: "left",
      };
      const original = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId: originalAssetId,
        presentation,
      });
      const input = {
        ...source(),
        mode: "extract",
        sourceAssetId: originalAssetId,
        notes: "保持侧视姿态，仅修正袖部透射",
        presentation: { ...presentation, repairPreparationId: original.id },
      };
      const callsBefore = generation.createForWardrobe.mock.calls.length;
      for (const invalid of [
        { ...input, sourceAssetId: assetId },
        { ...input, mode: "complete" },
        { ...input, referenceAssetIds: [assetId] },
        { ...input, sourceKind: "sketch" },
        {
          ...input,
          presentation: { ...input.presentation, orientation: "right" },
        },
        { ...input, presentation },
        {
          ...input,
          presentation: {
            ...input.presentation,
            repairPreparationId: prepared.id,
          },
        },
      ]) {
        await expect(
          service.prepare(userId, projectId, invalid),
        ).rejects.toThrow();
      }
      const foreign = await service.prepare(userId, otherProjectId, {
        ...source(),
        sourceAssetId: foreignAssetId,
      });
      await expect(
        service.prepare(userId, projectId, {
          ...input,
          presentation: {
            ...input.presentation,
            repairPreparationId: foreign.id,
          },
        }),
      ).rejects.toThrow("侧挂准备记录不存在");
      expect(generation.createForWardrobe.mock.calls).toHaveLength(callsBefore);

      const repair = await service.prepare(userId, projectId, input);
      expect(repair).toMatchObject({
        sourceAssetId: originalAssetId,
        status: "queued",
        presentation: input.presentation,
      });
      expect(generation.createForWardrobe).toHaveBeenLastCalledWith(
        userId,
        expect.objectContaining({ sourceAssetIds: [originalAssetId] }),
        expect.any(String),
      );
      expect((await service.prepare(userId, projectId, input)).id).toBe(
        repair.id,
      );
      expect(generation.createForWardrobe.mock.calls).toHaveLength(
        callsBefore + 1,
      );
      await expect(
        service.prepare(userId, projectId, {
          ...input,
          requestKey: requestKey(),
          presentation: { ...presentation, repairPreparationId: repair.id },
        }),
      ).rejects.toThrow("已完成的侧挂候选");
      if (!repair.taskId) throw new Error("缺少侧挂修正任务");
      const repairedAssetId = await asset(projectId);
      await prisma.designAsset.update({
        where: { id: repairedAssetId },
        data: {
          generationTaskId: repair.taskId,
          parentAssetId: originalAssetId,
          rootAssetId: originalAssetId,
        },
      });
      await prisma.generationTask.update({
        where: { id: repair.taskId },
        data: { status: "SUCCEEDED" },
      });
      await expect(
        service.confirm(userId, projectId, {
          requestKey: requestKey(),
          preparationId: repair.id,
          assetId: repairedAssetId,
          name: "不可作为正面",
          category: "top",
          display: "hanger",
          reviewed: true,
        }),
      ).rejects.toThrow("侧挂");
      const result = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: item.version,
          revisionId: item.currentRevision.id,
          sideDisplay: {
            preparationId: repair.id,
            assetId: repairedAssetId,
            anchor: { x: 0.5, y: 0.1 },
            reviewed: true,
          },
        },
      );
      expect(result.currentRevision.assetId).toBe(assetId);
      expect(result.currentRevision.presentation?.sideDisplay).toMatchObject({
        assetId: repairedAssetId,
        preparationId: repair.id,
        source: "generated",
      });
      expect(
        (
          await prisma.designAsset.findUniqueOrThrow({
            where: { id: repairedAssetId },
          })
        ).parentAssetId,
      ).toBe(originalAssetId);
      const importedResult = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId: repairedAssetId,
        presentation: {
          ...presentation,
          revisionId: result.currentRevision.id,
        },
      });
      const adopted = await service.updatePresentation(
        userId,
        projectId,
        item.id,
        {
          requestKey: requestKey(),
          expectedVersion: result.version,
          revisionId: result.currentRevision.id,
          sideDisplay: {
            preparationId: importedResult.id,
            assetId: repairedAssetId,
            anchor: { x: 0.5, y: 0.1 },
            reviewed: true,
          },
        },
      );
      expect(adopted.currentRevision.presentation?.sideDisplay?.source).toBe(
        "generated",
      );
    });

    it("透明派生通过真实存储保留RGB/保护区和三来源血缘；重放不重复且确认继承补全标记", async () => {
      const f = await materialFixture();
      const tasksBefore = await prisma.generationTask.count({
        where: { projectId },
      });
      const prepared = await service.deriveMaterialCandidate(
        userId,
        projectId,
        f.input,
      );
      expect(prepared.status).toBe("ready");
      const candidate = prepared.candidates[0];
      if (!candidate) throw new Error("缺少透明派生候选");
      const saved = await prisma.designAsset.findUniqueOrThrow({
        where: { id: candidate.assetId },
        include: { designStep: true },
      });
      const png = Buffer.from(
        await storage.readPrefix(
          saved.url.slice(5),
          (await storage.head(saved.url.slice(5))).contentLength,
        ),
      );
      const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
      let changed = 0;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (
          !rgba
            .subarray(offset, offset + 3)
            .equals(f.pixels.subarray(offset, offset + 3))
        )
          throw new Error("RGB changed");
        if (
          f.maskPixels[offset + 3] === 255 &&
          !rgba
            .subarray(offset, offset + 4)
            .equals(f.pixels.subarray(offset, offset + 4))
        )
          throw new Error("Protected RGBA changed");
        if ((rgba[offset + 3] ?? 0) > (f.pixels[offset + 3] ?? 0))
          throw new Error("Alpha increased");
        if (rgba[offset + 3] !== f.pixels[offset + 3]) changed++;
      }
      expect(changed).toBeGreaterThan(0);
      expect(saved).toMatchObject({
        parentAssetId: f.raw.id,
        rootAssetId: assetId,
        generationTaskId: null,
      });
      expect(saved.designStep?.tool).toBe("wardrobe-material-alpha");
      const snapshot = saved.designStep?.inputSnapshot as {
        sources: { assetId: string }[];
        parameters: { processing: string };
      };
      expect(snapshot.sources.map((entry) => entry.assetId).sort()).toEqual(
        [f.original.id, f.raw.id, f.mask.id].sort(),
      );
      const processing = JSON.parse(snapshot.parameters.processing);
      expect(processing).toMatchObject({
        algorithm: "green-dominance-original-rgb-v1",
        sourceAssetId: f.original.id,
        rawAssetId: f.raw.id,
        maskAssetId: f.mask.id,
        sourceSha256: createHash("sha256").update(f.sourceBytes).digest("hex"),
        rawSha256: createHash("sha256").update(f.rawBytes).digest("hex"),
        maskSha256: createHash("sha256").update(f.maskBytes).digest("hex"),
        derivedSha256: createHash("sha256").update(png).digest("hex"),
      });
      expect(prepared.materialProcessing).toEqual(processing);
      const counts = await Promise.all([
        prisma.designAsset.count({ where: { projectId } }),
        prisma.wardrobePreparation.count({ where: { projectId } }),
      ]);
      expect(
        (await service.deriveMaterialCandidate(userId, projectId, f.input)).id,
      ).toBe(prepared.id);
      expect(
        await Promise.all([
          prisma.designAsset.count({ where: { projectId } }),
          prisma.wardrobePreparation.count({ where: { projectId } }),
        ]),
      ).toEqual(counts);
      expect(await prisma.generationTask.count({ where: { projectId } })).toBe(
        tasksBefore,
      );
      for (const [record, bytes] of [
        [f.original, f.sourceBytes],
        [f.raw, f.rawBytes],
        [f.mask, f.maskBytes],
      ] as const)
        expect(
          Buffer.from(
            await storage.readPrefix(record.url.slice(5), bytes.length),
          ),
        ).toEqual(bytes);
      const confirmed = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId: saved.id,
        name: f.input.name,
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      expect(confirmed.currentRevision).toMatchObject({
        sourceKind: "isolated",
        generatedCompletion: true,
        materialProcessing: processing,
      });
    });

    it("侧图透明派生保留冻结展示绑定与三源审计，只挂载侧图且正面素材不变", async () => {
      const f = await materialSideFixture();
      const beforeTasks = await prisma.generationTask.count({
        where: { projectId },
      });
      const prepared = await service.deriveMaterialCandidate(
        userId,
        projectId,
        f.input,
      );
      const candidate = prepared.candidates[0];
      if (!candidate) throw new Error("缺少侧图透明派生候选");
      expect(prepared.presentation).toEqual({
        view: "side",
        revisionId: f.front.currentRevision.id,
        orientation: "right",
      });
      expect(prepared.materialProcessing).toMatchObject({
        sourceAssetId: f.original.id,
        rawAssetId: f.raw.id,
        maskAssetId: f.mask.id,
      });
      const saved = await prisma.designAsset.findUniqueOrThrow({
        where: { id: candidate.assetId },
      });
      expect(saved).toMatchObject({
        parentAssetId: f.raw.id,
        rootAssetId: assetId,
        generationTaskId: null,
      });
      await expect(
        service.confirm(userId, projectId, {
          requestKey: requestKey(),
          preparationId: prepared.id,
          assetId: saved.id,
          name: "不能错当正面",
          category: "top",
          display: "hanger",
          reviewed: true,
        }),
      ).rejects.toThrow();
      const updated = await service.updatePresentation(
        userId,
        projectId,
        f.front.id,
        {
          requestKey: requestKey(),
          expectedVersion: f.front.version,
          revisionId: f.front.currentRevision.id,
          sideDisplay: {
            preparationId: prepared.id,
            assetId: saved.id,
            anchor: { x: 0.5, y: 0.1 },
            reviewed: true,
          },
        },
      );
      expect(updated.currentRevision.assetId).toBe(
        f.front.currentRevision.assetId,
      );
      expect(updated.currentRevision.materialProcessing).toBeUndefined();
      expect(updated.currentRevision.presentation?.sideDisplay).toMatchObject({
        assetId: saved.id,
        orientation: "right",
        source: "generated",
        preparationId: prepared.id,
        materialProcessing: prepared.materialProcessing,
      });
      expect(
        (await service.deriveMaterialCandidate(userId, projectId, f.input)).id,
      ).toBe(prepared.id);
      expect(await prisma.generationTask.count({ where: { projectId } })).toBe(
        beforeTasks,
      );
    });

    it("侧图透明派生拒绝非侧图、跨项目、候选不匹配、类别错误、未完成与归档单品", async () => {
      for (const invalid of [
        "front-preparation",
        "foreign",
        "candidate",
        "category",
        "not-ready",
        "archived",
      ]) {
        const f = await materialSideFixture();
        const input = { ...f.input };
        if (invalid === "front-preparation")
          input.sidePreparationId = f.frontPreparation.id;
        if (invalid === "foreign") {
          const foreign = await service.prepare(userId, otherProjectId, {
            ...source(),
            sourceAssetId: foreignAssetId,
          });
          input.sidePreparationId = foreign.id;
        }
        if (invalid === "candidate") input.sourceAssetId = assetId;
        if (invalid === "category") input.category = "bottom";
        if (invalid === "not-ready")
          await prisma.wardrobePreparation.update({
            where: { id: f.side.id },
            data: { error: "候选失败" },
          });
        if (invalid === "archived")
          await prisma.wardrobeItem.update({
            where: { id: f.front.id },
            data: { archived: true },
          });
        const count = await prisma.designAsset.count({ where: { projectId } });
        await expect(
          service.deriveMaterialCandidate(userId, projectId, input),
          invalid,
        ).rejects.toThrow();
        expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
          count,
        );
      }
    });

    it("冻结历史侧图可以透明派生与幂等重放，但过期修订不能挂载到最新单品", async () => {
      const f = await materialSideFixture();
      const newer = await service.updatePresentation(
        userId,
        projectId,
        f.front.id,
        {
          requestKey: requestKey(),
          expectedVersion: f.front.version,
          revisionId: f.front.currentRevision.id,
          frontAnchor: { x: 0.5, y: 0.2 },
        },
      );
      const prepared = await service.deriveMaterialCandidate(
        userId,
        projectId,
        f.input,
      );
      const candidate = prepared.candidates[0];
      if (!candidate) throw new Error("缺少历史侧图透明派生候选");
      expect(prepared.presentation?.revisionId).toBe(
        f.front.currentRevision.id,
      );
      expect(
        (await service.deriveMaterialCandidate(userId, projectId, f.input)).id,
      ).toBe(prepared.id);
      for (const base of [f.front, newer])
        await expect(
          service.updatePresentation(userId, projectId, f.front.id, {
            requestKey: requestKey(),
            expectedVersion: base.version,
            revisionId: base.currentRevision.id,
            sideDisplay: {
              preparationId: prepared.id,
              assetId: candidate.assetId,
              anchor: { x: 0.5, y: 0.1 },
              reviewed: true,
            },
          }),
        ).rejects.toThrow();
      const current = await prisma.wardrobeItem.findUniqueOrThrow({
        where: { id: f.front.id },
      });
      expect(current.version).toBe(newer.version);
    });

    it.each(["front", "side"])(
      "局部RGB修正真实存储只改选区RGB、全图alpha与保护区原样，血缘和确认成立：%s",
      async (target) => {
        const sideFixture =
          target === "side" ? await materialSideFixture() : null;
        const f = sideFixture ?? (await materialFixture());
        await markCorrection(f);
        const input = { ...f.input, operation: "correction" };
        const tasksBefore = await prisma.generationTask.count({
          where: { projectId },
        });
        const prepared = await service.deriveMaterialCandidate(
          userId,
          projectId,
          input,
        );
        const id = prepared.candidates[0]?.assetId;
        if (!id) throw new Error("缺少RGB修正候选");
        const saved = await prisma.designAsset.findUniqueOrThrow({
          where: { id },
          include: { designStep: true },
        });
        const bytes = Buffer.from(
          await storage.readPrefix(
            saved.url.slice(5),
            (await storage.head(saved.url.slice(5))).contentLength,
          ),
        );
        const rgba = await sharp(bytes).ensureAlpha().raw().toBuffer();
        let rgbChanged = 0;
        for (let offset = 0; offset < rgba.length; offset += 4) {
          if (rgba[offset + 3] !== f.pixels[offset + 3])
            throw new Error("source alpha changed");
          if (
            f.maskPixels[offset + 3] === 255 &&
            !rgba
              .subarray(offset, offset + 4)
              .equals(f.pixels.subarray(offset, offset + 4))
          )
            throw new Error("protected RGBA changed");
          if (
            !rgba
              .subarray(offset, offset + 3)
              .equals(f.pixels.subarray(offset, offset + 3))
          )
            rgbChanged++;
        }
        expect(rgbChanged).toBeGreaterThan(0);
        expect(saved).toMatchObject({
          parentAssetId: f.raw.id,
          rootAssetId: assetId,
          generationTaskId: null,
        });
        expect(saved.designStep?.tool).toBe("wardrobe-masked-edit");
        expect(prepared.materialProcessing).toMatchObject({
          kind: "masked-edit",
          algorithm: "masked-provider-rgb-interior-v2",
          alphaThreshold: 240,
          interiorRadius: 2,
          sourceAssetId: f.original.id,
          rawAssetId: f.raw.id,
          maskAssetId: f.mask.id,
          sourceSha256: createHash("sha256")
            .update(f.sourceBytes)
            .digest("hex"),
          rawSha256: createHash("sha256").update(f.rawBytes).digest("hex"),
          maskSha256: createHash("sha256").update(f.maskBytes).digest("hex"),
          derivedSha256: createHash("sha256").update(bytes).digest("hex"),
        });
        const beforeReplay = await prisma.designAsset.count({
          where: { projectId },
        });
        expect(
          (await service.deriveMaterialCandidate(userId, projectId, input)).id,
        ).toBe(prepared.id);
        expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
          beforeReplay,
        );
        if (sideFixture) {
          const updated = await service.updatePresentation(
            userId,
            projectId,
            sideFixture.front.id,
            {
              requestKey: requestKey(),
              expectedVersion: sideFixture.front.version,
              revisionId: sideFixture.front.currentRevision.id,
              sideDisplay: {
                preparationId: prepared.id,
                assetId: id,
                anchor: { x: 0.5, y: 0.1 },
                reviewed: true,
              },
            },
          );
          expect(updated.currentRevision.assetId).toBe(
            sideFixture.front.currentRevision.assetId,
          );
          expect(
            updated.currentRevision.presentation?.sideDisplay
              ?.materialProcessing,
          ).toEqual(prepared.materialProcessing);
        } else {
          const confirmed = await service.confirm(userId, projectId, {
            requestKey: requestKey(),
            preparationId: prepared.id,
            assetId: id,
            name: "内部细节修正",
            category: "top",
            display: "hanger",
            reviewed: true,
          });
          expect(confirmed.currentRevision.materialProcessing).toEqual(
            prepared.materialProcessing,
          );
          expect(confirmed.currentRevision.generatedCompletion).toBe(true);
        }
        expect(
          await prisma.generationTask.count({ where: { projectId } }),
        ).toBe(tasksBefore);
        const attemptedRaw = await service.prepare(userId, projectId, {
          ...source(),
          sourceAssetId: f.raw.id,
        });
        expect(attemptedRaw.status).toBe("failed");
      },
    );

    it("v2真实RGBA派生保护半透、细孔和2px轮廓带，同时记录固定阈值与统计", async () => {
      const f = await materialFixture(true);
      await markCorrection(f);
      const prepared = await service.deriveMaterialCandidate(
        userId,
        projectId,
        { ...f.input, operation: "correction" },
      );
      const asset = await prisma.designAsset.findUniqueOrThrow({
        where: { id: prepared.candidates[0]?.assetId ?? "missing" },
        include: { designStep: true },
      });
      const key = asset.url.slice(5);
      const result = await sharp(
        Buffer.from(
          await storage.readPrefix(
            key,
            (await storage.head(key)).contentLength,
          ),
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
      for (const [x, y] of [
        [64, 80],
        [65, 80],
        [190, 80],
        [191, 80],
        [100, 100],
        [98, 98],
        [102, 102],
      ]) {
        const offset = ((y ?? 0) * 256 + (x ?? 0)) * 4;
        expect(result.subarray(offset, offset + 4)).toEqual(
          f.pixels.subarray(offset, offset + 4),
        );
      }
      expect([
        ...result.subarray((80 * 256 + 66) * 4, (80 * 256 + 66) * 4 + 4),
      ]).toEqual([0, 0, 0, 253]);
      for (let offset = 3; offset < result.length; offset += 4)
        if (result[offset] !== f.pixels[offset])
          throw new Error("alpha changed");
      const snapshot = asset.designStep?.inputSnapshot as {
        parameters?: { stats?: string };
      };
      const stats = JSON.parse(snapshot.parameters?.stats ?? "{}");
      expect(stats).toMatchObject({ alphaThreshold: 240, interiorRadius: 2 });
      expect(stats.boundaryProtectedPixels).toBeGreaterThan(0);
      expect(stats.alphaProtectedPixels).toBeGreaterThan(0);
      expect(stats.changedRgbPixels).toBeGreaterThan(0);
    });

    it("correction无有效内部像素时在接纳任务和存新素材之前拒绝，旧透明选择校验不变", async () => {
      const f = await materialFixture();
      const thinMask = Buffer.alloc(f.pixels.length, 255);
      for (let y = 40; y < 80; y++) thinMask[(y * 256 + 64) * 4 + 3] = 0;
      const mask = await materialImage(
        await sharp(thinMask, { raw: { width: 256, height: 256, channels: 4 } })
          .png()
          .toBuffer(),
      );
      const beforeAssets = await prisma.designAsset.count({
        where: { projectId },
      });
      const beforeCalls = generation.createFromAgent.mock.calls.length;
      await expect(
        service.createMaterialProbe(userId, projectId, {
          requestKey: requestKey(),
          sourceAssetId: f.original.id,
          maskAssetId: mask.id,
          name: "边缘细带",
          category: "top",
          operation: "correction",
          notes: "修缝",
        }),
      ).rejects.toThrow("没有可修正的衣料内部像素");
      expect(generation.createFromAgent.mock.calls.length).toBe(beforeCalls);
      expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
        beforeAssets,
      );
    });

    it("算法升级后的旧v1请求重放保留真实历史资产与metadata，新键使用v2", async () => {
      const f = await materialFixture();
      await markCorrection(f);
      const input = { ...f.input, operation: "correction" };
      const rawPixels = await sharp(f.rawBytes).ensureAlpha().raw().toBuffer();
      const image = (data: Buffer) => ({ data, width: 256, height: 256 });
      const old = deriveMaskedProviderRgb({
        source: image(f.pixels),
        probe: image(rawPixels),
        mask: image(f.maskPixels),
      });
      const bytes = await sharp(Buffer.from(old.data), {
        raw: { width: 256, height: 256, channels: 4 },
      })
        .png()
        .toBuffer();
      const asset = await materialImage(bytes);
      const hash = (value: Buffer) =>
        createHash("sha256").update(value).digest("hex");
      const legacy = {
        kind: "masked-edit",
        algorithm: old.algorithm,
        sourceAssetId: f.original.id,
        rawAssetId: f.raw.id,
        maskAssetId: f.mask.id,
        sourceSha256: hash(f.sourceBytes),
        rawSha256: hash(f.rawBytes),
        maskSha256: hash(f.maskBytes),
        derivedSha256: hash(bytes),
      };
      await prisma.designAsset.update({
        where: { id: asset.id },
        data: {
          parentAssetId: f.raw.id,
          rootAssetId: assetId,
          designStep: {
            create: {
              projectId,
              actor: "wardrobe",
              tool: "wardrobe-masked-edit",
              intent: "历史v1测试资产",
              inputSnapshot: {
                parameters: { processing: JSON.stringify(legacy) },
              },
            },
          },
        },
      });
      const prepared = await service.prepare(userId, projectId, {
        ...source(),
        requestKey: input.requestKey,
        sourceAssetId: asset.id,
        name: input.name,
        category: input.category,
      });
      const count = await prisma.designAsset.count({ where: { projectId } });
      const replay = await service.deriveMaterialCandidate(
        userId,
        projectId,
        input,
      );
      expect(replay.id).toBe(prepared.id);
      expect(replay.materialProcessing?.algorithm).toBe(
        "masked-provider-rgb-preserve-alpha-v1",
      );
      expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
        count,
      );
      await expect(
        service.deriveMaterialCandidate(userId, projectId, {
          ...input,
          name: "不允许换名重用",
        }),
      ).rejects.toThrow();
      const next = await service.deriveMaterialCandidate(userId, projectId, {
        ...input,
        requestKey: requestKey(),
      });
      expect(next.materialProcessing?.algorithm).toBe(
        "masked-provider-rgb-interior-v2",
      );
      expect(next.id).not.toBe(prepared.id);
    });

    it("局部RGB修正要求明确说明、沿真实INPAINT操作标记，不允许透明与修正混用", async () => {
      const f = await materialFixture();
      const probe = {
        requestKey: requestKey(),
        operation: "correction",
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: f.input.name,
        category: "top",
      };
      await expect(
        service.createMaterialProbe(userId, projectId, probe),
      ).rejects.toThrow("明确说明");
      await expect(
        service.createMaterialProbe(viewerId, projectId, {
          ...probe,
          notes: "修正内部缝线",
        }),
      ).rejects.toThrow();
      await expect(
        service.deriveMaterialCandidate(userId, projectId, {
          ...f.input,
          operation: "correction",
        }),
      ).rejects.toThrow("处理方式");
      await markCorrection(f);
      await expect(
        service.deriveMaterialCandidate(userId, projectId, f.input),
      ).rejects.toThrow("处理方式");
      await expect(
        service.deriveMaterialCandidate(userId, projectId, {
          ...f.input,
          operation: "correction",
          rawAssetId: foreignAssetId,
        }),
      ).rejects.toThrow("当前项目");
    });

    it("绿色服装可登记mask并明确修正RGB，透明操作仍拒绝，生产修正prompt不含绿孔指令", async () => {
      const f = await materialFixture();
      const greenPixels = Buffer.from(f.pixels);
      greenPixels.set([20, 220, 30, 253], (100 * 256 + 100) * 4);
      const green = await materialImage(
        await sharp(greenPixels, {
          raw: { width: 256, height: 256, channels: 4 },
        })
          .png()
          .toBuffer(),
      );
      const maskId = randomUUID();
      const temporary = `temporary/masks/${userId}/${maskId}.png`;
      await storage.uploadBuffer(
        temporary,
        f.maskBytes,
        "image/png",
        createHash("sha256").update(f.maskBytes).digest("base64"),
      );
      keys.push(temporary);
      const mask = await service.registerMaterialMask(userId, projectId, {
        requestKey: requestKey(),
        operation: "correction",
        sourceAssetId: green.id,
        maskId,
        sha256: createHash("sha256").update(f.maskBytes).digest("hex"),
      });
      generation.createFromAgent.mockResolvedValueOnce({
        taskId: "explicit-correction-admission",
      });
      const body = {
        requestKey: requestKey(),
        operation: "correction",
        sourceAssetId: green.id,
        maskAssetId: mask.assetId,
        name: "绿色服装",
        category: "top",
        notes: "仅移除已指定的内部多余绗缝",
      };
      await service.createMaterialProbe(userId, projectId, body);
      const call = generation.createFromAgent.mock.lastCall;
      expect(call?.[1].prompt).toContain(body.notes);
      expect(call?.[1].prompt).not.toContain("RGB(0,255,0)");
      expect(call?.[4].notes).toContain("wardrobe-masked-correction-probe:v1");
      expect(call?.[4].notes).toContain("wardrobe-material-alpha-probe:v1");
      await expect(
        service.createMaterialProbe(userId, projectId, {
          ...body,
          requestKey: requestKey(),
          operation: "transparency",
        }),
      ).rejects.toThrow("绿色织物");
      await expect(
        service.createMaterialProbe(userId, projectId, {
          ...body,
          requestKey: requestKey(),
          sourceAssetId: opaqueAssetId,
        }),
      ).rejects.toThrow();
    });

    it("透明处理和显式probe拒绝只读用户及跨项目source/raw/mask", async () => {
      const f = await materialFixture();
      const probe = {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: f.input.name,
        category: "top",
      };
      await expect(
        service.deriveMaterialCandidate(viewerId, projectId, f.input),
      ).rejects.toThrow();
      await expect(
        service.createMaterialProbe(viewerId, projectId, probe),
      ).rejects.toThrow();
      for (const field of ["sourceAssetId", "rawAssetId", "maskAssetId"])
        await expect(
          service.deriveMaterialCandidate(userId, projectId, {
            ...f.input,
            [field]: foreignAssetId,
          }),
        ).rejects.toThrow("当前项目");
      for (const field of ["sourceAssetId", "maskAssetId"])
        await expect(
          service.createMaterialProbe(userId, projectId, {
            ...probe,
            [field]: foreignAssetId,
          }),
        ).rejects.toThrow("当前项目");
    });

    it.each([
      "FAILED",
      "not-inpaint",
      "task-parent",
      "asset-parent",
      "frozen-source",
      "frozen-first",
      "frozen-mask",
    ])("透明派生拒绝不成立的真实任务及冻结来源：%s", async (reason) => {
      const f = await materialFixture();
      if (reason === "FAILED")
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: { status: "FAILED" },
        });
      if (reason === "not-inpaint")
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: { taskType: "i2i" },
        });
      if (reason === "task-parent")
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: { parentAssetId: assetId },
        });
      if (reason === "asset-parent")
        await prisma.designAsset.update({
          where: { id: f.raw.id },
          data: { parentAssetId: assetId },
        });
      if (reason.startsWith("frozen"))
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: {
            compiledPrompt: {
              request: {
                ...f.frozenRequest,
                ...(reason === "frozen-source"
                  ? { referenceImageUrl: f.mask.url }
                  : reason === "frozen-first"
                    ? { referenceImageUrls: [f.mask.url, f.original.url] }
                    : { maskImageUrl: f.original.url }),
              },
            },
          },
        });
      await expect(
        service.deriveMaterialCandidate(userId, projectId, f.input),
      ).rejects.toThrow("真实原图");
    });

    it("透明修复拒绝尺寸不符、缺少保护区和原布绿色，probe原图不能直接确认", async () => {
      const f = await materialFixture();
      const probe = {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: f.input.name,
        category: "top",
      };
      for (const [width, alpha] of [
        [128, 0],
        [256, 0],
        [256, 1],
      ]) {
        const bytes = await sharp({
          create: {
            width: width ?? 256,
            height: 256,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: alpha ?? 0 },
          },
        })
          .png()
          .toBuffer();
        const mask = await materialImage(bytes);
        await expect(
          service.createMaterialProbe(userId, projectId, {
            ...probe,
            maskAssetId: mask.id,
          }),
        ).rejects.toThrow();
      }
      const green = Buffer.from(f.pixels);
      green.set([10, 240, 20, 253], (100 * 256 + 100) * 4);
      const colored = await materialImage(
        await sharp(green, { raw: { width: 256, height: 256, channels: 4 } })
          .png()
          .toBuffer(),
      );
      await expect(
        service.createMaterialProbe(userId, projectId, {
          ...probe,
          sourceAssetId: colored.id,
        }),
      ).rejects.toThrow("绿色织物");
      const attempted = await service.prepare(userId, projectId, {
        ...source(),
        sourceAssetId: f.raw.id,
      });
      expect(attempted.status).toBe("failed");
      expect(attempted.error).toContain("中间");
      await expect(
        service.confirm(userId, projectId, {
          requestKey: requestKey(),
          preparationId: attempted.id,
          assetId: f.raw.id,
          name: "不得入架",
          category: "top",
          display: "hanger",
          reviewed: true,
        }),
      ).rejects.toThrow();
    });

    it("临时用户mask真实PNG登记为永久私有DesignAsset，不创建FileAsset或生成任务", async () => {
      const f = await materialFixture();
      const studio = new StudioService(prisma, access);
      const ordinaryGeneratedIds: string[] = [];
      for (const compiledPrompt of [
        Prisma.JsonNull,
        {},
        { notes: [] },
        { notes: ["ordinary-design-generation"] },
      ]) {
        const ordinary = await materialImage(f.sourceBytes);
        const task = await prisma.generationTask.create({
          data: {
            userId,
            projectId,
            taskType: "i2i",
            status: "SUCCEEDED",
            input: {},
            compiledPrompt,
          },
        });
        await prisma.designAsset.update({
          where: { id: ordinary.id },
          data: { generationTaskId: task.id },
        });
        ordinaryGeneratedIds.push(ordinary.id);
      }
      const visibleBefore = await studio.creativeSummary(userId, projectId);
      const maskId = randomUUID();
      const temporary = `temporary/masks/${userId}/${maskId}.png`;
      await storage.uploadBuffer(
        temporary,
        f.maskBytes,
        "image/png",
        createHash("sha256").update(f.maskBytes).digest("base64"),
      );
      keys.push(temporary);
      const counts = await Promise.all([
        prisma.fileAsset.count(),
        prisma.generationTask.count({ where: { projectId } }),
      ]);
      const result = await service.registerMaterialMask(userId, projectId, {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskId,
        sha256: createHash("sha256").update(f.maskBytes).digest("hex"),
      });
      const saved = await prisma.designAsset.findUniqueOrThrow({
        where: { id: result.assetId },
        include: { designStep: true },
      });
      expect(saved).toMatchObject({
        parentAssetId: f.original.id,
        rootAssetId: assetId,
        sourceFileId: null,
        generationTaskId: null,
      });
      expect(saved.url).toMatch(/^s3:\/\/wardrobe\//u);
      expect(saved.designStep?.tool).toBe("wardrobe-material-mask");
      expect(
        Buffer.from(
          await storage.readPrefix(saved.url.slice(5), f.maskBytes.length),
        ),
      ).toEqual(f.maskBytes);
      expect(
        await Promise.all([
          prisma.fileAsset.count(),
          prisma.generationTask.count({ where: { projectId } }),
        ]),
      ).toEqual(counts);
      generation.createFromAgent.mockResolvedValueOnce({
        taskId: "studio-visibility-probe-admission",
      });
      await service.createMaterialProbe(userId, projectId, {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: saved.id,
        name: f.input.name,
        category: "top",
        detailRegion: { x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
      });
      const detailUrl =
        generation.createFromAgent.mock.lastCall?.[1].referenceImageUrls[1];
      const detail = await prisma.designAsset.findFirstOrThrow({
        where: { url: detailUrl },
      });
      const derived = await service.deriveMaterialCandidate(
        userId,
        projectId,
        f.input,
      );
      const visible = await studio.summary(userId, projectId);
      const visibleIds = visible.assets.map((entry) => entry.id);
      expect(visibleIds).toContain(f.original.id);
      expect(visibleIds).toContain(f.mask.id);
      for (const ordinaryId of ordinaryGeneratedIds)
        expect(visibleIds).toContain(ordinaryId);
      expect(visibleIds).toContain(derived.candidates[0]?.assetId);
      for (const internalId of [saved.id, detail.id, f.raw.id])
        expect(visibleIds).not.toContain(internalId);
      expect((await studio.creativeSummary(userId, projectId)).assets).toBe(
        visibleBefore.assets + 1,
      );
    });

    it("mask永久字节不受临时对象被覆盖或删除影响，重复登记仍同一资产", async () => {
      const f = await materialFixture();
      const maskId = randomUUID();
      const temporary = `temporary/masks/${userId}/${maskId}.png`;
      await storage.uploadBuffer(
        temporary,
        f.maskBytes,
        "image/png",
        createHash("sha256").update(f.maskBytes).digest("base64"),
      );
      keys.push(temporary);
      const input = {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskId,
        sha256: createHash("sha256").update(f.maskBytes).digest("hex"),
      };
      const initial = await service.registerMaterialMask(
        userId,
        projectId,
        input,
      );
      const count = await prisma.designAsset.count({ where: { projectId } });
      await storage.uploadBuffer(
        temporary,
        f.sourceBytes,
        "image/png",
        createHash("sha256").update(f.sourceBytes).digest("base64"),
      );
      expect(
        await service.registerMaterialMask(userId, projectId, input),
      ).toEqual(initial);
      await storage.delete(temporary);
      expect(
        await service.registerMaterialMask(userId, projectId, input),
      ).toEqual(initial);
      const permanent = await prisma.designAsset.findUniqueOrThrow({
        where: { id: initial.assetId },
      });
      expect(
        Buffer.from(
          await storage.readPrefix(permanent.url.slice(5), f.maskBytes.length),
        ),
      ).toEqual(f.maskBytes);
      expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
        count,
      );
    });

    it("mask登记拒绝错误SHA、他人临时命名空间、只读者及跨项目来源", async () => {
      const f = await materialFixture();
      const maskId = randomUUID();
      const own = `temporary/masks/${userId}/${maskId}.png`;
      const otherMaskId = randomUUID();
      const foreign = `temporary/masks/${viewerId}/${otherMaskId}.png`;
      for (const temporary of [own, foreign]) {
        await storage.uploadBuffer(
          temporary,
          f.maskBytes,
          "image/png",
          createHash("sha256").update(f.maskBytes).digest("base64"),
        );
        keys.push(temporary);
      }
      const input = {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskId,
        sha256: createHash("sha256").update(f.maskBytes).digest("hex"),
      };
      const count = await prisma.designAsset.count({ where: { projectId } });
      await expect(
        service.registerMaterialMask(userId, projectId, {
          ...input,
          sha256: "0".repeat(64),
        }),
      ).rejects.toThrow("摘要");
      await expect(
        service.registerMaterialMask(userId, projectId, {
          ...input,
          maskId: otherMaskId,
        }),
      ).rejects.toThrow();
      await expect(
        service.registerMaterialMask(viewerId, projectId, input),
      ).rejects.toThrow();
      await expect(
        service.registerMaterialMask(userId, projectId, {
          ...input,
          sourceAssetId: foreignAssetId,
        }),
      ).rejects.toThrow("当前项目");
      expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
        count,
      );
    });

    it("correction位置guide真实私有存储并按原图/guide/detail传递，隐藏且不能确认或裁后确认", async () => {
      const f = await materialFixture();
      generation.createFromAgent.mockResolvedValueOnce({
        taskId: "guide-test-admission",
      });
      await service.createMaterialProbe(userId, projectId, {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: "局部位置",
        category: "top",
        notes: "仅指定布带加一条缝",
        operation: "correction",
        detailRegion: { x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
      });
      const call = generation.createFromAgent.mock.lastCall;
      const urls = call?.[1].referenceImageUrls as string[];
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe(f.original.url);
      expect(call?.[1].maskImageUrl).toBe(f.mask.url);
      const guideUrl = urls[1];
      const detailUrl = urls[2];
      if (!guideUrl || !detailUrl)
        throw new Error("missing guide/detail references");
      const guide = await prisma.designAsset.findFirstOrThrow({
        where: { url: guideUrl },
        include: { designStep: true },
      });
      const detail = await prisma.designAsset.findFirstOrThrow({
        where: { url: detailUrl },
        include: { designStep: true },
      });
      expect(guide).toMatchObject({
        parentAssetId: f.original.id,
        rootAssetId: assetId,
        generationTaskId: null,
        sourceFileId: null,
      });
      expect(guide.designStep?.tool).toBe("wardrobe-correction-guide");
      expect(detail.designStep?.tool).toBe("wardrobe-material-detail");
      const snapshot = guide.designStep?.inputSnapshot as {
        sources: { assetId: string }[];
        parameters: Record<string, string>;
      };
      expect(snapshot.sources.map((entry) => entry.assetId).sort()).toEqual(
        [f.original.id, f.mask.id].sort(),
      );
      expect(snapshot.parameters).toMatchObject({
        algorithm: "masked-interior-magenta-guide-v1",
        opacity: "0.45",
        color: "#ff00ff",
        referenceOnly: "true",
      });
      const guideKey = guide.url.slice(5);
      const guideBytes = Buffer.from(
        await storage.readPrefix(
          guideKey,
          (await storage.head(guideKey)).contentLength,
        ),
      );
      expect(createHash("sha256").update(guideBytes).digest("hex")).toBe(
        snapshot.parameters.guideSha256,
      );
      expect(
        call?.[4].sources.find(
          (entry: { assetId: string }) => entry.assetId === guide.id,
        )?.title,
      ).toContain("非服装设计");
      const visible = await new StudioService(prisma, access).summary(
        userId,
        projectId,
      );
      expect(
        visible.assets.some(
          (entry) => entry.id === guide.id || entry.id === detail.id,
        ),
      ).toBe(false);
      for (const region of [
        undefined,
        { x: 0.25, y: 0.125, width: 0.5, height: 0.75 },
      ]) {
        const prepared = await service.prepare(userId, projectId, {
          ...source(),
          sourceAssetId: guide.id,
          ...(region ? { region } : {}),
        });
        expect(prepared.status).toBe("failed");
        expect(prepared.error).toContain("位置指引");
        await expect(
          service.confirm(userId, projectId, {
            requestKey: requestKey(),
            preparationId: prepared.id,
            assetId: guide.id,
            name: "不能采用guide",
            category: "top",
            display: "hanger",
            reviewed: true,
          }),
        ).rejects.toThrow();
      }
    });

    it.each(["owner", "editor"])(
      "guide上线前旧任务重放保留冻结参考与model，仅恢复原QUEUED任务：%s",
      async (role) => {
        const f = await materialFixture();
        const actorId = role === "editor" ? editorId : userId;
        const input = {
          requestKey: requestKey(),
          operation: "correction",
          sourceAssetId: f.original.id,
          maskAssetId: f.mask.id,
          name: "历史无guide",
          category: "top",
          notes: "原局部说明",
        };
        const key = `wardrobe-material-probe:${input.requestKey}`;
        const id = createHash("sha256")
          .update(
            `${userId}\0${actorId === userId ? key : `${actorId}:${key}`}`,
          )
          .digest("hex");
        const compiled = {
          request: {
            ...f.frozenRequest,
            model: "original-frozen-model",
            prompt: "原prompt不追加guide",
          },
          notes: [
            "wardrobe-material-alpha-probe:v1",
            "wardrobe-masked-correction-probe:v1",
          ],
        };
        await prisma.generationTask.create({
          data: {
            id,
            userId,
            projectId,
            parentAssetId: f.original.id,
            taskType: "inpaint",
            status: "QUEUED",
            input: {},
            compiledPrompt: compiled,
          },
        });
        const assetsBefore = await prisma.designAsset.count({
          where: { projectId },
        });
        const callsBefore = generation.createFromAgent.mock.calls.length;
        const resumedBefore = generation.resumeQueuedTask.mock.calls.length;
        expect(
          await service.createMaterialProbe(actorId, projectId, input),
        ).toEqual({ taskId: id });
        expect(generation.createFromAgent.mock.calls).toHaveLength(callsBefore);
        expect(generation.resumeQueuedTask.mock.calls).toHaveLength(
          resumedBefore + 1,
        );
        expect(generation.resumeQueuedTask.mock.lastCall).toEqual([
          actorId,
          id,
        ]);
        expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
          assetsBefore,
        );
        expect(
          (await prisma.generationTask.findUniqueOrThrow({ where: { id } }))
            .compiledPrompt,
        ).toEqual(compiled);
        await expect(
          service.createMaterialProbe(actorId, projectId, {
            ...input,
            notes: "不能偷换",
          }),
        ).rejects.toThrow("请求标识");
      },
    );

    it("probe同请求键改变名称或ROI在存图和提交任务前拒绝", async () => {
      const f = await materialFixture();
      generation.createFromAgent.mockResolvedValue({
        taskId: "idempotent-probe-admission",
      });
      const input = {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: "原名称",
        category: "top",
        detailRegion: { x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
      };
      await service.createMaterialProbe(userId, projectId, input);
      const assetCount = await prisma.designAsset.count({
        where: { projectId },
      });
      const taskCount = await prisma.generationTask.count({
        where: { projectId },
      });
      const admissions = generation.createFromAgent.mock.calls.length;
      for (const changed of [
        { ...input, name: "另一名称" },
        { ...input, detailRegion: { ...input.detailRegion, width: 0.2 } },
      ])
        await expect(
          service.createMaterialProbe(userId, projectId, changed),
        ).rejects.toThrow("请求标识");
      expect(await prisma.designAsset.count({ where: { projectId } })).toBe(
        assetCount,
      );
      expect(await prisma.generationTask.count({ where: { projectId } })).toBe(
        taskCount,
      );
      expect(generation.createFromAgent.mock.calls).toHaveLength(admissions);
    });

    it("透明派生同请求键换成另一组合法来源在保存派生图前冲突，无孤立资产", async () => {
      const first = await materialFixture();
      const second = await materialFixture();
      const prepared = await service.deriveMaterialCandidate(
        userId,
        projectId,
        first.input,
      );
      const counts = await Promise.all([
        prisma.designAsset.count({ where: { projectId } }),
        prisma.wardrobePreparation.count({ where: { projectId } }),
        prisma.generationTask.count({ where: { projectId } }),
      ]);
      await expect(
        service.deriveMaterialCandidate(userId, projectId, {
          ...second.input,
          requestKey: first.input.requestKey,
        }),
      ).rejects.toThrow("请求标识");
      await expect(
        service.deriveMaterialCandidate(userId, projectId, {
          ...first.input,
          name: "不同名称",
        }),
      ).rejects.toThrow("请求标识");
      expect(
        (await service.deriveMaterialCandidate(userId, projectId, first.input))
          .id,
      ).toBe(prepared.id);
      expect(
        await Promise.all([
          prisma.designAsset.count({ where: { projectId } }),
          prisma.wardrobePreparation.count({ where: { projectId } }),
          prisma.generationTask.count({ where: { projectId } }),
        ]),
      ).toEqual(counts);
    });

    it("显式probe登记同源细节私有资产并提交真实源和蒙版，不将返回task视为已审核", async () => {
      const f = await materialFixture();
      generation.createFromAgent.mockResolvedValueOnce({
        taskId: "explicit-probe-admission",
      });
      const result = await service.createMaterialProbe(userId, projectId, {
        requestKey: requestKey(),
        sourceAssetId: f.original.id,
        maskAssetId: f.mask.id,
        name: f.input.name,
        category: "top",
        detailRegion: { x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
      });
      expect(result).toEqual({ taskId: "explicit-probe-admission" });
      const call = generation.createFromAgent.mock.lastCall;
      expect(call?.[1]).toMatchObject({
        taskType: "inpaint",
        parentAssetId: f.original.id,
        referenceImageUrl: f.original.url,
        maskImageUrl: f.mask.url,
        background: "opaque",
      });
      expect(call?.[1].referenceImageUrls).toHaveLength(2);
      const detail = await prisma.designAsset.findFirstOrThrow({
        where: { url: call?.[1].referenceImageUrls[1] },
      });
      expect(detail).toMatchObject({ projectId, parentAssetId: f.original.id });
      expect(call?.[4].notes).toContain("wardrobe-material-alpha-probe:v1");
    });

    it("侧挂准备拒绝跨项目修订、不同正面来源和把前图直接冒充侧图", async () => {
      const prepared = await service.prepare(userId, projectId, source());
      const item = await service.confirm(userId, projectId, {
        requestKey: requestKey(),
        preparationId: prepared.id,
        assetId,
        name: "侧挂来源约束",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const input = {
        ...source(),
        presentation: {
          view: "side",
          revisionId: item.currentRevision.id,
          orientation: "left",
        },
      };
      await expect(service.prepare(userId, projectId, input)).rejects.toThrow(
        "不能将正面图当作侧挂图",
      );
      await expect(
        service.prepare(userId, otherProjectId, input),
      ).rejects.toThrow("修订不存在");
      await expect(
        service.prepare(userId, projectId, {
          ...input,
          mode: "complete",
          sourceAssetId: opaqueAssetId,
        }),
      ).rejects.toThrow("已确认的正面单品");
      await expect(
        service.prepare(userId, projectId, { ...input, category: "bottom" }),
      ).rejects.toThrow("沿用单品类别");
    });
  },
);
