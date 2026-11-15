import {
  promptEnhancementResultSchema,
  type PromptEnhancementRequest,
  type PromptEnhancementResult,
} from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";

export async function enhancePrompt(
  projectId: string,
  input: PromptEnhancementRequest,
  signal: AbortSignal,
): Promise<PromptEnhancementResult> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/assistant/prompt-enhancements`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(error.message ?? "增强未完成，原文已保留，请重试。");
  }
  const result: unknown = await response.json();
  const parsed = promptEnhancementResultSchema.safeParse(
    result && typeof result === "object"
      ? { enhancedPrompt: Reflect.get(result, "enhancedPrompt") }
      : result,
  );
  if (
    !parsed.success ||
    !result ||
    typeof result !== "object" ||
    Reflect.get(result, "requestId") !== input.requestId
  )
    throw new Error("增强结果无效，原文已保留。");
  return { requestId: input.requestId, ...parsed.data };
}
