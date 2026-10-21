import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Header,
  Headers,
  Query,
  HttpCode,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";

import { createExportSchema } from "./exports.schemas";
import { ExportsService } from "./exports.service";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";

const exportIdSchema = z.string().min(1).max(100);
const PRIVATE_NO_STORE = "private, no-store";

@Controller("exports")
export class ExportsController {
  constructor(
    @Inject(ExportsService) private readonly exportsService: ExportsService,
  ) {}

  @Get("capabilities")
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.exportsService.capabilities(user.userId);
  }

  @Post()
  @HttpCode(202)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    if (key !== undefined && (key.length < 8 || key.length > 200))
      throw new BadRequestException("导出幂等键长度应为 8 至 200");
    const result = createExportSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: "INVALID_EXPORT_REQUEST",
        message: result.error.issues[0]?.message ?? "导出参数不合法",
      });
    }
    return this.exportsService.create(user.userId, result.data, key);
  }

  @Get()
  @Header("Cache-Control", PRIVATE_NO_STORE)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = z
      .object({
        projectId: exportIdSchema,
        sourceType: z.enum([
          "asset",
          "collection",
          "tech_pack",
          "presentation_set",
        ]),
        sourceId: exportIdSchema,
        page: z.coerce.number().int().min(1).max(10000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException("导出查询参数无效");
    return this.exportsService.list(user.userId, parsed.data);
  }

  @Get(":id/content")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") exportId: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = exportIdSchema.safeParse(exportId);
    if (!result.success)
      throw new BadRequestException({
        code: "INVALID_EXPORT_ID",
        message: "导出任务编号不合法",
      });
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    response.redirect(
      307,
      await this.exportsService.downloadUrl(user.userId, result.data),
    );
  }

  @Get(":id")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") exportId: string) {
    const result = exportIdSchema.safeParse(exportId);
    if (!result.success) {
      throw new BadRequestException({
        code: "INVALID_EXPORT_ID",
        message: "导出任务编号不合法",
      });
    }
    return this.exportsService.get(user.userId, result.data);
  }
}
