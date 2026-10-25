import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { imageFeedbackSchema } from "@fashion/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { Public } from "../auth/public.decorator";
import { ImageWorkspaceService } from "./image-workspace.service";

@Controller("design-assets")
export class ImageWorkspaceController {
  constructor(
    @Inject(ImageWorkspaceService)
    private readonly images: ImageWorkspaceService,
  ) {}
  @Get(":id/feedback")
  @Header("Cache-Control", "private, no-store")
  feedback(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.images.feedback(user.userId, id);
  }
  @Put(":id/feedback")
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = imageFeedbackSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("标注或评论格式不正确");
    return this.images.save(user.userId, id, parsed.data);
  }
  @Get(":id/shares")
  @Header("Cache-Control", "private, no-store")
  shares(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.images.shares(user.userId, id);
  }
  @Post(":id/shares")
  @Header("Cache-Control", "private, no-store")
  share(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.images.share(user.userId, id);
  }
  @Delete(":id/shares/:shareId")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("shareId") shareId: string,
  ) {
    return this.images.revoke(user.userId, id, shareId);
  }
  @Get(":id/file")
  @Header("Cache-Control", "private, no-store")
  async file(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const file = await this.images.bytes(
      await this.images.owned(user.userId, id),
    );
    response.type(file.contentType).send(file.body);
  }
}

@Controller("image-shares")
export class ImageShareController {
  constructor(
    @Inject(ImageWorkspaceService)
    private readonly images: ImageWorkspaceService,
  ) {}
  @Public()
  @Get(":token")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  async view(@Param("token") token: string) {
    const asset = await this.images.shared(token);
    return {
      width: asset.width,
      height: asset.height,
      imageUrl: `/api/image-shares/${token}/content`,
    };
  }
  @Public()
  @Get(":token/content")
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async content(@Param("token") token: string, @Res() response: Response) {
    const file = await this.images.bytes(await this.images.shared(token));
    response.type(file.contentType).send(file.body);
  }
}
