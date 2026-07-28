import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { ZodType } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { createCollectionSchema, updateDnaSchema } from "./collections.schemas";
import { CollectionsService } from "./collections.service";

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
    return this.collections.createFromHero(user.userId, input.heroAssetId);
  }

  @Get("by-hero/:heroAssetId")
  async byHero(
    @CurrentUser() user: AuthenticatedUser,
    @Param("heroAssetId") heroAssetId: string,
  ) {
    return this.collections.getByHero(user.userId, heroAssetId);
  }

  @Get(":id")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") collectionId: string,
  ) {
    return this.collections.get(user.userId, collectionId);
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
