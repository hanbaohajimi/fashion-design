import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { boardPatchSchema, importTrendSchema } from "./boards.schemas";
import { BoardsService } from "./boards.service";

const projectIdSchema = z.string().min(1).max(100);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "画布请求无效",
    });
  }

  return result.data;
}

@Controller("projects/:projectId/board")
export class BoardsController {
  constructor(
    @Inject(BoardsService) private readonly boardsService: BoardsService,
  ) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.boardsService.get(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
    );
  }

  @Patch()
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.boardsService.patch(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(boardPatchSchema, body),
    );
  }
}

const PRIVATE_NO_STORE = "private, no-store";

@Controller("boards")
export class BoardImportsController {
  constructor(
    @Inject(BoardsService) private readonly boardsService: BoardsService,
  ) {}

  @Post(":boardId/import-trend")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  importTrend(
    @CurrentUser() user: AuthenticatedUser,
    @Param("boardId") boardId: string,
    @Body() body: unknown,
  ) {
    return this.boardsService.importTrendToBoard(
      user.userId,
      parseOrThrow(projectIdSchema, boardId),
      parseOrThrow(importTrendSchema, body),
    );
  }

  @Get("trend-assets/:trendItemId")
  @Header("Cache-Control", PRIVATE_NO_STORE)
  async trendAsset(
    @Param("trendItemId") trendItemId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    response.redirect(
      307,
      await this.boardsService.trendCoverUrl(
        parseOrThrow(projectIdSchema, trendItemId),
      ),
    );
  }
}
