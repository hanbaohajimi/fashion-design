import { PrismaClient, prisma } from "@fashion/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { AssistantStreamsService } from "./assistant-streams.service";

export const ASSISTANT_CANCEL_DB = Symbol("ASSISTANT_CANCEL_DB");

@Injectable()
export class AssistantCancellationService {
  constructor(@Inject(ASSISTANT_CANCEL_DB) private readonly database: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(AssistantStreamsService) private readonly streams: AssistantStreamsService) {}

  async cancel(userId: string, conversationId: string, requestId: string) {
    const conversation = await this.database.agentConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("对话不存在");
    await this.access.require(userId, conversation.projectId, "edit");
    const partial = await this.streams.partialText(conversationId, requestId);
    const result = await this.database.$transaction(async tx => {
      // Same first lock as a workflow final commit; cancellation and completion serialize.
      await tx.agentConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      const message = await tx.agentMessage.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: requestId } }, include: { reply: true } });
      if (!message?.reply) throw new NotFoundException("回复尚未受理，请读取消息状态后重试");
      if (message.reply.status !== "PENDING") return { status: message.reply.status.toLowerCase(), messageId: message.reply.id, canceled: message.reply.status === "CANCELED" };
      const turn = await tx.agentTurn.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: requestId } } });
      if (turn) {
        await tx.agentTurn.updateMany({ where: { id: turn.id, status: { in: ["pending", "running", "committing"] } }, data: { status: "canceled", leaseToken: null, leaseExpiresAt: null, error: "用户停止回复" } });
        if (turn.leaseToken) await tx.agentConversation.updateMany({ where: { id: conversationId, activeTurnId: turn.leaseToken }, data: { activeTurnId: null, activeTurnStartedAt: null, intentEpoch: { increment: 1 } } });
      }
      await tx.agentMessage.updateMany({ where: { id: message.reply.id, status: "PENDING" }, data: { status: "CANCELED", content: partial ?? message.reply.content, errorCode: "ASSISTANT_CANCELED", errorMessage: "已停止本系统后续处理，已收到的内容尚未完成校验" } });
      return { status: "canceled", messageId: message.reply.id, canceled: true };
    });
    // Only notify after the durable fence committed. Other instances also poll stored state.
    if (result.canceled) await this.streams.notifyCancellation(conversationId, requestId);
    return { ...result, providerStopped: null, scope: "assistant_reply" as const };
  }
}

export const assistantCancellationDatabase = { provide: ASSISTANT_CANCEL_DB, useValue: prisma };
