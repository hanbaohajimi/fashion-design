import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { signUploadSchema } from "./files.schemas";
import { FilesService } from "./files.service";

const fileIdSchema = z.string().min(1).max(100);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "文件请求无效",
    });
  }
  return result.data;
}

@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post("sign-upload")
  signUpload(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.filesService.signUpload(
      user.userId,
      parseOrThrow(signUploadSchema, body),
    );
  }

  @Post(":id/complete")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fileId: string,
  ) {
    return this.filesService.complete(
      user.userId,
      parseOrThrow(fileIdSchema, fileId),
    );
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") fileId: string) {
    return this.filesService.get(
      user.userId,
      parseOrThrow(fileIdSchema, fileId),
    );
  }

  @Get(":id/thumbnail/:size")
  async thumbnail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fileId: string,
    @Param("size") rawSize: string,
    @Res() response: Response,
  ): Promise<void> {
    const size = parseOrThrow(z.enum(["256", "1024"]), rawSize);
    response.redirect(
      307,
      await this.filesService.thumbnailUrl(
        user.userId,
        parseOrThrow(fileIdSchema, fileId),
        size,
      ),
    );
  }
}
