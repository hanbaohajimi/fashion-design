import { BadRequestException, Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ProjectGeneratedFilesService } from "./project-generated-files.service";

const querySchema = z.object({ kind: z.enum(["all", "image", "video", "audio", "document"]).default("all"), q: z.string().trim().max(120).default(""), cursor: z.string().max(2000).optional(), limit: z.coerce.number().int().min(1).max(60).default(30) }).strict();
@Controller("projects/:projectId/generated-files")
export class ProjectGeneratedFilesController {
  constructor(@Inject(ProjectGeneratedFilesService) private readonly files: ProjectGeneratedFilesService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") project: string, @Query() query: Record<string, unknown>) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || !project || project.length > 128) throw new BadRequestException("生成文件查询参数无效");
    return this.files.list(user.userId, project, parsed.data);
  }
  @Get(":domain/:id/download")
  @Header("Cache-Control", "private, no-store")
  download(@CurrentUser() user: AuthenticatedUser, @Param("projectId") project: string, @Param("domain") domain: string, @Param("id") id: string) {
    const parsed = z.enum(["asset", "runway", "export"]).safeParse(domain);
    if (!parsed.success || !project || project.length > 128 || !id || id.length > 256) throw new BadRequestException("下载文件参数无效");
    return this.files.download(user.userId, project, parsed.data, id);
  }
}
