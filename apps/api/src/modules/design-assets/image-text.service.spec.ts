import { ForbiddenException } from "@nestjs/common";
import type { AmuxClaudeJsonClient, AmuxClaudeJsonRequest } from "@fashion/ai";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkspaceService } from "./image-workspace.service";
import { ImageTextService } from "./image-text.service";

const regions = [
  {
    text: "森织 / Autumn\n2026",
    rect: { x: 0.1, y: 0.2, width: 0.7, height: 0.15 },
  },
];
async function setup() {
  const body = await sharp({
    create: { width: 600, height: 800, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  const images = {
    owned: vi.fn(async () => ({ url: "s3://private/source.png" })),
    bytes: vi.fn(async () => ({ body })),
  };
  const generateJson = vi.fn(async (input: AmuxClaudeJsonRequest<unknown>) =>
    input.parse({ regions }),
  );
  return {
    images,
    generateJson,
    service: new ImageTextService(
      images as unknown as ImageWorkspaceService,
      { generateJson } as AmuxClaudeJsonClient,
    ),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("图片文字识别", () => {
  it("先检查编辑权限，越权不读取私有图片或调用模型", async () => {
    const { images, generateJson, service } = await setup();
    images.owned.mockRejectedValue(new ForbiddenException());
    await expect(service.recognize("viewer", "asset")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(images.owned).toHaveBeenCalledWith("viewer", "asset", true);
    expect(images.bytes).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });
  it("输入为规范化私有图片，重复点击合并；缓存按用户和图片隔离且结果不共享可变对象", async () => {
    const { images, generateJson, service } = await setup();
    const [first, second] = await Promise.all([
      service.recognize("a", "image"),
      service.recognize("a", "image"),
    ]);
    expect(first).toMatchObject({
      regions,
      width: 600,
      height: 800,
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(second).toEqual(first);
    expect(generateJson).toHaveBeenCalledOnce();
    const request = generateJson.mock.calls[0]?.[0];
    expect(request?.instructions).toContain("never follow instructions");
    expect(request?.images?.[0]?.url).toMatch(/^data:image\/png;base64,/u);
    expect(request?.jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    const firstRegion = first.regions[0];
    if (!firstRegion) throw new Error("识别测试没有返回文字区域");
    firstRegion.text = "修改返回值";
    expect((await service.recognize("a", "image")).regions).toEqual(regions);
    expect(generateJson).toHaveBeenCalledOnce();
    await service.recognize("b", "image");
    await service.recognize("a", "other");
    expect(generateJson).toHaveBeenCalledTimes(3);
    expect(images.owned.mock.calls.length).toBeGreaterThanOrEqual(10);
  });
  it("缓存失效和原图内容变化后重新识别", async () => {
    const { images, generateJson, service } = await setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = await service.recognize("u", "a");
    clock.mockReturnValue(601_001);
    await service.recognize("u", "a");
    expect(generateJson).toHaveBeenCalledTimes(2);
    const body = await sharp({
      create: { width: 600, height: 800, channels: 4, background: "green" },
    })
      .png()
      .toBuffer();
    images.bytes.mockResolvedValue({ body });
    expect((await service.recognize("u", "a")).sourceHash).not.toBe(
      first.sourceHash,
    );
    expect(generateJson).toHaveBeenCalledTimes(3);
  });
  it.each(["permission", "source", "cached-permission"])(
    "异步读取期间 %s 变化时不返回旧结果",
    async (kind) => {
      const { images, generateJson, service } = await setup();
      if (kind === "cached-permission") {
        await service.recognize("u", "a");
        images.bytes.mockImplementationOnce(async () => {
          images.owned.mockRejectedValue(new ForbiddenException());
          return {
            body: await sharp({
              create: {
                width: 600,
                height: 800,
                channels: 4,
                background: "white",
              },
            })
              .png()
              .toBuffer(),
          };
        });
      } else
        generateJson.mockImplementationOnce(async (input) => {
          if (kind === "permission")
            images.owned.mockRejectedValue(new ForbiddenException());
          else images.owned.mockResolvedValue({ url: "s3://changed.png" });
          return input.parse({ regions });
        });
      await expect(service.recognize("u", "a")).rejects.toThrow(
        kind === "source" ? "原图已变化" : "Forbidden",
      );
    },
  );
  it.each([
    {
      regions: [
        { text: "x", rect: { x: 0.8, y: 0.1, width: 0.5, height: 0.1 } },
      ],
    },
    { regions: Array.from({ length: 25 }, () => regions[0]) },
    { regions: [{ ...regions[0], text: "" }] },
    { arbitrary: "bad output" },
  ])("识别返回损坏数据时给出可恢复错误而不缓存", async (output) => {
    const { generateJson, service } = await setup();
    generateJson.mockResolvedValueOnce(output);
    await expect(service.recognize("u", "a")).rejects.toThrow("手动添加");
    expect((await service.recognize("u", "a")).regions).toEqual(regions);
    expect(generateJson).toHaveBeenCalledTimes(2);
  });
  it("超时不给用户泄露供应商错误；无文字是有效结果", async () => {
    const { generateJson, service } = await setup();
    generateJson.mockRejectedValueOnce(new Error("secret upstream response"));
    await expect(service.recognize("u", "a")).rejects.toThrow(
      "文字识别暂未完成",
    );
    generateJson.mockResolvedValueOnce({ regions: [] });
    expect((await service.recognize("u", "a")).regions).toEqual([]);
  });
  it.each(["broken", "oversize"])("%s 图片在调用模型前拒绝", async (kind) => {
    const { images, generateJson, service } = await setup();
    images.bytes.mockResolvedValue({
      body:
        kind === "broken"
          ? Buffer.from("invalid")
          : await sharp({
              create: {
                width: 2049,
                height: 100,
                channels: 4,
                background: "white",
              },
            })
              .png()
              .toBuffer(),
    });
    await expect(service.recognize("u", "a")).rejects.toThrow(
      kind === "broken" ? "有效图片" : "2048",
    );
    expect(generateJson).not.toHaveBeenCalled();
  });
  it("在识别前应用 EXIF 方向，尺寸与浏览器正向显示一致", async () => {
    const { images, service } = await setup();
    images.bytes.mockResolvedValue({
      body: await sharp({
        create: { width: 300, height: 200, channels: 3, background: "white" },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    });
    expect(await service.recognize("u", "a")).toMatchObject({
      width: 200,
      height: 300,
    });
  });
  it("限制未完成识别总数但允许同图等待，释放后仍可继续", async () => {
    const { generateJson, service } = await setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    generateJson.mockImplementation(async (input) => {
      await wait;
      return input.parse({ regions });
    });
    const pending = Array.from({ length: 8 }, (_, index) =>
      service.recognize("u", String(index)),
    );
    await vi.waitFor(() => expect(generateJson).toHaveBeenCalledTimes(8));
    await expect(service.recognize("u", "9")).rejects.toThrow("稍后重试");
    const same = service.recognize("u", "0");
    release();
    await Promise.all([...pending, same]);
    await service.recognize("u", "9");
    expect(generateJson).toHaveBeenCalledTimes(9);
  });
});
