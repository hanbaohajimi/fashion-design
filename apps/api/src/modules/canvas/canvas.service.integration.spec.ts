import { prisma } from "@fashion/db";
import { describe, expect, it } from "vitest";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { canvasObject, CanvasService } from "./canvas.service";
import { CanvasCommandService } from "../workflow-runtime/canvas-command.service";
import type { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";

const workflows = new WorkflowsService(prisma);
const canvas = new CanvasService(
  prisma,
  new ProjectAccessPolicy(prisma),
  workflows,
);
const commands = new CanvasCommandService(
  canvas,
  workflows,
  {} as WorkflowRuntimeService,
);
async function fixture() {
  const user = await prisma.user.create({
    data: {
      email: `canvas-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Canvas",
          projects: { create: { name: "Canvas integration" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("fixture project missing");
  return { user, project };
}
describe("independent canvas persistence", () => {
  it("imports a material batch atomically and replays all bindings once", async () => {
    const { user, project } = await fixture();
    try {
      const before = await canvas.initialize(user.id, project.id);
      const batch = { type: "import_materials" as const, mutationId: crypto.randomUUID(), materials: [
        { materialType: "reference_text" as const, title: "来源资料", payload: { text: "海风" }, shapeId: "shape:batch-text" },
        { materialType: "swatch" as const, title: "配套色卡", payload: { colors: [{ hex: "invalid", name: "海蓝" }] }, shapeId: "shape:batch-palette" },
      ] };
      await expect(commands.execute(user.id, project.id, batch)).rejects.toMatchObject({ status: 400 });
      expect(await prisma.workflowNode.count({ where: { projectId: project.id } })).toBe(0);
      expect(await prisma.canvasObjectBinding.count({ where: { projectId: project.id } })).toBe(0);
      expect((await canvas.read(user.id, project.id)).revision).toBe(before.revision);
      batch.materials[1] = { materialType: "swatch", title: "配套色卡", payload: { colors: [{ hex: "#112233", name: "海蓝" }] }, shapeId: "shape:batch-palette" };
      const [first, second] = await Promise.all([commands.execute(user.id, project.id, batch), commands.execute(user.id, project.id, batch)]);
      expect(first.nodeId).toBe(second.nodeId);
      expect(second.graph.nodes).toHaveLength(2);
      expect(second.canvas.bindings).toHaveLength(2);
      expect(second.canvas.revision).toBe(before.revision + 1);
      expect(await prisma.canvasMutation.count({ where: { projectId: project.id } })).toBe(1);
    } finally { await prisma.user.delete({ where: { id: user.id } }); }
  });

  it("forks consumed material while preserving other placements and the execution snapshot", async () => {
    const { user, project } = await fixture();
    try {
      await canvas.initialize(user.id, project.id);
      const created = await commands.execute(user.id, project.id, {
        type: "create_material",
        mutationId: crypto.randomUUID(),
        materialType: "reference_text",
        title: "已用素材",
        payload: { text: "原需求" },
        shapeId: "shape:original",
      });
      await prisma.canvasObjectBinding.create({
        data: {
          projectId: project.id,
          shapeId: "shape:copy",
          nodeId: created.nodeId,
        },
      });
      const frozen = {
        inputNodeIds: [created.nodeId],
        inputSnapshot: [{ id: created.nodeId, payload: { text: "原需求" } }],
      };
      await prisma.workflowExecution.create({
        data: {
          projectId: project.id,
          toolNodeId: "historic-tool",
          userId: user.id,
          executionKey: crypto.randomUUID(),
          status: "completed",
          requestSnapshot: frozen,
        },
      });
      const command = {
        type: "update_material" as const,
        mutationId: crypto.randomUUID(),
        nodeId: created.nodeId,
        shapeId: "shape:copy",
        payload: { text: "新需求" },
      };
      const result = await commands.execute(user.id, project.id, command);
      expect(result.nodeId).not.toBe(created.nodeId);
      expect(
        result.canvas.bindings.find(
          (binding) => binding.shapeId === "shape:original",
        )?.nodeId,
      ).toBe(created.nodeId);
      expect(
        result.canvas.bindings.find(
          (binding) => binding.shapeId === "shape:copy",
        )?.nodeId,
      ).toBe(result.nodeId);
      expect(
        result.graph.nodes.find((node) => node.id === created.nodeId)?.payload,
      ).toEqual({ text: "原需求" });
      expect(
        (await commands.execute(user.id, project.id, command)).nodeId,
      ).toBe(result.nodeId);
      expect(
        (
          await prisma.workflowExecution.findFirstOrThrow({
            where: { projectId: project.id },
          })
        ).requestSnapshot,
      ).toEqual(frozen);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("keeps viewers read-only and rejects archived writes without changing the document", async () => {
    const { user, project } = await fixture();
    const viewer = await prisma.user.create({
      data: { email: `canvas-viewer-${crypto.randomUUID()}@example.com` },
    });
    try {
      await prisma.workspaceMember.create({
        data: { workspaceId: project.wsId, userId: viewer.id, role: "VIEWER" },
      });
      expect((await canvas.initialize(viewer.id, project.id)).canEdit).toBe(
        false,
      );
      expect(
        await prisma.canvasDocument.count({ where: { projectId: project.id } }),
      ).toBe(0);
      const initialized = await canvas.initialize(user.id, project.id);
      await expect(
        commands.execute(viewer.id, project.id, {
          type: "create_material",
          mutationId: crypto.randomUUID(),
          materialType: "reference_text",
          title: "不能写入",
          payload: {},
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        canvas.setMode(viewer.id, project.id, "node"),
      ).rejects.toMatchObject({ status: 403 });
      await prisma.project.update({
        where: { id: project.id },
        data: { archived: true },
      });
      await expect(
        canvas.save(user.id, project.id, {
          mutationId: crypto.randomUUID(),
          baseRevision: initialized.revision,
          snapshot: {},
          bindings: [],
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await canvas.read(viewer.id, project.id)).revision).toBe(
        initialized.revision,
      );
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.user.delete({ where: { id: viewer.id } });
    }
  });

  it("initializes concurrently, preserves original data and blocks public graph edits", async () => {
    const { user, project } = await fixture();
    try {
      await workflows.patch(user.id, project.id, {
        mode: "semantic",
        mutationId: crypto.randomUUID(),
        baseRevision: 0,
        operations: [
          {
            type: "add_node",
            node: {
              id: "brief",
              kind: "asset",
              type: "brief",
              title: "需求",
              payload: { text: "外套" },
              x: 10,
              y: 20,
            },
          },
        ],
      });
      const historical = {
        document: {
          store: {
            "shape:outdated": {
              id: "shape:outdated",
              typeName: "shape",
              type: "fashion-note",
              props: { text: "旧阶段资料" },
            },
          },
        },
      };
      await prisma.boardSnapshot.create({
        data: { projectId: project.id, snapshot: historical },
      });
      const original = await workflows.get(user.id, project.id);
      const results = await Promise.all([
        canvas.initialize(user.id, project.id),
        canvas.initialize(user.id, project.id),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]?.bindings).toHaveLength(1);
      expect(results[0]?.initializedFrom).toBe("workflow");
      expect(results[0]?.snapshot).toEqual({});
      expect(
        (
          await prisma.boardSnapshot.findUniqueOrThrow({
            where: { projectId: project.id },
          })
        ).snapshot,
      ).toEqual(historical);
      expect(await workflows.get(user.id, project.id)).toEqual(original);
      await expect(
        workflows.patch(user.id, project.id, {
          mode: "layout",
          mutationId: crypto.randomUUID(),
          baseLayoutRevision: 0,
          positions: [{ nodeId: "brief", x: 50, y: 80 }],
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("keeps layout independent, deduplicates writes and does not resurrect removed placements", async () => {
    const { user, project } = await fixture();
    try {
      await canvas.initialize(user.id, project.id);
      const command = {
        type: "create_material" as const,
        mutationId: crypto.randomUUID(),
        materialType: "reference_text" as const,
        title: "素材",
        payload: { text: "海风" },
        shapeId: "shape:material",
      };
      const created = await commands.execute(user.id, project.id, command);
      const replay = await commands.execute(user.id, project.id, command);
      expect(replay.nodeId).toBe(created.nodeId);
      const before = await workflows.get(user.id, project.id);
      const save = {
        mutationId: crypto.randomUUID(),
        baseRevision: replay.canvas.revision,
        snapshot: {
          document: {
            store: {
              "shape:material": {
                id: "shape:material",
                typeName: "shape",
                type: "fashion-note",
                x: 400,
                y: 900,
              },
            },
          },
        },
        bindings: [{ shapeId: "shape:material", nodeId: created.nodeId }],
      };
      const saved = await canvas.save(user.id, project.id, save);
      expect((await canvas.save(user.id, project.id, save)).revision).toBe(
        saved.revision,
      );
      expect(await workflows.get(user.id, project.id)).toEqual(before);
      const removed = await canvas.save(user.id, project.id, {
        mutationId: crypto.randomUUID(),
        baseRevision: saved.revision,
        snapshot: { document: { store: {} } },
        bindings: [],
      });
      expect(removed.bindings[0]?.removed).toBe(true);
      expect((await canvas.read(user.id, project.id)).bindings).toEqual(
        removed.bindings,
      );
      await expect(
        canvas.save(user.id, project.id, {
          ...save,
          mutationId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        canvas.save("another-user", project.id, save),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("rejects foreign bindings and retains legacy boards without manufacturing relations", async () => {
    const { user, project } = await fixture();
    try {
      const snapshot = {
        document: {
          store: {
            "shape:old": {
              typeName: "shape",
              id: "shape:old",
              type: "fashion-note",
              props: { text: "历史灵感" },
            },
            "shape:frame": {
              typeName: "shape",
              id: "shape:frame",
              type: "frame",
              props: { name: "整理" },
            },
            "shape:palette": {
              typeName: "shape",
              id: "shape:palette",
              type: "fashion-swatch",
              props: {
                color: "#112233",
                colors: [
                  { color: "#112233", label: "藏蓝" },
                  { color: "#DDCCBB", label: "燕麦" },
                ],
              },
            },
          },
        },
      };
      await prisma.boardSnapshot.create({
        data: { projectId: project.id, snapshot },
      });
      const initialized = await canvas.initialize(user.id, project.id);
      expect(initialized.initializedFrom).toBe("legacy");
      expect(initialized.bindings).toHaveLength(2);
      expect(
        canvasObject((await workflows.get(user.id, project.id)).nodes.find(
          (node) => node.type === "swatch",
        )?.payload).colors,
      ).toEqual([
        { hex: "#112233", name: "藏蓝" },
        { hex: "#DDCCBB", name: "燕麦" },
      ]);
      expect((await workflows.get(user.id, project.id)).edges).toHaveLength(0);
      expect(
        (
          await prisma.boardSnapshot.findUniqueOrThrow({
            where: { projectId: project.id },
          })
        ).snapshot,
      ).toEqual(snapshot);
      await expect(
        canvas.save(user.id, project.id, {
          mutationId: crypto.randomUUID(),
          baseRevision: initialized.revision,
          snapshot,
          bindings: [{ shapeId: "shape:old", nodeId: "foreign" }],
        }),
      ).rejects.toMatchObject({ status: 400 });
      const reverted = await canvas.setMode(user.id, project.id, "node");
      expect(reverted.bindings).toEqual(initialized.bindings);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
