import {
  Controller,
  Header,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ImageTextService } from "./image-text.service";

@Controller("design-assets")
export class ImageTextController {
  constructor(
    @Inject(ImageTextService) private readonly text: ImageTextService,
  ) {}
  @Post(":id/text-regions")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "image-text-recognition",
    keyBy: "user",
    limit: 10,
    windowSeconds: 60,
  })
  recognize(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.text.recognize(user.userId, id);
  }
}
