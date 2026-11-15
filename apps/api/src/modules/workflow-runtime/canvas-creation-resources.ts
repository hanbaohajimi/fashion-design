import type { Prisma, PrismaClient } from "@fashion/db";
import type { CanvasCreation, CreationRunView } from "@fashion/shared";
import { BadRequestException } from "@nestjs/common";
const canvasObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type Database = Pick<PrismaClient, "studioExperiment" | "studioDocument" | "collection" | "generationTask" | "designAsset" | "workflowNode"> | Pick<Prisma.TransactionClient, "studioExperiment" | "studioDocument" | "collection" | "generationTask" | "designAsset" | "workflowNode">;
export interface ResourceSnapshot {
  kind: NonNullable<CanvasCreation["resource"]>["kind"];
  id: string;
  revision: number;
  title: string;
  taskIds: string[];
  assetIds: string[];
  content: Record<string, unknown>;
}
const string = (value: unknown) => typeof value === "string" ? value : "";
const array = (value: unknown) => Array.isArray(value) ? value.map(canvasObject) : [];

export async function snapshotCreationResource(database: Database, projectId: string, resource: NonNullable<CanvasCreation["resource"]>): Promise<ResourceSnapshot> {
  if (resource.kind === "experiment") {
    const record = await database.studioExperiment.findFirst({ where: { id: resource.id, projectId } });
    if (!record) throw new BadRequestException("实验不存在或不属于本项目");
    const content = canvasObject(record.items);
    const items = array(content.items);
    return { ...resource, revision: record.version, title: ({ color: "换色实验", material: "面料实验", detail: "改款实验", presentation: "商品展示" } as Record<string, string>)[string(content.mode)] ?? "设计实验", taskIds: items.flatMap((item) => item.taskId ? [string(item.taskId)] : []), assetIds: [], content: { ...content, sourceAssetId: record.sourceAssetId } };
  }
  if (resource.kind === "collection") {
    const record = await database.collection.findFirst({ where: { id: resource.id, projectId }, include: { looks: true, generationTasks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
    if (!record) throw new BadRequestException("系列不存在或不属于本项目");
    return { ...resource, revision: record.looks.length, title: record.name, taskIds: record.generationTasks.map((task) => task.id), assetIds: [...new Set([record.heroAssetId, ...record.looks.map((look) => look.designAssetId)])], content: { name: record.name, heroAssetId: record.heroAssetId, lookIds: record.looks.map((look) => look.designAssetId) } };
  }
  if (resource.kind === "trend") {
    const record = await database.workflowNode.findFirst({ where: { id: resource.id, projectId, kind: "asset", type: { in: ["brief", "reference_text", "trend", "constraint"] } } });
    if (!record) throw new BadRequestException("趋势资料不存在或不属于当前项目");
    return { ...resource, revision: record.updatedAt.getTime(), title: record.title, taskIds: [], assetIds: [], content: canvasObject(record.payload) };
  }
  const record = await database.studioDocument.findFirst({ where: { projectId, OR: [{ id: resource.id }, { documentId: resource.id }] }, orderBy: { revision: "desc" } });
  const type = resource.kind === "pattern" ? "PRINT_PATTERN" : "PRESENTATION_SET";
  if (!record || record.type !== type) throw new BadRequestException("功能资料类型不匹配或不属于本项目");
  const content = canvasObject(record.payload);
  return { kind: resource.kind, id: record.id, revision: record.revision, title: string(content.name) || "创作资料", taskIds: [],
    assetIds: resource.kind === "presentation" ? array(content.items).flatMap((item) => item.assetId ? [string(item.assetId)] : []) : [], content };
}

export async function readCreationResource(database: Database, projectId: string, snapshot: ResourceSnapshot) {
  const tasks = snapshot.taskIds.length ? await database.generationTask.findMany({ where: { projectId, id: { in: snapshot.taskIds } }, select: { id: true, status: true, errorMessage: true, updatedAt: true } }) : [];
  const assets = await database.designAsset.findMany({ where: { projectId, OR: [{ id: { in: snapshot.assetIds } }, { generationTaskId: { in: snapshot.taskIds } }] }, select: { id: true, width: true, height: true, generationTaskId: true } });
  const states = tasks.map((task) => task.status);
  let status: CreationRunView["status"] = "completed";
  if (snapshot.kind === "experiment" || snapshot.kind === "collection") {
    if (!snapshot.taskIds.length) status = snapshot.kind === "experiment" ? "draft" : "completed";
    else if (states.some((state) => state === "RUNNING")) status = "running";
    else if (states.some((state) => state === "QUEUED") || tasks.length < snapshot.taskIds.length) status = "queued";
    else if (states.every((state) => state === "CANCELED")) status = "canceled";
    else if (states.some((state) => ["FAILED", "MODERATION_FAILED", "CANCELED"].includes(state))) status = assets.some((asset) => asset.generationTaskId && snapshot.taskIds.includes(asset.generationTaskId)) ? "partial_failed" : "failed";
  }
  const text = snapshot.kind === "pattern" ? `${snapshot.title}\n缩放 ${snapshot.content.scale}，旋转 ${snapshot.content.rotation}°，亮度 ${snapshot.content.brightness}\n${string(snapshot.content.notes)}`
    : snapshot.kind === "presentation" ? `${snapshot.title}\n${snapshot.assetIds.length}张展示图片` : snapshot.kind === "trend" ? string(snapshot.content.text) || snapshot.title : snapshot.title;
  const requirements = snapshot.kind === "experiment" ? array(snapshot.content.items).map((item) => string(item.prompt)).filter(Boolean) : [string(snapshot.content.notes)].filter(Boolean);
  const values = snapshot.kind === "pattern" ? [{ label: "缩放", value: String(snapshot.content.scale) }, { label: "旋转", value: `${snapshot.content.rotation}°` }, { label: "亮度", value: String(snapshot.content.brightness) }]
    : snapshot.kind === "experiment" ? [{ label: "方案数量", value: String(array(snapshot.content.items).length) }, { label: "尺寸", value: `${snapshot.content.width} × ${snapshot.content.height}` }]
      : [{ label: "成果数量", value: String(assets.length || 1) }];
  const moduleRecord: NonNullable<CreationRunView["moduleRecord"]> = { kind: snapshot.kind, recordId: snapshot.id, title: snapshot.title, revision: snapshot.revision, requirements, values };
  return { status, assets, text, moduleRecord, updatedAt: tasks.length ? new Date(Math.max(...tasks.map((task) => task.updatedAt.getTime()))).toISOString() : null, error: tasks.flatMap((task) => task.errorMessage ? [task.errorMessage] : []).join("\n") || null };
}
