import { z } from "zod";

export const agentIdSchema = z.string().trim().min(1).max(128);

export const createAgentConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

export const updateAgentConversationSchema = z
  .object({
    archived: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  .refine(
    (value) => value.archived !== undefined || value.title !== undefined,
    {
      message: "至少需要更新一个字段",
    },
  );

export const listAgentConversationsSchema = z.object({
  cursor: agentIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listAgentMessagesSchema = z.object({
  cursor: agentIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendAgentMessageSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(200),
  content: z.string().trim().min(1).max(4_000),
  fileAssetIds: z.array(agentIdSchema).max(8).default([]),
  shapeIds: z.array(agentIdSchema).max(100).default([]),
});

export type CreateAgentConversationInput = z.infer<
  typeof createAgentConversationSchema
>;
export type UpdateAgentConversationInput = z.infer<
  typeof updateAgentConversationSchema
>;
export type ListAgentConversationsInput = z.infer<
  typeof listAgentConversationsSchema
>;
export type ListAgentMessagesInput = z.infer<typeof listAgentMessagesSchema>;
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageSchema>;
