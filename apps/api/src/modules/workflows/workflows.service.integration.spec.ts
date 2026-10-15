import { prisma, type Prisma } from "@fashion/db";
import { describe, expect, it } from "vitest";

import { WorkflowsService } from "./workflows.service";
import { workflowSemanticPatchSchema } from "./workflows.schemas";

const workflows = new WorkflowsService(prisma);

describe("WorkflowsService persistence integration", () => {
  it("commits an input branch atomically, safely replays it and preserves the running original", async () => {
    const user = await prisma.user.create({
      data: { email: `workflow-input-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Input edits", projects: { create: { name: "Branch test" } } } } },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const a = crypto.randomUUID(), b = crypto.randomUUID(), tool = crypto.randomUUID(), result = crypto.randomUUID();
    const inputId = crypto.randomUUID(), outputId = crypto.randomUUID();
    try {
      await workflows.applySystemMutation(project.id, {
        mode: "semantic", baseRevision: 0, mutationId: crypto.randomUUID(), operations: [
          { type: "add_node", node: { id: a, kind: "asset", type: "candidate", title: "母图 A", payload: {}, x: 0, y: 0 } },
          { type: "add_node", node: { id: b, kind: "asset", type: "candidate", title: "母图 B", payload: {}, x: 0, y: 300 } },
          { type: "add_node", node: { id: tool, kind: "tool", type: "edit_design", title: "局部修改", status: "running", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "修改袖口", taskType: "inpaint", maskImageUrl: "old-mask", referenceImageUrl: "old-image", parentAssetId: "old-parent" }, error: "old-error" }, x: 400, y: 0 } },
          { type: "add_node", node: { id: result, kind: "asset", type: "candidate", title: "已有结果", payload: {}, x: 800, y: 0 } },
          { type: "add_edge", edge: { id: inputId, sourceNodeId: a, targetNodeId: tool, sourcePort: "out", targetPort: "source" } },
          { type: "add_edge", edge: { id: outputId, sourceNodeId: tool, targetNodeId: result, sourcePort: "out", targetPort: "source" } },
        ],
      });
      const attempt = await prisma.workflowAttempt.create({ data: { projectId: project.id, toolNodeId: tool, ordinal: 1, executionKey: crypto.randomUUID(), status: "running", requestSnapshot: { inputNodeIds: [a] } } });
      const original = await workflows.get(user.id, project.id);
      const branchId = crypto.randomUUID();
      const planned = { targetId: branchId, operations: [
        { type: "add_node", node: { id: branchId, kind: "tool", type: "edit_design", title: "局部修改 · 分支", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "修改袖口", taskType: "i2i" } }, x: 400, y: 300 } },
        { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: b, targetNodeId: branchId, sourcePort: "out", targetPort: "source" } },
      ] };
      const request = workflowSemanticPatchSchema.parse({ mode: "semantic", baseRevision: original.revision, mutationId: crypto.randomUUID(), operations: planned.operations });
      // Validation must roll back the new node as well as its edges.
      const invalid = workflowSemanticPatchSchema.parse({ ...request, mutationId: crypto.randomUUID(), operations: [...planned.operations, { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: a, targetNodeId: planned.targetId, sourcePort: "out", targetPort: "source" } }] });
      await expect(workflows.patch(user.id, project.id, invalid)).rejects.toMatchObject({ status: 400 });
      expect(await workflows.get(user.id, project.id)).toEqual(original);
      const saved = await workflows.patch(user.id, project.id, request);
      expect(saved.nodes.find((item) => item.id === planned.targetId)).toMatchObject({ status: "ready", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "修改袖口", taskType: "i2i" } } });
      expect(saved.nodes.find((item) => item.id === planned.targetId)?.payload).not.toHaveProperty("error");
      expect(saved.nodes.find((item) => item.id === planned.targetId)?.payload).not.toHaveProperty("params.maskImageUrl");
      expect(saved.nodes.find((item) => item.id === tool)).toEqual(original.nodes.find((item) => item.id === tool));
      expect(saved.edges.filter((item) => item.id === inputId || item.id === outputId)).toEqual(original.edges);
      expect(await prisma.workflowAttempt.findUnique({ where: { id: attempt.id } })).toEqual(attempt);
      expect(await prisma.workflowAttempt.count({ where: { toolNodeId: planned.targetId } })).toBe(0);
      const replay = await workflows.patch(user.id, project.id, request);
      expect(replay.revision).toBe(saved.revision);
      expect(replay.nodes).toHaveLength(saved.nodes.length);
      await expect(workflows.patch(user.id, project.id, { ...request, mutationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
      expect((await workflows.get(user.id, project.id)).nodes).toHaveLength(saved.nodes.length);
    } finally {
      await prisma.workflowAttempt.deleteMany({ where: { projectId: project.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
  it("returns one consistent graph revision while another window commits a new node", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-read-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Read workspace",
            projects: { create: { name: "Read project" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    const signal = () => {
      let resolve: (() => void) | undefined;
      return {
        promise: new Promise<void>((done) => {
          resolve = done;
        }),
        complete: () => resolve?.(),
      };
    };
    const revisionRead = signal();
    const writeCompleted = signal();
    const wrapClient = <T extends object>(client: T): T =>
      new Proxy(client, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (key === "$transaction" && typeof value === "function")
            return (
              callback: (
                transaction: Prisma.TransactionClient,
              ) => Promise<unknown>,
              options: unknown,
            ) =>
              Reflect.apply(value, target, [
                (transaction: Prisma.TransactionClient) =>
                  callback(wrapClient(transaction)),
                options,
              ]);
          if (
            (key === "workflowGraph" || key === "workflowNode") &&
            value &&
            typeof value === "object"
          )
            return new Proxy(value, {
              get(delegate, method) {
                const operation: unknown = Reflect.get(delegate, method);
                if (typeof operation !== "function") return operation;
                if (key === "workflowGraph" && method === "findUnique")
                  return async (...args: unknown[]) => {
                    const value = await Reflect.apply(
                      operation,
                      delegate,
                      args,
                    );
                    revisionRead.complete();
                    return value;
                  };
                if (key === "workflowNode" && method === "findMany")
                  return async (...args: unknown[]) => {
                    await writeCompleted.promise;
                    return Reflect.apply(operation, delegate, args);
                  };
                return operation;
              },
            });
          return Reflect.get(target, key, receiver);
        },
      });
    try {
      if (!project) throw new Error("并发读取验收项目创建失败");
      const firstId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic",
        baseRevision: 0,
        mutationId: crypto.randomUUID(),
        operations: [
          {
            type: "add_node",
            node: {
              id: firstId,
              kind: "asset",
              type: "brief",
              title: "设计需求",
              payload: { text: "通勤风衣" },
              x: 0,
              y: 0,
            },
          },
        ],
      });
      const reading = new WorkflowsService(wrapClient(prisma)).get(
        user.id,
        project.id,
      );
      await revisionRead.promise;
      await workflows.patch(user.id, project.id, {
        mode: "semantic",
        baseRevision: 1,
        mutationId: crypto.randomUUID(),
        operations: [
          {
            type: "add_node",
            node: {
              id: crypto.randomUUID(),
              kind: "asset",
              type: "reference_text",
              title: "新参考",
              payload: { text: "藏蓝色" },
              x: 0,
              y: 300,
            },
          },
        ],
      });
      writeCompleted.complete();
      const snapshot = await reading;
      expect(snapshot.revision).toBe(1);
      expect(snapshot.nodes.map((node) => node.id)).toEqual([firstId]);
      const latest = await workflows.get(user.id, project.id);
      expect(latest.revision).toBe(2);
      expect(latest.nodes).toHaveLength(2);
    } finally {
      writeCompleted.complete();
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
  it("links a completed candidate to its real series without changing the frozen design", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-series-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Series workspace",
            projects: { create: { name: "Series project" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    try {
      if (!project) throw new Error("系列验收项目创建失败");
      const asset = await prisma.designAsset.create({
        data: {
          projectId: project.id,
          rootAssetId: crypto.randomUUID(),
          operation: "GENERATED",
          url: "s3://workflow-series.png",
        },
      });
      const other = await prisma.designAsset.create({
        data: {
          projectId: project.id,
          rootAssetId: crypto.randomUUID(),
          operation: "GENERATED",
          url: "s3://workflow-other.png",
        },
      });
      const collection = await prisma.collection.create({
        data: {
          projectId: project.id,
          heroAssetId: asset.id,
          name: "通勤系列",
        },
      });
      const otherCollection = await prisma.collection.create({
        data: {
          projectId: project.id,
          heroAssetId: other.id,
          name: "其他系列",
        },
      });
      const nodeId = crypto.randomUUID();
      await workflows.applySystemMutation(project.id, {
        mode: "semantic",
        baseRevision: 0,
        mutationId: crypto.randomUUID(),
        operations: [
          {
            type: "add_node",
            node: {
              id: nodeId,
              kind: "asset",
              type: "candidate",
              title: "候选 A",
              payload: { assetId: asset.id, text: "保留藏蓝色" },
              status: "completed",
              x: 10,
              y: 20,
            },
          },
        ],
      });
      const request = workflowSemanticPatchSchema.parse({
        mode: "semantic",
        baseRevision: 1,
        mutationId: crypto.randomUUID(),
        operations: [
          { type: "link_collection", nodeId, collectionId: collection.id },
        ],
      });
      const linked = await workflows.patch(user.id, project.id, request);
      expect(linked.nodes[0]).toMatchObject({
        status: "completed",
        title: "候选 A",
        payload: {
          assetId: asset.id,
          text: "保留藏蓝色",
          collectionId: collection.id,
        },
      });
      expect(
        (await workflows.patch(user.id, project.id, request)).revision,
      ).toBe(2);
      await expect(
        workflows.patch(
          user.id,
          project.id,
          workflowSemanticPatchSchema.parse({
            mode: "semantic",
            baseRevision: 2,
            mutationId: crypto.randomUUID(),
            operations: [
              {
                type: "link_collection",
                nodeId,
                collectionId: otherCollection.id,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          baseRevision: 2,
          mutationId: crypto.randomUUID(),
          operations: [
            { type: "update_node", nodeId, payload: { assetId: other.id } },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await workflows.get(user.id, project.id)).revision).toBe(2);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
  it("persists a typed path, separates layout revisions and safely replays a mutation", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Workflow workspace",
            projects: { create: { name: "Workflow project" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];

    try {
      expect(project).toBeDefined();
      if (!project) return;

      const initial = {
        mode: "semantic" as const,
        mutationId: crypto.randomUUID(),
        baseRevision: 0,
        operations: [
          {
            type: "add_node" as const,
            node: {
              id: "brief",
              kind: "asset" as const,
              type: "brief" as const,
              title: "设计需求",
              payload: { text: "秋冬通勤风衣" },
              x: 0,
              y: 0,
            },
          },
          {
            type: "add_node" as const,
            node: {
              id: "analysis",
              kind: "tool" as const,
              type: "analyze_brief" as const,
              title: "需求分析",
              payload: {
                toolKey: "analyze_brief",
                toolVersion: "1",
                params: {},
              },
              x: 200,
              y: 0,
            },
          },
          {
            type: "add_node" as const,
            node: {
              id: "constraint",
              kind: "asset" as const,
              type: "constraint" as const,
              title: "设计约束",
              payload: { text: "保留肩线" },
              x: 400,
              y: 0,
            },
          },
          {
            type: "add_edge" as const,
            edge: {
              id: "goal",
              sourceNodeId: "brief",
              targetNodeId: "analysis",
              sourcePort: "out" as const,
              targetPort: "goal" as const,
            },
          },
          {
            type: "add_edge" as const,
            edge: {
              id: "output",
              sourceNodeId: "analysis",
              targetNodeId: "constraint",
              sourcePort: "out" as const,
              targetPort: "source" as const,
            },
          },
        ],
      };
      const created = await workflows.patch(user.id, project.id, initial);
      expect(created).toMatchObject({
        revision: 1,
        layoutRevision: 0,
        legacyAvailable: false,
      });
      expect(created.nodes).toHaveLength(3);
      expect(created.edges).toHaveLength(2);
      await expect(workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 1,
        operations: [{ type: "remove_edge", edgeId: "output" }],
      })).rejects.toThrow("结果来源由工具执行维护");

      const replay = await workflows.patch(user.id, project.id, initial);
      expect(replay.revision).toBe(1);
      expect(replay.nodes).toHaveLength(3);

      const moved = await workflows.patch(user.id, project.id, {
        mode: "layout",
        mutationId: crypto.randomUUID(),
        baseLayoutRevision: 0,
        positions: [{ nodeId: "analysis", x: 250, y: 100 }],
      });
      expect(moved).toMatchObject({ revision: 1, layoutRevision: 1 });
      expect(moved.nodes.find((node) => node.id === "analysis")).toMatchObject({
        x: 250,
        y: 100,
      });

      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          baseRevision: 0,
          operations: [{ type: "remove_edge", edgeId: "goal" }],
        }),
      ).rejects.toMatchObject({ status: 409 });

      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          baseRevision: 1,
          operations: [
            {
              type: "add_edge",
              edge: {
                id: "wrong",
                sourceNodeId: "brief",
                targetNodeId: "analysis",
                sourcePort: "out",
                targetPort: "candidate",
              },
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await workflows.get(user.id, project.id)).revision).toBe(1);

      await workflows.applySystemMutation(project.id, {
        mode: "semantic",
        mutationId: crypto.randomUUID(),
        baseRevision: 1,
        operations: [
          { type: "update_node", nodeId: "analysis", status: "completed" },
        ],
      });
      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          baseRevision: 2,
          operations: [
            {
              type: "update_node",
              nodeId: "brief",
              payload: { text: "偷偷覆盖旧需求" },
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          baseRevision: 2,
          operations: [{ type: "remove_node", nodeId: "brief" }],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (await workflows.get(user.id, project.id)).nodes.find(
          (node) => node.id === "brief",
        )?.payload,
      ).toMatchObject({ text: "秋冬通勤风衣" });

      await expect(
        workflows.patch(user.id, project.id, {
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          baseRevision: 2,
          operations: [
            {
              type: "add_node",
              node: {
                id: "candidate-a",
                kind: "asset",
                type: "candidate",
                title: "候选 A",
                payload: {},
                x: 500,
                y: 400,
              },
            },
            {
              type: "add_node",
              node: {
                id: "candidate-b",
                kind: "asset",
                type: "candidate",
                title: "候选 B",
                payload: {},
                x: 900,
                y: 400,
              },
            },
            {
              type: "add_node",
              node: {
                id: "edit",
                kind: "tool",
                type: "edit_design",
                title: "局部修改",
                payload: {
                  toolKey: "edit_design",
                  toolVersion: "1",
                  params: {},
                },
                x: 700,
                y: 400,
              },
            },
            {
              type: "add_edge",
              edge: {
                id: "candidate-a-edit",
                sourceNodeId: "candidate-a",
                targetNodeId: "edit",
                sourcePort: "out",
                targetPort: "source",
              },
            },
            {
              type: "add_edge",
              edge: {
                id: "edit-candidate-b",
                sourceNodeId: "edit",
                targetNodeId: "candidate-b",
                sourcePort: "out",
                targetPort: "source",
              },
            },
            {
              type: "add_edge",
              edge: {
                id: "candidate-b-edit",
                sourceNodeId: "candidate-b",
                targetNodeId: "edit",
                sourcePort: "out",
                targetPort: "source",
              },
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await workflows.get(user.id, project.id)).revision).toBe(2);
      await expect(
        workflows.get("another-user", project.id),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
