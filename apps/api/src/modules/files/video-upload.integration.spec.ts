import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { canvasCommandSchema, createCanvasCreationSchema, emptyCanvasCreationDraft } from "@fashion/shared";
import { expect, it, vi } from "vitest";
import { FilesService } from "./files.service";
import { S3FileStorage } from "./storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { CanvasService } from "../canvas/canvas.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { CanvasCommandService } from "../workflow-runtime/canvas-command.service";
import { CanvasCreationsService } from "../workflow-runtime/canvas-creations.service";
import { generatedVideoBytes } from "../../../../../tests/e2e/generated-media-fixture";

it("真实私有存储的视频直传、确认、项目导入与目标版本关联", async () => {
  const user = await prisma.user.create({ data: { email: `video-import-${randomUUID()}@test.local`, ownedWorkspaces: { create: { name: "Video import", projects: { create: { name: "Video" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const workspace = user.ownedWorkspaces[0], project = workspace?.projects[0]; if (!workspace || !project) throw new Error("No fixture project");
  const viewer = await prisma.user.create({ data: { email: `video-viewer-${randomUUID()}@test.local` } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" } });
  const storage = new S3FileStorage(), access = new ProjectAccessPolicy(prisma), jobs = { enqueue: vi.fn() };
  const files = new FilesService(prisma, storage, jobs, access);
  const workflows = new WorkflowsService(prisma, access), canvas = new CanvasService(prisma, access, workflows);
  const commands = new CanvasCommandService(canvas, workflows, {} as never, storage), creations = new CanvasCreationsService(canvas, commands, workflows, access);
  let key: string | undefined;
  try {
    const input = { name: "可播放样例.mp4", mimeType: "video/mp4" as const, size: generatedVideoBytes.length, sha256: createHash("sha256").update(generatedVideoBytes).digest("hex"), projectId: project.id };
    await expect(files.signUpload(viewer.id, input)).rejects.toMatchObject({ status: 403 });
    const signed = await files.signUpload(user.id, input); if (!signed.upload) throw new Error("Missing upload lease");
    key = (await prisma.fileAsset.findUniqueOrThrow({ where: { id: signed.file.id } })).objectKey;
    const put = await fetch(signed.upload.url, { method: "PUT", headers: signed.upload.headers, body: new Uint8Array(generatedVideoBytes) }); expect(put.ok).toBe(true);
    expect((await files.complete(user.id, signed.file.id)).status).toBe("READY"); expect(jobs.enqueue).not.toHaveBeenCalled();
    expect((await files.complete(user.id, signed.file.id)).id).toBe(signed.file.id);
    await expect(files.contentUrl(viewer.id, signed.file.id)).rejects.toMatchObject({ status: 403 });
    await canvas.initialize(user.id, project.id);
    const command = canvasCommandSchema.parse({ type: "import_reference_video", mutationId: randomUUID(), fileId: signed.file.id, placement: "reference" });
    const imported = await commands.execute(user.id, project.id, command);
    const replay = await commands.execute(user.id, project.id, command); expect(replay.nodeId).toBe(imported.nodeId);
    const range = await fetch(await files.contentUrl(viewer.id, signed.file.id), { headers: { Range: "bytes=0-31" } });
    expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(generatedVideoBytes.subarray(0,32));
    const target = await creations.create(user.id, project.id, createCanvasCreationSchema.parse({ id: randomUUID(), mutationId: randomUUID(), module: "video", draft: emptyCanvasCreationDraft() }));
    const packet = { mutationId: randomUUID(), expectedRevision: target.revision, mediaNodeId: imported.nodeId };
    const attached = await creations.update(user.id, project.id, target.id, packet);
    expect(attached.currentResult?.media?.url).toBe(`/api/files/${signed.file.id}/content`);
    expect(attached.runs[0]?.status).toBe("completed"); expect(attached.currentResult?.sourceNodeId).toBe(imported.nodeId);
    expect((await creations.update(user.id, project.id, target.id, packet)).runs).toHaveLength(1);
    expect(await prisma.generationTask.count({ where: { projectId: project.id } })).toBe(0);
    expect((await canvas.read(user.id, project.id)).bindings).toHaveLength(0);
  } finally {
    if (key) await storage.delete(key);
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, viewer.id] } } });
  }
}, 30000);
