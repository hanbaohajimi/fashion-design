import {
  VLM_ROLE_LABELS,
  type VlmRoleLabel,
} from "@fashion/shared";
import OpenAI from "openai";

export interface VlmClassification {
  readonly confidence: number;
  readonly isFashion: boolean;
  readonly label: VlmRoleLabel;
}

export interface VlmClassifier {
  classify(image: Buffer, mimeType: string): Promise<VlmClassification>;
}

const LABEL_SET = new Set<string>(VLM_ROLE_LABELS);

export class OpenAiVlmClassifier implements VlmClassifier {
  async classify(
    image: Buffer,
    mimeType: string,
  ): Promise<VlmClassification> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("缺少 OPENAI_API_KEY，无法执行 VLM 角色推断");
    }

    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "你是服装设计白板的图片分类器。只判断图片主要用途，" +
                "从 garment_photo、fabric_texture、fashion_sketch、silhouette、" +
                "garment_detail、color_palette、non_fashion、other_fashion 中选一个。" +
                "confidence 是 0 到 1 的校准置信度；非服装内容 isFashion 必须为 false。",
            },
            {
              type: "input_image",
              detail: "low",
              image_url: `data:${mimeType};base64,${image.toString("base64")}`,
            },
          ],
        },
      ],
      max_output_tokens: 120,
      model: process.env.OPENAI_VLM_MODEL?.trim() || "gpt-4o-mini",
      store: false,
      text: {
        format: {
          name: "fashion_board_role",
          schema: {
            additionalProperties: false,
            properties: {
              confidence: { maximum: 1, minimum: 0, type: "number" },
              isFashion: { type: "boolean" },
              label: {
                enum: [...VLM_ROLE_LABELS],
                type: "string",
              },
            },
            required: ["label", "confidence", "isFashion"],
            type: "object",
          },
          strict: true,
          type: "json_schema",
        },
      },
    });
    const parsed = JSON.parse(response.output_text) as {
      confidence?: unknown;
      isFashion?: unknown;
      label?: unknown;
    };
    if (
      typeof parsed.confidence !== "number" ||
      typeof parsed.isFashion !== "boolean" ||
      typeof parsed.label !== "string" ||
      !LABEL_SET.has(parsed.label)
    ) {
      throw new Error("VLM 返回的结构化分类结果无效");
    }
    return {
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      isFashion: parsed.isFashion,
      label: parsed.label as VlmRoleLabel,
    };
  }
}
