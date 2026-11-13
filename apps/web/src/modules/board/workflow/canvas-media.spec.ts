import { expect, it } from "vitest";
import { canvasMediaPayloadSchema, canvasMediaUrl, workflowInputPorts } from "@fashion/shared";
import { mediaDuration, projectCanvasMedia } from "./canvas-media";
import type { WorkflowNode } from "./workflow-api";
const node = (payload: Record<string, unknown>): WorkflowNode => ({ id: "node", kind: "asset", type: "media", title: "服装秀成片", payload, x: 0, y: 0, status: "completed", createdAt: "2026-11-12T12:00:00Z", updatedAt: "2026-11-12T12:00:00Z" });
const payload = { mediaId: "media", mediaKind: "video", mimeType: "video/mp4", mediaUrl: canvasMediaUrl("project", "media"), runId: "run", showId: "show", width: 1920, height: 1080, durationMs: 83_000 };
it("视频按原比例投影并提供稳定的同项目来源，音频保留可操作空间", () => {
  const video = projectCanvasMedia(node(payload), "project");
  expect(video?.props).toMatchObject({ w: 360, h: 307, mediaUrl: payload.mediaUrl });
  expect(video?.props.sourceHref).toBe("/project/studio?tab=runway&showId=show&runId=run");
  const audio = projectCanvasMedia(node({ ...payload, mediaKind: "audio", width: null, height: null, mimeType: "audio/wav" }), "project");
  expect(audio?.props).toMatchObject({ w: 340, h: 164 });
  expect(mediaDuration(83_000)).toBe("1:23"); expect(mediaDuration(0)).toBe("");
});
it("损坏媒体记录不伪造播放器，私有文件地址不用存储签名", () => {
  expect(projectCanvasMedia(node({ ...payload, mediaKind: "unknown" }), "project")).toBeNull();
  expect(projectCanvasMedia(node(payload), "another-project")).toBeNull();
  expect(projectCanvasMedia(node({ ...payload, mediaUrl: "https://outside.test/file.mp4" }), "project")).toBeNull();
  expect(canvasMediaPayloadSchema.safeParse({ ...payload, fileUrl: "https://untrusted.test" }).success).toBe(false);
  expect(canvasMediaUrl("project space", "media/one")).toBe("/api/projects/project%20space/runway/media/media%2Fone/content");
  for (const tool of ["analyze_brief", "generate_design", "edit_design", "evaluate_design"]) expect(workflowInputPorts("media", tool)).toEqual([]);
});
