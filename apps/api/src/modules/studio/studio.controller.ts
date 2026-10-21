import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { StudioService } from "./studio.service";

@Controller("projects/:projectId/studio")
export class StudioController {
  constructor(@Inject(StudioService) private readonly studio: StudioService) {}
  @Get()
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.studio.summary(user.userId, projectId);
  }
  @Get("brands/library")
  brandLibrary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.studio.brandLibrary(user.userId, projectId);
  }
  @Post("brands/import")
  importBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.studio.importBrand(user.userId, projectId, body);
  }
  @Post("styles")
  createStyle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.studio.createStyle(user.userId, projectId, body);
  }
  @Patch("styles/:styleId")
  updateStyle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("styleId") styleId: string,
    @Body() body: unknown,
  ) {
    return this.studio.updateStyle(user.userId, projectId, styleId, body);
  }
  @Post("documents")
  saveDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.studio.saveDocument(user.userId, projectId, body);
  }
  @Post("members")
  createMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.studio.createMember(user.userId, projectId, body);
  }
  @Patch("members/:memberId")
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
  ) {
    return this.studio.updateMember(user.userId, projectId, memberId, body);
  }
  @Delete("members/:memberId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
  ) {
    return this.studio.updateMember(
      user.userId,
      projectId,
      memberId,
      body,
      true,
    );
  }
  @Get("tech-packs/:revisionId/export")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "private, no-store")
  exportTechPack(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("revisionId") revisionId: string,
  ) {
    return this.studio.exportTechPack(user.userId, projectId, revisionId);
  }
}
