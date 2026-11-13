import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { ResearchService } from "./research.service";
import { researchAnalysisInputSchema } from "@fashion/shared";

const querySchema = z.object({
  q: z.string().trim().min(2).max(240),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

@Controller("projects/:projectId/research")
export class ResearchController {
  constructor(@Inject(ResearchService) private readonly research: ResearchService) {}

  @Get("search")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyBy: "user", limit: 30, name: "research-search", windowSeconds: 60 * 60 })
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_RESEARCH_QUERY",
        message: parsed.error.issues[0]?.message ?? "研究搜索条件无效",
      });
    }
    return this.research.search(user.userId, projectId, parsed.data.q, parsed.data.limit);
  }

  @Post("analyze")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyBy: "user", limit: 10, name: "research-analysis", windowSeconds: 60 * 60 })
  analyze(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const parsed = researchAnalysisInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_RESEARCH_ANALYSIS",
        message: parsed.error.issues[0]?.message ?? "研究分析参数无效",
      });
    }
    return this.research.analyze(user.userId, projectId, parsed.data);
  }
}
