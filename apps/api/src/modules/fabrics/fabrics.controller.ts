import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import type { Response } from "express";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { MAX_IMAGE_BYTES } from "../files/files.schemas";
import {
  createFabricSchema,
  listFabricsSchema,
  updateFabricSchema,
} from "./dto/fabric.dto";
import {
  FabricsService,
  type FabricImageUpload,
  type FabricListView,
  type FabricView,
} from "./fabrics.service";

const fabricIdSchema = z.string().min(1).max(100);
const PRIVATE_NO_STORE = "private, no-store";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "面料请求参数无效",
    });
  }
  return result.data;
}

function parseFabricBody(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }
  const value = body as Record<string, unknown>;
  const parsed = { ...value };
  for (const field of ["tags", "details"]) {
    if (typeof parsed[field] !== "string") continue;
    try {
      parsed[field] = JSON.parse(parsed[field] as string) as unknown;
    } catch {
      throw new BadRequestException({
        code: "FABRIC_JSON_INVALID",
        message: field + " 必须是有效的 JSON",
      });
    }
  }
  return parsed;
}

@Controller("fabrics")
export class FabricsController {
  constructor(
    @Inject(FabricsService) private readonly fabricsService: FabricsService,
  ) {}

  @Get()
  @Header("Cache-Control", PRIVATE_NO_STORE)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ): Promise<FabricListView> {
    return this.fabricsService.list(
      user.userId,
      parseOrThrow(listFabricsSchema, query),
    );
  }

  @Get(":id/image")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async image(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fabricId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    response.redirect(
      307,
      await this.fabricsService.imageUrl(
        user.userId,
        parseOrThrow(fabricIdSchema, fabricId),
      ),
    );
  }

  @Get(":id")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fabricId: string,
  ): Promise<FabricView> {
    return this.fabricsService.findOne(
      user.userId,
      parseOrThrow(fabricIdSchema, fabricId),
    );
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyBy: "user", name: "fabric-upload", limit: 20, windowSeconds: 60, limitEnv: "FABRIC_UPLOAD_RATE_LIMIT" })
  @Header("Cache-Control", PRIVATE_NO_STORE)
  @UseInterceptors(
    FileInterceptor("mainImage", {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @UploadedFile() mainImage: FabricImageUpload | undefined,
  ): Promise<FabricView> {
    if (!mainImage) {
      throw new BadRequestException({
        code: "FABRIC_MAIN_IMAGE_REQUIRED",
        message: "请上传 mainImage 面料主图",
      });
    }
    return this.fabricsService.create(
      user.userId,
      parseOrThrow(createFabricSchema, parseFabricBody(body)),
      mainImage,
    );
  }

  @Patch(":id")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fabricId: string,
    @Body() body: unknown,
  ): Promise<FabricView> {
    return this.fabricsService.update(
      user.userId,
      parseOrThrow(fabricIdSchema, fabricId),
      parseOrThrow(updateFabricSchema, parseFabricBody(body)),
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") fabricId: string,
  ): Promise<void> {
    return this.fabricsService.remove(
      user.userId,
      parseOrThrow(fabricIdSchema, fabricId),
    );
  }
}
