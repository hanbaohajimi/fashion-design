import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { WardrobeService } from "./wardrobe.service";

@Controller("projects/:projectId/wardrobe")
export class WardrobeController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobe: WardrobeService,
  ) {}
  @Get()
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
  ) {
    return this.wardrobe.summary(user.userId, project);
  }
  @Get("assets/:assetId/bounds")
  imageBounds(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("assetId") asset: string,
  ) {
    return this.wardrobe.getImageBounds(user.userId, project, asset);
  }
  @Post("prepare")
  prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.prepare(user.userId, project, body);
  }
  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.confirm(user.userId, project, body);
  }
  @Post("material-alpha/probe")
  materialProbe(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.createMaterialProbe(user.userId, project, body);
  }
  @Post("material-alpha/mask")
  materialMask(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.registerMaterialMask(user.userId, project, body);
  }
  @Post("material-alpha")
  materialAlpha(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.deriveMaterialCandidate(user.userId, project, body);
  }
  @Patch("items/:itemId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("itemId") item: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.archive(user.userId, project, item, body);
  }
  @Patch("items/:itemId/presentation")
  presentation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("itemId") item: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.updatePresentation(user.userId, project, item, body);
  }
  @Post("outfits")
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.saveOutfit(user.userId, project, body);
  }
  @Get("snapshots/:snapshotId")
  snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("snapshotId") snapshot: string,
  ) {
    return this.wardrobe.getSnapshot(user.userId, project, snapshot);
  }
  @Post("snapshots")
  trialSnapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.saveTrialSnapshot(user.userId, project, body);
  }
  @Post("snapshots/:snapshotId/reference")
  reference(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Param("snapshotId") snapshot: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.reference(user.userId, project, snapshot, body);
  }
  @Post("tryon")
  tryOn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") project: string,
    @Body() body: unknown,
  ) {
    return this.wardrobe.tryOn(user.userId, project, body);
  }
}
