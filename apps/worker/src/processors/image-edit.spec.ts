import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { finishImageEdit, prepareImageEdit } from "./image-edit";
import type { AiGenerationRequest } from "@fashion/ai";
const request: AiGenerationRequest = {
  taskType: "i2i",
  prompt: "去背景",
  referenceImageUrl: "https://example.com/image.png",
  width: 1024,
  height: 1024,
  imageEdit: { intent: "remove_background" },
};
describe("图片编辑结果", () => {
  it("拒绝白底和全透明图片，只接受包含主体的透明图片", async () => {
    const white = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "white" },
    })
      .png()
      .toBuffer();
    const transparent = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(finishImageEdit(white, request)).rejects.toThrow("透明区域");
    await expect(finishImageEdit(transparent, request)).rejects.toThrow("主体");
    const valid = await sharp(transparent)
      .composite(
        [{ input: white, left: 8, top: 0 }].map((v) => ({
          ...v,
          input: {
            create: {
              width: 8,
              height: 16,
              channels: 4 as const,
              background: "red",
            },
          },
        })),
      )
      .png()
      .toBuffer();
    await expect(finishImageEdit(valid, request)).resolves.toEqual(valid);
  });
  it("扩图蒙版保护原图，最终重新合成原始像素", async () => {
    const source = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const stored = new Map<string, Buffer>();
    const frame = { width: 1024, height: 1024, left: 32, top: 48 };
    const edit = {
      ...request,
      imageEdit: { intent: "outpaint" as const, outpaint: frame },
    };
    const prepared = await prepareImageEdit(edit, source, "task", {
      get: async (key) => stored.get(key) ?? Buffer.alloc(0),
      put: async (key, bytes) => {
        stored.set(key, bytes);
      },
      delete: async () => {},
      downloadUrl: async (key) => `https://example.com/${key}`,
    });
    expect(prepared.taskType).toBe("inpaint");
    const mask = stored.get("image-edit/task/mask.png");
    expect(mask).toBeDefined();
    const sample = await sharp(mask)
      .extract({ left: 32, top: 48, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(sample[3]).toBe(255);
    const generated = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    const result = await finishImageEdit(generated, edit, source);
    const pixel = await sharp(result)
      .extract({ left: 32, top: 48, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([...pixel].slice(0, 3)).toEqual([255, 0, 0]);
    await expect(
      prepareImageEdit(
        {
          ...edit,
          imageEdit: { intent: "outpaint", outpaint: { ...frame, left: 1020 } },
        },
        source,
        "task",
        {
          get: async () => source,
          put: async () => {},
          delete: async () => {},
          downloadUrl: async () => "https://example.com",
        },
      ),
    ).rejects.toThrow("完整包含原图");
  });
});
