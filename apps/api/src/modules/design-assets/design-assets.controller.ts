import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { DesignAssetsService } from "./design-assets.service";
import { designDecisionSchema } from "./design-path.schemas";

const PRIVATE_NO_STORE = "private, no-store";
const importFileSchema = z.object({
  fileId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
});

@Controller("design-assets")
export class DesignAssetsController {
  constructor(
    @Inject(DesignAssetsService)
    private readonly assets: DesignAssetsService,
  ) {}

  @Post("import")
  async importFile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = importFileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_ASSET_IMPORT",
        message: "设计资产导入参数不合法",
      });
    }
    return this.assets.importFile(
      user.userId,
      parsed.data.projectId,
      parsed.data.fileId,
    );
  }

  @Get(":id/versions")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ) {
    const parsed = z.coerce
      .number()
      .int()
      .min(1)
      .max(24)
      .safeParse(rawLimit ?? 10);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_VERSION_PAGE",
        message: "版本分页参数不合法",
      });
    }
    return this.assets.versions(user.userId, assetId, cursor, parsed.data);
  }

  @Get(":id/path")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async path(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
  ) {
    return this.assets.path(user.userId, assetId);
  }

  @Post(":id/decisions")
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Body() body: unknown,
  ) {
    const parsed = designDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_DESIGN_DECISION",
        message: "设计决策参数不合法",
      });
    }
    return this.assets.decide(user.userId, assetId, parsed.data);
  }

  @Get(":id/content")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    response.redirect(
      307,
      await this.assets.downloadUrl(user.userId, assetId, "content"),
    );
  }

  @Get(":id/thumbnail")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async thumbnail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    response.redirect(
      307,
      await this.assets.downloadUrl(user.userId, assetId, "thumbnail"),
    );
  }

  @Post(":id/restore")
  async restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") targetAssetId: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ currentAssetId: z.string().min(1).max(128), clientRequestId: z.string().trim().min(1).max(128).optional() })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_RESTORE_REQUEST",
        message: "恢复参数不合法",
      });
    }
    return this.assets.restore(
      user.userId,
      targetAssetId,
      parsed.data.currentAssetId,
      parsed.data.clientRequestId,
    );
  }
}
