import { Injectable } from "@nestjs/common";
import OpenAI from "openai";

import { dnaDraftSchema, type DnaDraft } from "./collections.schemas";

export interface DnaExtractor {
  extract(imageUrl: string): Promise<DnaDraft>;
}

@Injectable()
export class OpenAiDnaExtractor implements DnaExtractor {
  async extract(imageUrl: string): Promise<DnaDraft> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("缺少 OPENAI_API_KEY，无法提取系列 DNA");
    }

    const response = await new OpenAI({ apiKey }).responses.create({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "你是高级服装系列企划师。分析这张 Hero Look，只提取可延展成系列的设计 DNA。" +
                "palette 返回最具识别度的 3-6 个色彩及准确六位 HEX；silhouettes 返回廓形语言；" +
                "fabrics 返回可见或高度可信的面料；moodWords 返回简洁中文情绪词。" +
                "不要描述模特身份、背景或摄影器材，不确定时宁可返回空数组。",
            },
            {
              type: "input_image",
              detail: "high",
              image_url: imageUrl,
            },
          ],
        },
      ],
      max_output_tokens: 500,
      model: process.env.OPENAI_DNA_MODEL?.trim() || "gpt-4o-mini",
      store: false,
      text: {
        format: {
          name: "collection_dna",
          schema: {
            additionalProperties: false,
            properties: {
              fabrics: {
                items: { maxLength: 64, minLength: 1, type: "string" },
                maxItems: 12,
                type: "array",
              },
              moodWords: {
                items: { maxLength: 64, minLength: 1, type: "string" },
                maxItems: 12,
                type: "array",
              },
              palette: {
                items: {
                  additionalProperties: false,
                  properties: {
                    hex: {
                      pattern: "^#[0-9A-Fa-f]{6}$",
                      type: "string",
                    },
                    name: { maxLength: 40, minLength: 1, type: "string" },
                  },
                  required: ["hex", "name"],
                  type: "object",
                },
                maxItems: 12,
                type: "array",
              },
              silhouettes: {
                items: { maxLength: 64, minLength: 1, type: "string" },
                maxItems: 12,
                type: "array",
              },
            },
            required: ["palette", "silhouettes", "fabrics", "moodWords"],
            type: "object",
          },
          strict: true,
          type: "json_schema",
        },
      },
    });

    return dnaDraftSchema.parse(JSON.parse(response.output_text));
  }
}
