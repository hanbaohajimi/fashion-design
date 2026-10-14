import "../apps/api/node_modules/reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "../apps/api/node_modules/@nestjs/core";
import { prisma } from "../packages/db/src/client";
import { WorkflowsService } from "../apps/api/src/modules/workflows/workflows.service";
import { WorkflowRuntimeModule } from "../apps/api/src/modules/workflow-runtime/workflow-runtime.module";
import { WorkflowRuntimeService } from "../apps/api/src/modules/workflow-runtime/workflow-runtime.service";
import { S3FileStorage } from "../apps/api/src/modules/files/storage.service";

// This deliberately uses the configured real model, PostgreSQL, BullMQ worker and
// private object storage. Run a worker before invoking this smoke check.
async function main() {
  const app = await NestFactory.createApplicationContext(
    WorkflowRuntimeModule,
    {
      logger: ["error", "warn"],
    },
  );
  const runtime = app.get(WorkflowRuntimeService);
  const workflows = app.get(WorkflowsService);
  const storage = app.get(S3FileStorage);
  const user = await prisma.user.create({
    data: {
      email: `workflow-smoke-${randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Workflow smoke",
          projects: { create: { name: "秋冬通勤风衣闭环验收" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("无法创建验收项目");
  try {
    const briefId = randomUUID();
    const referenceId = randomUUID();
    const analysisId = randomUUID();
    await workflows.patch(user.id, project.id, {
      mode: "semantic",
      baseRevision: 0,
      mutationId: randomUUID(),
      operations: [
        {
          type: "add_node",
          node: {
            id: briefId,
            kind: "asset",
            type: "brief",
            title: "设计需求",
            payload: {
              text: "设计一款秋冬通勤风衣，藏蓝色、宽松H型廓形、哑光质感；只展示服装，不出现人物。面料防水性能需要规格资料确认。",
            },
            x: 80,
            y: 100,
          },
        },
        {
          type: "add_node",
          node: {
            id: referenceId,
            kind: "asset",
            type: "reference_text",
            title: "通勤风格参考",
            payload: {
              text: "简洁双排扣、低调口袋、膝下衣长；参考信息仅供灵感，不自动成为硬性要求。",
            },
            x: 80,
            y: 360,
          },
        },
        {
          type: "add_node",
          node: {
            id: analysisId,
            kind: "tool",
            type: "analyze_brief",
            title: "需求分析",
            payload: {
              toolKey: "analyze_brief",
              toolVersion: "1",
              params: { prompt: "将明确要求与无法凭图片确认的条件分开" },
            },
            x: 410,
            y: 100,
          },
        },
        {
          type: "add_edge",
          edge: {
            id: randomUUID(),
            sourceNodeId: briefId,
            targetNodeId: analysisId,
            sourcePort: "out",
            targetPort: "goal",
          },
        },
        {
          type: "add_edge",
          edge: {
            id: randomUUID(),
            sourceNodeId: referenceId,
            targetNodeId: analysisId,
            sourcePort: "out",
            targetPort: "reference",
          },
        },
      ],
    });
    await runtime.execute(user.id, project.id, analysisId, {
      mutationId: randomUUID(),
    });
    let graph = await runtime.sync(user.id, project.id);
    const constraint = graph.nodes.find((node) => node.type === "constraint");
    if (!constraint) throw new Error("需求分析没有形成约束资产");
    console.log(
      JSON.stringify({
        phase: "analysis",
        status: "completed",
        constraints: true,
      }),
    );
    const generateId = randomUUID();
    await workflows.patch(user.id, project.id, {
      mode: "semantic",
      baseRevision: graph.revision,
      mutationId: randomUUID(),
      operations: [
        {
          type: "add_node",
          node: {
            id: generateId,
            kind: "tool",
            type: "generate_design",
            title: "方案生成",
            payload: {
              toolKey: "generate_design",
              toolVersion: "1",
              params: {
                prompt:
                  "藏蓝色宽松H型秋冬通勤风衣，哑光质感，清晰的服装产品设计图，只展示服装",
                count: 2,
              },
            },
            x: 1080,
            y: 100,
          },
        },
        {
          type: "add_edge",
          edge: {
            id: randomUUID(),
            sourceNodeId: constraint.id,
            targetNodeId: generateId,
            sourcePort: "out",
            targetPort: "constraint",
          },
        },
        {
          type: "add_edge",
          edge: {
            id: randomUUID(),
            sourceNodeId: referenceId,
            targetNodeId: generateId,
            sourcePort: "out",
            targetPort: "reference",
          },
        },
      ],
    });
    await runtime.execute(user.id, project.id, generateId, {
      mutationId: randomUUID(),
    });
    const waitForTool = async (toolId: string) => {
      const deadline = Date.now() + 14 * 60_000;
      while (Date.now() < deadline) {
        const current = await runtime.sync(user.id, project.id);
        const tool = current.nodes.find((node) => node.id === toolId);
        if (tool?.status === "completed") return current;
        if (tool?.status === "failed") {
          const history = await runtime.history(user.id, project.id, toolId);
          throw new Error(
            `真实生成失败：${
              history.items
                .map((attempt) => attempt.error)
                .filter(Boolean)
                .join("；") || "请检查队列任务"
            }`,
          );
        }
        await new Promise((done) => setTimeout(done, 3_000));
      }
      throw new Error("真实生成未在时限内回填候选");
    };
    graph = await waitForTool(generateId);
    const candidateIds = new Set(
      graph.edges
        .filter((edge) => edge.sourceNodeId === generateId)
        .map((edge) => edge.targetNodeId),
    );
    const candidates = graph.nodes.filter(
      (node) => candidateIds.has(node.id) && node.type === "candidate",
    );
    if (candidates.length !== 2)
      throw new Error("双方案生成没有形成独立的 A/B 候选");
    const candidate = candidates[0]!;
    const artifactDir = resolve(
      __dirname,
      "..",
      "output",
      "workflow-verification",
    );
    await mkdir(artifactDir, { recursive: true });
    const saveCandidate = async (node: typeof candidate, name: string) => {
      const payload = node.payload as Record<string, unknown>;
      const asset = await prisma.designAsset.findUniqueOrThrow({
        where: { id: String(payload.assetId) },
      });
      const bytes = await storage.readPrefix(
        asset.url.replace(/^s3:\/\//u, ""),
        30 * 1024 * 1024,
      );
      if (!bytes.length) throw new Error("私有存储中的候选图片为空");
      await writeFile(resolve(artifactDir, name), bytes);
      return asset;
    };
    const sourceAsset = await saveCandidate(candidate, "real-candidate.png");
    await saveCandidate(candidates[1]!, "real-candidate-b.png");
    console.log(
      JSON.stringify({
        phase: "generation",
        status: "completed",
        candidates: 2,
      }),
    );
    const evaluationId = randomUUID();
    await workflows.patch(user.id, project.id, {
      mode: "semantic",
      baseRevision: graph.revision,
      mutationId: randomUUID(),
      operations: [
        {
          type: "add_node",
          node: {
            id: evaluationId,
            kind: "tool",
            type: "evaluate_design",
            title: "服装评估",
            payload: {
              toolKey: "evaluate_design",
              toolVersion: "1",
              params: { prompt: "逐条核对设计约束，不能凭图片确定防水性能" },
            },
            x: 1750,
            y: 100,
          },
        },
        {
          type: "add_edge",
          edge: {
            id: randomUUID(),
            sourceNodeId: constraint.id,
            targetNodeId: evaluationId,
            sourcePort: "out",
            targetPort: "constraint",
          },
        },
        ...candidates.map((node) => ({
          type: "add_edge" as const,
          edge: {
            id: randomUUID(),
            sourceNodeId: node.id,
            targetNodeId: evaluationId,
            sourcePort: "out" as const,
            targetPort: "candidate" as const,
          },
        })),
      ],
    });
    await runtime.execute(user.id, project.id, evaluationId, {
      mutationId: randomUUID(),
    });
    graph = await runtime.sync(user.id, project.id);
    const report = graph.nodes.find((node) => node.type === "evaluation");
    if (!report) throw new Error("评价没有形成报告资产");
    const evaluations = (
      (report.payload as Record<string, unknown>).report as {
        evaluations: unknown[];
      }
    ).evaluations;
    if (evaluations.length !== 2) throw new Error("报告没有逐一评估 A/B 候选");
    console.log(
      JSON.stringify({
        phase: "evaluation",
        status: "completed",
        candidates: evaluations.length,
      }),
    );
    await runtime.decide(user.id, project.id, candidate.id, {
      assetId: sourceAsset.id,
      kind: "selected",
      reason: "保留宽松H型，沿此候选尝试袖口修改",
      mutationId: randomUUID(),
    });
    const proposal = await runtime.propose(user.id, project.id, {
      content:
        "修改候选A：保持藏蓝色、宽松H型廓形、原有领型与衣长，只将袖口改为带明显调节袢的收紧袖口。只展示服装。",
      referencedNodeIds: [candidate.id],
      mutationId: randomUUID(),
    });
    if (proposal.status !== "pending" || !proposal.toolNodeId)
      throw new Error("Agent 没有生成可确认的修改建议");
    await runtime.accept(user.id, project.id, proposal.id, {
      baseRevision: proposal.baseRevision,
      mutationId: randomUUID(),
    });
    const executeRequest = { mutationId: randomUUID() };
    await runtime.execute(
      user.id,
      project.id,
      proposal.toolNodeId,
      executeRequest,
    );
    graph = await waitForTool(proposal.toolNodeId);
    const branchId = graph.edges.find(
      (edge) => edge.sourceNodeId === proposal.toolNodeId,
    )?.targetNodeId;
    const branch = graph.nodes.find(
      (node) => node.id === branchId && node.type === "candidate",
    );
    if (!branch) throw new Error("修改没有形成新的结果分支");
    const branchAsset = await saveCandidate(branch, "real-modified-branch.png");
    if (branchAsset.parentAssetId !== sourceAsset.id)
      throw new Error("修改分支没有绑定实际母图");
    const attemptCount = await prisma.workflowAttempt.count({
      where: { projectId: project.id },
    });
    const replay = await runtime.execute(
      user.id,
      project.id,
      proposal.toolNodeId,
      executeRequest,
    );
    if (
      replay.nodes.length !== graph.nodes.length ||
      (await prisma.workflowAttempt.count({
        where: { projectId: project.id },
      })) !== attemptCount
    )
      throw new Error("重复执行创建了重复任务或节点");
    if (!replay.nodes.some((node) => node.id === candidates[1]!.id))
      throw new Error("修改分支丢失了另一候选");
    graph = await runtime.sync(user.id, project.id);
    await writeFile(
      resolve(artifactDir, "real-workflow.json"),
      JSON.stringify(graph, null, 2),
    );
    console.log(
      JSON.stringify({
        phase: "branch",
        status: "completed",
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        duplicateAttempts: false,
      }),
    );
  } finally {
    const assets = await prisma.designAsset.findMany({
      where: { projectId: project.id },
      select: { url: true, thumbnailUrl: true },
    });
    for (const asset of assets) {
      for (const url of [asset.url, asset.thumbnailUrl])
        if (url?.startsWith("s3://"))
          await storage.delete(url.slice(5)).catch(() => undefined);
    }
    await prisma.workflowAttempt.deleteMany({
      where: { projectId: project.id },
    });
    await prisma.user.delete({ where: { id: user.id } });
    await app.close();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "真实工作流验收失败");
  process.exitCode = 1;
});
