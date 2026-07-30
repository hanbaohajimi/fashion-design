import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

@Controller("design-assets")
export class DesignAssetsController {
  constructor(
    @Inject(DesignAssetsService)
    private readonly assets: DesignAssetsService,
  ) {}

  @Get(":id/versions")
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ) {
    const parsed = z.coerce.number().int().min(1).max(24).safeParse(
      rawLimit ?? 10,
    );
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_VERSION_PAGE",
        message: "版本分页参数不合法",
      });
    }
    return this.assets.versions(user.userId, assetId, cursor, parsed.data);
  }

  @Get(":id/content")
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.redirect(
      307,
      await this.assets.downloadUrl(user.userId, assetId, "content"),
    );
  }

  @Get(":id/thumbnail")
  async thumbnail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") assetId: string,
    @Res() response: Response,
  ): Promise<void> {
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
      .object({ currentAssetId: z.string().min(1).max(128) })
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
    );
  }
}
