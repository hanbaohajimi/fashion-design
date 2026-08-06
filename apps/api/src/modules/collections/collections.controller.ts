import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { ZodType } from "zod";
import { z } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  createCollectionLookSchema,
  createCollectionSchema,
  forceKeepCollectionLookSchema,
  updateCollectionSchema,
  updateDnaSchema,
} from "./collections.schemas";
import { CollectionsService } from "./collections.service";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";

@Controller("collections")
export class CollectionsController {
  constructor(
    @Inject(CollectionsService)
    private readonly collections: CollectionsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = this.parse(
      createCollectionSchema,
      body,
      "INVALID_COLLECTION_REQUEST",
      "建系列参数不合法",
    );
    return this.collections.createFromHero(
      user.userId,
      input.heroAssetId,
      input.sourceGarmentType,
    );
  }

  @Get("by-hero/:heroAssetId")
  async byHero(
    @CurrentUser() user: AuthenticatedUser,
    @Param("heroAssetId") heroAssetId: string,
  ) {
    return this.collections.getByHero(user.userId, heroAssetId);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string | undefined,
  ) {
    const parsed = z.string().min(1).max(128).safeParse(projectId);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_PROJECT_ID",
        message: "缺少有效的 projectId",
      });
    }
    return this.collections.list(user.userId, parsed.data);
  }

  @Get(":id")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
  ) {
    return this.collections.get(user.userId, collectionId);
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
    @Body() body: unknown,
  ) {
    const input = this.parse(
      updateCollectionSchema,
      body,
      "INVALID_COLLECTION_UPDATE",
      "系列更新参数不合法",
    );
    return this.collections.update(user.userId, collectionId, input);
  }

  @Get(":id/consistency")
  async consistency(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
  ) {
    return this.collections.getConsistency(user.userId, collectionId);
  }

  @Post(":id/looks")
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 20,
    name: "generation-create",
    windowSeconds: 60 * 60,
  })
  async createLook(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ task_id: string }> {
    const input = this.parse(
      createCollectionLookSchema,
      body,
      "INVALID_COLLECTION_LOOK_REQUEST",
      "系列 Look 生成参数不合法",
    );
    const parsedKey = z
      .string()
      .trim()
      .min(8)
      .max(200)
      .safeParse(idempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException({
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "缺少有效的 Idempotency-Key 请求头",
      });
    }
    const result = await this.collections.createLook(
      user.userId,
      collectionId,
      input,
      parsedKey.data,
    );
    return { task_id: result.taskId };
  }

  @Patch(":id/looks/:assetId/keep")
  async forceKeep(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    this.parse(
      forceKeepCollectionLookSchema,
      body,
      "INVALID_FORCE_KEEP_REQUEST",
      "强制保留参数不合法",
    );
    return this.collections.forceKeep(user.userId, collectionId, assetId);
  }

  @Patch(":id/dna")
  async updateDna(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
    @Body() body: unknown,
  ) {
    const input = this.parse(
      updateDnaSchema,
      body,
      "INVALID_DNA_UPDATE",
      "DNA 更新参数不合法",
    );
    return this.collections.updateDna(user.userId, collectionId, input);
  }

  private parse<T>(
    schema: ZodType<T>,
    value: unknown,
    code: string,
    message: string,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ code, message });
    }
    return parsed.data;
  }
}
