import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { finishImageEdit, prepareImageEdit, prepareInpaintInputs } from "./image-edit";
import { aiGenerationRequestSchema, type AiGenerationRequest } from "@fashion/ai";
const request: AiGenerationRequest = {
  taskType: "i2i",
  prompt: "去背景",
  referenceImageUrl: "https://example.com/image.png",
  width: 1024,
  height: 1024,
  imageEdit: { intent: "remove_background" },
};
describe("图片编辑结果", () => {
  it.each(["empty", "structured", "legacy"] as const)("扩图准备后的%s参考仍是可实际提交的请求，并以扩展原图绑定蒙版", async (kind) => {
    const source = await sharp({ create: { width: 256, height: 256, channels: 4, background: "red" } }).png().toBuffer();
    const storage = { get: async () => source, delete: async () => {}, put: vi.fn(async () => {}), downloadUrl: async (key: string) => `https://private.test/${key}` };
    const detail = "https://private.test/detail.png";
    const input: AiGenerationRequest = { ...request, imageEdit: { intent: "outpaint", outpaint: { width: 1024, height: 1024, left: 128, top: 256 } },
      ...(kind === "legacy" ? { referenceImageUrls: [request.referenceImageUrl, detail] } : { referenceImages: kind === "empty" ? [] : [{ order: 0, url: detail, role: "detail_ref", weight: 0.5 }] }),
    };
    const prepared = await prepareImageEdit(input, source, "outpaint-references", storage);
    expect(aiGenerationRequestSchema.safeParse(prepared).success).toBe(true);
    expect(prepared.referenceImageUrl).toBe("https://private.test/image-edit/outpaint-references/input.png");
    if (kind === "legacy") expect(prepared.referenceImageUrls).toEqual([prepared.referenceImageUrl, detail]);
    if (kind === "structured") expect(prepared).toMatchObject({ referenceImages: [{ order: 0, url: detail, role: "detail_ref", weight: 0.5 }] });
  });
  it("标记参考图不会挤掉用户的额外图片及用途，超限在写入前拒绝", async () => {
    const source = await sharp({ create: { width: 32, height: 32, channels: 4, background: "white" } }).png().toBuffer();
    const put = vi.fn(async () => {});
    const storage = { put, get: async () => source, delete: async () => {}, downloadUrl: async (key: string) => `https://example.test/${key}` };
    const reference = { order: 8, url: "https://example.test/fabric.png", role: "fabric_texture" as const, weight: .6 };
    const edit: AiGenerationRequest = { ...request, imageEdit: { intent: "feedback" }, referenceImages: [reference] };
    const prepared = await prepareImageEdit(edit, source, "references", storage);
    expect(prepared).toMatchObject({ referenceImageUrls: [request.referenceImageUrl, "https://example.test/image-edit/references/annotations.png", reference.url], referenceImages: [expect.objectContaining({ order: 0, url: request.referenceImageUrl }), expect.objectContaining({ order: 1 }), { ...reference, order: 2 }] });
    put.mockClear();
    await expect(prepareImageEdit({ ...edit, referenceImages: Array.from({ length: 15 }, (_, order) => ({ ...reference, order })) }, source, "too-many", storage)).rejects.toThrow("最多附加 14 张");
    expect(put).not.toHaveBeenCalled();
  });
  it("意见参考图包含可见编号，未标记区域与原图输入保持不变", async () => {
    const source = await sharp({ create: { width: 200, height: 200, channels: 4, background: "#e0d8c0" } }).png().toBuffer();
    const original = Buffer.from(source);
    const put = vi.fn<(key: string, bytes: Buffer, contentType: string) => Promise<void>>(async () => {});
    const beforeWrite = vi.fn(async () => {});
    const prepared = await prepareImageEdit({ ...request, imageEdit: { intent: "feedback", markers: [{ number: 8, point: { x: .5, y: .5 } }] } }, source, "marker-test", { put, get: async () => source, delete: async () => {}, downloadUrl: async key => `https://example.test/${key}` }, beforeWrite);
    expect(prepared).toMatchObject({ referenceImageUrls: [request.referenceImageUrl, "https://example.test/image-edit/marker-test/annotations.png"] });
    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    const annotated = put.mock.calls[0]?.[1];
    if (!annotated) throw new Error("未生成标记参考图");
    const crop = { left: 88, top: 88, width: 24, height: 24 };
    expect(await sharp(annotated).extract(crop).raw().toBuffer()).not.toEqual(await sharp(source).extract(crop).raw().toBuffer());
    const untouched = { left: 0, top: 0, width: 50, height: 50 };
    expect(await sharp(annotated).extract(untouched).raw().toBuffer()).toEqual(await sharp(source).extract(untouched).raw().toBuffer());
    expect(source).toEqual(original);
  });
  it("局部重绘逐像素保护选区外RGBA，羽化区域按透明度混合", async () => {
    const original = Buffer.from([90, 150, 210, 0, 90, 150, 210, 64, 90, 150, 210, 128, 90, 150, 210, 255]);
    const source = await sharp(original, { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
    const mask = await sharp(Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0]), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
    const generated = await sharp({ create: { width: 4, height: 1, channels: 4, background: "blue" } }).png().toBuffer();
    const edit: AiGenerationRequest = { taskType: "inpaint", prompt: "只改袖口", referenceImageUrl: "https://example.com/source.png", maskImageUrl: "https://example.com/mask.png", width: 1024, height: 1024 };
    const result = await finishImageEdit(generated, edit, source, mask);
    const pixels = await sharp(result).raw().toBuffer();
    expect(pixels.subarray(0, 8)).toEqual(original.subarray(0, 8));
    expect([...pixels.subarray(8)]).toEqual([30, 50, 240, 191, 0, 0, 255, 255]);
    expect(await sharp(result).metadata()).toMatchObject({ format: "png", width: 4, height: 1 });
    await expect(finishImageEdit(generated, edit, source)).rejects.toThrow("缺少原图或蒙版");
  });

  it("原图按EXIF正向对齐蒙版，小尺寸供应商结果只回填选区", async () => {
    const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const mask = await sharp({ create: { width: 10, height: 20, channels: 4, background: "black" } })
      .composite([{ input: { create: { width: 5, height: 20, channels: 4, background: "black" } }, left: 5, top: 0, blend: "dest-out" }]).png().toBuffer();
    const blue = await sharp({ create: { width: 2, height: 4, channels: 4, background: "blue" } }).png().toBuffer();
    const edit: AiGenerationRequest = { taskType: "inpaint", prompt: "修改右半边", referenceImageUrl: "https://example.com/source.png", maskImageUrl: "https://example.com/mask.png", width: 512, height: 1024 };
    const result = await finishImageEdit(blue, edit, source, mask);
    expect(await sharp(result).metadata()).toMatchObject({ width: 10, height: 20 });
    expect((await sharp(result).metadata()).orientation).toBeUndefined();
    expect(await sharp(result).extract({ left: 0, top: 0, width: 5, height: 20 }).ensureAlpha().raw().toBuffer())
      .toEqual(await sharp(source).rotate().extract({ left: 0, top: 0, width: 5, height: 20 }).ensureAlpha().raw().toBuffer());
    expect([...await sharp(result).extract({ left: 9, top: 19, width: 1, height: 1 }).raw().toBuffer()]).toEqual([0, 0, 255, 255]);
  });

  it.each(["no-alpha", "unselected", "wrong-size", "corrupt"])("在生成前拒绝无效蒙版：%s", async kind => {
    const source = await sharp({ create: { width: 16, height: 16, channels: 4, background: "red" } }).png().toBuffer();
    const mask = kind === "corrupt" ? Buffer.from("broken") : await sharp({ create: { width: kind === "wrong-size" ? 8 : 16, height: 16, channels: kind === "no-alpha" ? 3 : 4, background: { r: 0, g: 0, b: 0, alpha: kind === "unselected" || kind === "no-alpha" ? 1 : 0 } } }).png().toBuffer();
    await expect(prepareInpaintInputs(source, mask)).rejects.toMatchObject({ code: "IMAGE_EDIT_INVALID_INPUT" });
  });
  it("扩图后原图区域的透明、半透明和不透明像素都原样保留", async () => {
    const pixels = Buffer.from([
      230, 80, 30, 255, 10, 140, 210, 128, 50, 100, 150, 0, 90, 180, 40, 64,
    ]);
    const source = await sharp(pixels, {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer();
    const generated = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    const edit: AiGenerationRequest = {
      ...request,
      imageEdit: {
        intent: "outpaint",
        outpaint: { width: 1024, height: 1024, left: 32, top: 48 },
      },
    };
    const result = await finishImageEdit(generated, edit, source);
    const originalRegion = await sharp(result)
      .extract({ left: 32, top: 48, width: 2, height: 2 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(originalRegion).toEqual(pixels);
    const expandedPixel = await sharp(result)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect([...expandedPixel]).toEqual([0, 0, 255, 255]);
  });
  it("扩图缺失原图或范围无效时拒绝产出，不把未保护结果当成成功", async () => {
    const source = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const edit: AiGenerationRequest = {
      ...request,
      imageEdit: {
        intent: "outpaint",
        outpaint: { width: 1024, height: 1024, left: 1020, top: 0 },
      },
    };
    await expect(finishImageEdit(source, edit, source)).rejects.toThrow(
      "完整包含原图",
    );
    await expect(finishImageEdit(source, edit)).rejects.toThrow("缺少原图");
  });
  it("扩图按EXIF正向尺寸保护原图并去除旋转元数据", async () => {
    const source = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "red" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const original = await sharp(source)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer();
    const generated = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "blue" },
    })
      .jpeg()
      .toBuffer();
    const edit: AiGenerationRequest = {
      ...request,
      imageEdit: {
        intent: "outpaint",
        outpaint: { width: 1024, height: 1024, left: 7, top: 9 },
      },
    };
    const result = await finishImageEdit(generated, edit, source);
    expect(await sharp(result).metadata()).toMatchObject({
      width: 1024,
      height: 1024,
      format: "png",
    });
    expect((await sharp(result).metadata()).orientation).toBeUndefined();
    expect(
      await sharp(result)
        .extract({ left: 7, top: 9, width: 10, height: 20 })
        .ensureAlpha()
        .raw()
        .toBuffer(),
    ).toEqual(original);
  });
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
