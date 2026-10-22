import { DesignAssetOperation, FileStatus, prisma } from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AgentConversationsService } from "../agent-conversations/agent-conversations.service";
import { FilesService } from "../files/files.service";
import { ProjectsService } from "../projects/projects.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "./workflows.service";
import { BoardsService } from "../boards/boards.service";
import { BoardElementsService } from "../board-elements/board-elements.service";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { ExportsService } from "../exports/exports.service";
import { GenerationMaskService } from "../generation/generation-mask.service";
import { GenerationService } from "../generation/generation.service";
import { requireProjectFile } from "../files/project-file-access";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ProjectsController } from "../projects/projects.controller";
import { BoardElementsController } from "../board-elements/board-elements.controller";
import { BillingService } from "../billing/billing.service";
import { ContextCompilerService } from "../generation/compiler/context-compiler.service";

describe("shared project authorization persistence", () => {
  it("enforces the role matrix across legacy reads, edits, deletion, generation, exports and project-scoped files", async () => {
    const owner = await prisma.user.create({
      data: {
        email: `access-owner-${randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Access matrix",
            projects: { create: [{ name: "A" }, { name: "B" }] },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const member = await prisma.user.create({
      data: { email: `access-member-${randomUUID()}@example.com` },
    });
    const workspace = owner.ownedWorkspaces[0];
    if (!workspace) throw new Error("Missing workspace");
    const [a, b] = workspace.projects;
    if (!a || !b) throw new Error("Missing projects");
    const access = new ProjectAccessPolicy(prisma);
    const storage = {
      createDownloadUrl: vi
        .fn()
        .mockResolvedValue("https://private.test/signed"),
      createUploadUrl: vi.fn().mockResolvedValue("https://private.test/upload"),
    };
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const projects = new ProjectsService(prisma, access);
    const boards = new BoardsService(prisma, storage as never, access);
    const elements = new BoardElementsService(prisma, queue as never, access);
    const assets = new DesignAssetsService(prisma, storage as never, access);
    const masks = new GenerationMaskService(prisma, storage as never, access);
    const exports = new ExportsService(prisma, queue, storage as never, access);
    const compiler = new ContextCompilerService(
      prisma,
      { analyzeImage: vi.fn(), enhancePrompt: vi.fn() },
      storage as never,
      access,
    );
    const compile = vi.spyOn(compiler, "compile");
    const generation = new GenerationService(
      prisma,
      queue,
      new BillingService(prisma),
      compiler,
      storage as never,
      access,
    );
    const module = await Test.createTestingModule({
      controllers: [ProjectsController, BoardElementsController],
      providers: [
        { provide: ProjectsService, useValue: projects },
        { provide: BoardElementsService, useValue: elements },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.use(
      (
        req: { headers: Record<string, string>; auth: unknown },
        _res: unknown,
        next: () => void,
      ) => {
        req.auth = { userId: req.headers["x-test-user"] };
        next();
      },
    );
    await app.init();
    try {
      const membership = await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: "EDITOR" },
      });
      const file = await prisma.fileAsset.create({
        data: {
          ownerId: owner.id,
          originalName: "shared.png",
          mimeType: "image/png",
          sizeBytes: 10,
          sha256: randomUUID().padEnd(64, "0"),
          objectKey: `tests/access/${randomUUID()}`,
          status: FileStatus.READY,
        },
      });
      const asset = await assets.importFile(owner.id, a.id, file.id);
      await elements.registerInference(owner.id, a.id, "shape:shared", file.id);
      const doc = await prisma.studioDocument.create({
        data: {
          projectId: a.id,
          documentId: randomUUID(),
          revision: 1,
          type: "TECH_PACK",
          payload: {},
          createdById: owner.id,
          ownerId: owner.id,
        },
      });
      const job = await exports.create(
        owner.id,
        {
          sourceType: "asset",
          assetId: asset.id,
          format: "png",
          quality: "standard",
        },
        randomUUID(),
      );
      for (const role of ["OWNER", "EDITOR", "REVIEWER", "VIEWER"] as const) {
        await prisma.workspaceMember.update({
          where: { id: membership.id },
          data: { role },
        });
        const userId = role === "OWNER" ? owner.id : member.id;
        await expect(projects.get(userId, a.id)).resolves.toMatchObject({
          id: a.id,
        });
        await expect(boards.get(userId, a.id)).resolves.toMatchObject({
          revision: 0,
        });
        await expect(
          elements.getRole(userId, a.id, "shape:shared"),
        ).resolves.toMatchObject({ shapeId: "shape:shared" });
        await request(app.getHttpServer())
          .get(`/projects/${a.id}`)
          .set("x-test-user", userId)
          .expect(200);
        await request(app.getHttpServer())
          .get(`/projects/${a.id}/board-elements/shape:shared/role`)
          .set("x-test-user", userId)
          .expect(200);
        await expect(
          assets.downloadUrl(userId, asset.id, "content"),
        ).resolves.toBe("https://private.test/signed");
        await expect(exports.get(userId, job.id)).resolves.toMatchObject({
          id: job.id,
        });
        await expect(
          exports.list(userId, {
            projectId: a.id,
            sourceType: "asset",
            sourceId: asset.id,
            page: 1,
            limit: 20,
          }),
        ).resolves.toMatchObject({ total: 1 });
        await expect(
          exports.create(userId, {
            sourceType: "tech_pack",
            studioRevisionId: doc.id,
            format: "pdf",
            quality: "standard",
          }),
        ).resolves.toHaveProperty("id");
        const editing = role === "OWNER" || role === "EDITOR";
        await request(app.getHttpServer())
          .patch(`/projects/${a.id}`)
          .set("x-test-user", userId)
          .send({ name: `HTTP-${role}` })
          .expect(editing ? 200 : 403);
        const changes = [
          () => projects.update(userId, a.id, { name: `A-${role}` }),
          () =>
            elements.setRoles(userId, a.id, {
              shapeIds: ["shape:shared"],
              role: "style_ref",
            }),
          () =>
            masks.sign(userId, {
              projectId: a.id,
              width: 512,
              height: 512,
              size: 10,
              checksumSha256: "a".repeat(44),
            }),
          () => assets.importFile(userId, a.id, file.id),
        ];
        for (const change of changes) {
          if (editing) await expect(change()).resolves.toBeDefined();
          else
            await expect(change()).rejects.toBeInstanceOf(ForbiddenException);
        }
        if (!editing) {
          await expect(
            boards.patch(userId, a.id, {
              baseRevision: 0,
              batchId: randomUUID(),
              patches: [],
              snapshot: {},
            }),
          ).rejects.toBeInstanceOf(ForbiddenException);
          await expect(
            generation.create(userId, {
              taskType: "t2i",
              projectId: a.id,
              prompt: "coat",
              width: 512,
              height: 512,
            } as never),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(compile).not.toHaveBeenCalled();
        }
        if (role !== "OWNER") {
          await expect(projects.remove(userId, b.id)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          await request(app.getHttpServer())
            .delete(`/projects/${b.id}`)
            .set("x-test-user", userId)
            .expect(403);
        }
      }
      await prisma.workspaceMember.update({
        where: { id: membership.id },
        data: { role: "EDITOR" },
      });
      // Both projects are readable, but sharing in A cannot authorize introducing the owner's file in B.
      await expect(
        requireProjectFile(prisma, access, member.id, file.id, a.id),
      ).resolves.toHaveProperty("id", file.id);
      await expect(
        requireProjectFile(prisma, access, member.id, file.id, b.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        assets.importFile(member.id, b.id, file.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        elements.registerInference(member.id, b.id, "shape:stolen", file.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        boards.patch(member.id, b.id, {
          baseRevision: 0,
          batchId: randomUUID(),
          snapshot: {},
          patches: [
            {
              deleted: false,
              shapeId: "shape:stolen",
              shapeType: "fashion-image",
              role: "style_ref",
              record: { props: { fileId: file.id } },
            },
          ],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const foreignId = randomUUID();
      await prisma.designAsset.create({
        data: {
          id: foreignId,
          rootAssetId: foreignId,
          projectId: b.id,
          operation: DesignAssetOperation.IMPORTED,
          url: "s3://tests/foreign.png",
        },
      });
      await expect(
        boards.patch(member.id, a.id, {
          baseRevision: 0,
          batchId: randomUUID(),
          patches: [],
          snapshot: {
            document: {
              store: {
                foreign: { typeName: "shape", props: { assetId: foreignId } },
              },
            },
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        projects.duplicate(member.id, a.id, randomUUID()),
      ).resolves.toHaveProperty("id");
      const fabricFile = await prisma.fileAsset.create({
        data: {
          ownerId: owner.id,
          originalName: "fabric.png",
          mimeType: "image/png",
          sizeBytes: 10,
          sha256: randomUUID().padEnd(64, "0"),
          objectKey: `tests/access/${randomUUID()}`,
          status: FileStatus.READY,
        },
      });
      const fabric = await prisma.fabric.create({
        data: {
          scope: "USER",
          ownerId: owner.id,
          mainFileId: fabricFile.id,
          tags: ["silk"],
        },
      });
      await boards.patch(owner.id, b.id, {
        baseRevision: 0,
        batchId: randomUUID(),
        snapshot: {},
        patches: [
          {
            deleted: false,
            shapeId: "shape:fabric",
            shapeType: "fashion-fabric",
            role: "fabric_ref",
            record: { props: { fabricId: fabric.id } },
          },
        ],
      });
      await expect(
        requireProjectFile(prisma, access, member.id, fabricFile.id, b.id),
      ).resolves.toHaveProperty("id", fabricFile.id);
      await expect(
        requireProjectFile(prisma, access, member.id, fabricFile.id, a.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const fabricContext = await compiler.compile(
        member.id,
        b.id,
        "coat",
        undefined,
        { modelCalls: "skip" },
      );
      expect(fabricContext.fabricReferences).toEqual([
        expect.objectContaining({ fabricId: fabric.id, labels: ["silk"] }),
      ]);
      const generated = await generation.createFromAgent(
        member.id,
        {
          taskType: "t2i",
          projectId: a.id,
          prompt: "coat",
          width: 1024,
          height: 1024,
        } as never,
        randomUUID(),
        "coat",
      );
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: generated.taskId },
      });
      expect(task.userId).toBe(owner.id);
      expect(task.compiledPrompt).toMatchObject({ executionActor: member.id });
      expect(compile).toHaveBeenCalledWith(member.id, a.id, "coat", undefined, {
        modelCalls: "skip",
      });
      await expect(
        generation.createFromAgent(
          member.id,
          {
            taskType: "i2i",
            projectId: a.id,
            parentAssetId: foreignId,
            prompt: "coat",
            width: 1024,
            height: 1024,
          } as never,
          randomUUID(),
          "coat",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await prisma.workspaceMember.delete({ where: { id: membership.id } });
      await expect(exports.get(member.id, job.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        exports.list(member.id, {
          projectId: a.id,
          sourceType: "asset",
          sourceId: asset.id,
          page: 1,
          limit: 20,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(boards.get(member.id, a.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await request(app.getHttpServer())
        .get(`/projects/${a.id}`)
        .set("x-test-user", member.id)
        .expect(403);
      await projects.remove(owner.id, a.id);
      await expect(
        assets.downloadUrl(owner.id, asset.id, "content"),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        requireProjectFile(prisma, access, member.id, file.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await app.close();
      await prisma.studioDocument.deleteMany({
        where: { project: { wsId: workspace.id } },
      });
      await prisma.fabric.deleteMany({ where: { ownerId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.user.delete({ where: { id: member.id } });
    }
  });
  it("applies current roles and revocation across workflow, personal conversations, lists and referenced private files", async () => {
    const owner = await prisma.user.create({
      data: {
        email: `sharing-owner-${randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Sharing test",
            projects: { create: { name: "Shared design" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const workspace = owner.ownedWorkspaces[0];
    const project = workspace?.projects[0];
    if (!workspace || !project) throw new Error("Missing project fixture");
    const member = await prisma.user.create({
      data: { email: `sharing-member-${randomUUID()}@example.com` },
    });
    const access = new ProjectAccessPolicy(prisma);
    const workflows = new WorkflowsService(prisma, access);
    const projects = new ProjectsService(prisma, access);
    const storage = {
      createDownloadUrl: vi
        .fn()
        .mockResolvedValue("https://private.test/signed"),
      readPrefix: vi.fn(),
    };
    const files = new FilesService(
      prisma,
      storage as never,
      { enqueue: vi.fn() },
      access,
    );
    const conversations = new AgentConversationsService(
      prisma,
      {} as never,
      {} as never,
      storage as never,
      undefined,
      undefined,
      access,
    );
    const sharedNodeId = randomUUID();
    try {
      const membership = await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: "EDITOR" },
      });
      const makeFile = async () =>
        prisma.fileAsset.create({
          data: {
            ownerId: owner.id,
            originalName: "布样.png",
            mimeType: "image/png",
            sizeBytes: 100,
            sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
            objectKey: `tests/sharing/${randomUUID()}`,
            status: FileStatus.READY,
            thumbnail1024Key: `tests/sharing/${randomUUID()}.webp`,
          },
        });
      const shared = await makeFile();
      const privateFile = await makeFile();
      const fabric = await prisma.fabric.create({
        data: {
          ownerId: owner.id,
          scope: "USER",
          mainFileId: shared.id,
          tags: ["棉"],
        },
      });
      await workflows.patch(owner.id, project.id, {
        mode: "semantic",
        mutationId: randomUUID(),
        baseRevision: 0,
        operations: [
          {
            type: "add_node",
            node: {
              id: sharedNodeId,
              kind: "asset",
              type: "fabric",
              title: "共享布样",
              payload: { fabricId: fabric.id },
              x: 0,
              y: 0,
            },
          },
        ],
      });
      // A shared fabric may be retained when a different editor saves the graph.
      await workflows.patch(member.id, project.id, {
        mode: "semantic",
        mutationId: randomUUID(),
        baseRevision: 1,
        operations: [
          { type: "update_node", nodeId: sharedNodeId, title: "已复核布样" },
        ],
      });
      expect(
        (
          await projects.list(member.id, {
            page: 1,
            limit: 20,
            archived: "active",
            search: "",
          })
        ).items.map((item) => item.id),
      ).toContain(project.id);
      const conversation = await conversations.create(member.id, project.id, {
        title: "个人对话",
      });
      await expect(
        conversations.messages(owner.id, conversation.id, { limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      for (const role of ["REVIEWER", "VIEWER"] as const) {
        await prisma.workspaceMember.update({
          where: { id: membership.id },
          data: { role },
        });
        expect(
          (await workflows.get(member.id, project.id)).nodes[0]?.canDelete,
        ).toBe(false);
        await expect(
          workflows.patch(member.id, project.id, {
            mode: "semantic",
            mutationId: randomUUID(),
            baseRevision: 2,
            operations: [
              { type: "update_node", nodeId: sharedNodeId, title: "越权" },
            ],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          conversations.create(member.id, project.id, {}),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await files.thumbnailUrl(member.id, shared.id, "1024")).toBe(
        "https://private.test/signed",
      );
      await expect(
        files.thumbnailUrl(member.id, privateFile.id, "1024"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await prisma.workspaceMember.delete({ where: { id: membership.id } });
      await expect(
        files.thumbnailUrl(member.id, shared.id, "1024"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(workflows.get(member.id, project.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        conversations.messages(member.id, conversation.id, { limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        (
          await projects.list(member.id, {
            page: 1,
            limit: 20,
            archived: "active",
            search: "",
          })
        ).items,
      ).toEqual([]);
      expect(storage.createDownloadUrl).toHaveBeenCalledOnce();
    } finally {
      await prisma.fabric.deleteMany({ where: { ownerId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.user.delete({ where: { id: member.id } });
    }
  });
});
