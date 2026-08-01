export type AmuxClaudeImageDetail = "auto" | "high" | "low";

export interface AmuxClaudeImageInput {
  readonly detail?: AmuxClaudeImageDetail;
  readonly url: string;
}

export interface AmuxClaudeJsonRequest<T> {
  readonly images?: readonly AmuxClaudeImageInput[];
  readonly instructions: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly maxTokens: number;
  readonly parse: (value: unknown) => T;
  readonly prompt: string;
  readonly schemaName: string;
}

export interface AmuxClaudeJsonClient {
  generateJson<T>(request: AmuxClaudeJsonRequest<T>): Promise<T>;
}

export interface AmuxClaudeClientConfig {
  readonly apiKey: () => string | undefined;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export interface AmuxClaudeTransportRequest {
  readonly apiKey: string;
  readonly body: Record<string, unknown>;
  readonly timeoutMs: number;
}

export type AmuxClaudeTransport = (
  url: string,
  request: AmuxClaudeTransportRequest,
) => Promise<unknown>;

export class AmuxClaudeClient implements AmuxClaudeJsonClient {
  constructor(
    private readonly config: AmuxClaudeClientConfig,
    private readonly transport: AmuxClaudeTransport = defaultTransport,
  ) {}

  async generateJson<T>(request: AmuxClaudeJsonRequest<T>): Promise<T> {
    const apiKey = this.config.apiKey()?.trim();
    if (!apiKey) {
      throw new Error("缺少 AMUX_API_KEY，无法调用 Claude");
    }

    const content: Array<Record<string, unknown>> = [
      { text: request.prompt, type: "text" },
      ...(request.images ?? []).map((image) => ({
        source: anthropicImageSource(image.url),
        type: "image",
      })),
    ];
    const body = {
      max_tokens: request.maxTokens,
      messages: [{ content, role: "user" }],
      model: this.config.model,
      stream: false,
      system: request.instructions,
      temperature: 0,
      tool_choice: {
        disable_parallel_tool_use: true,
        name: request.schemaName,
        type: "tool",
      },
      tools: [
        {
          description: "Submit the final structured result for this request.",
          input_schema: request.jsonSchema,
          name: request.schemaName,
          strict: true,
        },
      ],
    };
    const response = await this.transport(
      `${this.config.baseUrl.replace(/\/$/, "")}/messages`,
      { apiKey, body, timeoutMs: this.config.timeoutMs },
    );
    assertUsableStopReason(response);
    const toolInput = responseToolInput(response, request.schemaName);
    if (toolInput !== undefined) {
      return request.parse(toolInput);
    }
    return parseStructuredJson(responseText(response), request.parse);
  }
}

function assertUsableStopReason(response: unknown): void {
  if (!isRecord(response)) return;
  if (response.stop_reason === "refusal") {
    throw new Error("Amux Claude 拒绝了结构化请求");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Amux Claude 结构化响应被截断");
  }
}

function anthropicImageSource(url: string): Record<string, string> {
  const dataImage =
    /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(
      url,
    );
  if (dataImage) {
    return {
      data: dataImage[2] ?? "",
      media_type: (dataImage[1] ?? "image/png").toLowerCase(),
      type: "base64",
    };
  }
  if (url.startsWith("data:")) {
    throw new Error("Amux Claude 收到不支持的 data URL 图片格式");
  }
  return { type: "url", url };
}

async function defaultTransport(
  url: string,
  request: AmuxClaudeTransportRequest,
): Promise<unknown> {
  const response = await fetch(url, {
    body: JSON.stringify(request.body),
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": request.apiKey,
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new Error(
      `Amux Claude 请求失败（HTTP ${response.status}）：${errorMessage(payload)}`,
    );
  }
  return payload;
}

function responseText(response: unknown): string {
  if (!isRecord(response)) {
    throw new Error("Amux Claude 响应格式无效");
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Amux Claude 拒绝了结构化请求");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Amux Claude 结构化响应被截断");
  }
  if (Array.isArray(response.content)) {
    return textFromBlocks(response.content);
  }
  if (!Array.isArray(response.choices)) {
    throw new Error("Amux Claude 响应缺少 content");
  }
  const first = response.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error("Amux Claude 响应缺少 message");
  }
  const content = first.message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? textFromBlocks(content)
        : "";
  if (text.trim().length === 0) {
    throw new Error("Amux Claude 响应缺少文本内容");
  }
  return text;
}

function responseToolInput(
  response: unknown,
  expectedToolName: string,
): unknown | undefined {
  if (!isRecord(response) || !Array.isArray(response.content)) {
    return undefined;
  }
  const toolUse = response.content.find(
    (block) =>
      isRecord(block) &&
      block.type === "tool_use" &&
      block.name === expectedToolName &&
      "input" in block,
  );
  return isRecord(toolUse) ? toolUse.input : undefined;
}

function textFromBlocks(blocks: readonly unknown[]): string {
  const text = blocks
    .map((block) =>
      isRecord(block) && typeof block.text === "string" ? block.text : "",
    )
    .join("");
  if (text.trim().length === 0) {
    throw new Error("Amux Claude 响应缺少文本内容");
  }
  return text;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function parseStructuredJson<T>(
  value: string,
  parse: (value: unknown) => T,
): T {
  let schemaError: unknown;
  for (const candidate of jsonCandidates(value)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    try {
      return parse(parsed);
    } catch (error) {
      schemaError = error;
    }
  }
  if (schemaError !== undefined) {
    throw schemaError;
  }
  throw new Error("Amux Claude 返回的内容不是有效 JSON");
}

function jsonCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const trimmed = value.trim();
  if (trimmed) {
    candidates.add(stripCodeFence(trimmed));
  }
  for (const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
    if (match[1]?.trim()) {
      candidates.add(match[1].trim());
    }
  }
  for (const candidate of balancedJsonValues(value)) {
    candidates.add(candidate);
  }
  return [...candidates];
}

function balancedJsonValues(value: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start];
    if (opening !== "{" && opening !== "[") continue;
    const stack: string[] = [opening];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < value.length; index += 1) {
      const character = value[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        stack.push(character);
      } else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) break;
        stack.pop();
        if (stack.length === 0) {
          candidates.push(value.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return candidates;
}

function errorMessage(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.error)) {
    return typeof payload.error.message === "string"
      ? payload.error.message
      : "未知错误";
  }
  return "未知错误";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
