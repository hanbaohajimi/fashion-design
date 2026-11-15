import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { assetDomainSchema, assetQuerySchema } from "./asset-library.schemas";
import { AssetLibraryService } from "./asset-library.service";

const identity = z.object({
  domain: assetDomainSchema,
  id: z.string().min(1).max(256),
});
const ratingSchema = z
  .object({ rating: z.number().int().min(1).max(5).nullable() })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new BadRequestException("资产请求参数无效。");
  return value.data;
}
@Controller("assets")
export class AssetLibraryController {
  constructor(
    @Inject(AssetLibraryService) private readonly assets: AssetLibraryService,
  ) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.assets.list(user.userId, parse(assetQuerySchema, query));
  }
  @Patch(":domain/:id/rating")
  @Header("Cache-Control", "private, no-store")
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { domain, id } = parse(identity, params);
    return this.assets.rate(
      user.userId,
      domain,
      id,
      parse(ratingSchema, body).rating,
    );
  }
  @Get(":domain/:id/download")
  @Header("Cache-Control", "private, no-store")
  download(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown) {
    const { domain, id } = parse(identity, params);
    return this.assets.file(user.userId, domain, id, true);
  }
  @Get(":domain/:id/content")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Res() response: Response,
  ) {
    const { domain, id } = parse(identity, params);
    response.redirect(
      307,
      (await this.assets.file(user.userId, domain, id, false)).url,
    );
  }
}
