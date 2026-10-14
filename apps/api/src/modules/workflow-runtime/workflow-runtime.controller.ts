import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import {
  workflowExecuteSchema,
  workflowImportAssetSchema,
  workflowNodeDecisionSchema,
  workflowProposalDecisionSchema,
  workflowProposalRequestSchema,
  workflowRoleInferenceSchema,
} from "./workflow-runtime.schemas";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

const idSchema = z.string().trim().min(1).max(128);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "请求参数无效",
    });
  return parsed.data;
}

@Controller("projects/:projectId/workflow")
@UseGuards(RateLimitGuard)
@RateLimit({
  keyBy: "user",
  limit: 120,
  name: "workflow-runtime",
  windowSeconds: 60,
})
export class WorkflowRuntimeController {
  constructor(
    @Inject(WorkflowRuntimeService)
    private readonly runtime: WorkflowRuntimeService,
  ) {}

  @Get("sync")
  @Header("Cache-Control", "private, no-store")
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.runtime.sync(user.userId, parse(idSchema, projectId));
  }

  @Post("proposals")
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.propose(
      user.userId,
      parse(idSchema, projectId),
      parse(workflowProposalRequestSchema, body),
    );
  }

  @Post("proposals/:proposalId/accept")
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.accept(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, proposalId),
      parse(workflowProposalDecisionSchema, body),
    );
  }

  @Post("proposals/:proposalId/reject")
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.reject(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, proposalId),
      parse(workflowExecuteSchema, body),
    );
  }

  @Post("nodes/:nodeId/execute")
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.execute(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, nodeId),
      parse(workflowExecuteSchema, body),
    );
  }

  @Post("nodes/:nodeId/infer-role")
  inferRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.inferRole(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, nodeId),
      parse(workflowRoleInferenceSchema, body),
    );
  }

  @Get("nodes/:nodeId/history")
  @Header("Cache-Control", "private, no-store")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ) {
    return this.runtime.history(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, nodeId),
    );
  }

  @Post("import-asset")
  importAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.importAsset(user.userId, parse(idSchema, projectId), parse(workflowImportAssetSchema, body));
  }

  @Post("nodes/:nodeId/decisions")
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    return this.runtime.decide(
      user.userId,
      parse(idSchema, projectId),
      parse(idSchema, nodeId),
      parse(workflowNodeDecisionSchema, body),
    );
  }
}
