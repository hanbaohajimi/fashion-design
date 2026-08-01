import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Header,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";

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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const result = createExportSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: "INVALID_EXPORT_REQUEST",
        message: result.error.issues[0]?.message ?? "导出参数不合法",
      });
    }
    return this.exportsService.create(user.userId, result.data);
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
