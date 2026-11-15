import type {
  AssistantCanvasEnvelope,
  AssistantCanvasProof,
  CanvasCreation,
  CanvasDocumentView,
} from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import type { WorkflowMessageView } from "../agent/agent-api";
import type { WorkflowGraph } from "./workflow-api";
export class AssistantCanvasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  envelope: AssistantCanvasEnvelope,
  step: string,
  body: unknown,
): Promise<T> {
  const response = await privateFetch(
    `/api/agent-conversations/${encodeURIComponent(envelope.conversationId)}/canvas-actions/${encodeURIComponent(envelope.messageId)}/${step}`,
    {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: envelope.clientId,
        ...(body as object),
      }),
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new AssistantCanvasApiError(
      error.message ?? "画布操作回执尚未确认，请继续核对。",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export const claimCanvasAction = (value: AssistantCanvasEnvelope) =>
  request<WorkflowMessageView>(value, "claim", {});
export const applyServerCanvasAction = (value: AssistantCanvasEnvelope) =>
  request<{
    nodeId?: string;
    graph?: WorkflowGraph;
    canvas?: CanvasDocumentView;
    creation?: CanvasCreation;
  }>(value, "apply", {});
export const finishCanvasAction = (
  value: AssistantCanvasEnvelope,
  status: "succeeded" | "failed",
  proof: AssistantCanvasProof,
  error?: string,
) =>
  request<WorkflowMessageView>(value, "receipt", {
    status,
    proof,
    ...(error ? { error: error.slice(0, 1000) } : {}),
  });
