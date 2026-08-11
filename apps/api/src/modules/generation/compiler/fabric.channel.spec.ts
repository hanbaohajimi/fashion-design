import { FabricScope, FileStatus } from "@fashion/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FabricChannel } from "./fabric.channel";

function element(
  id: string,
  fabricId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    record: { props: { fabricId, ...overrides } },
    role: "fabric_ref",
    shapeType: "fashion-fabric",
  };
}

describe("FabricChannel", () => {
  const database = {
    fabric: {
      findMany: vi.fn(),
    },
  };
  const storage = {
    createDownloadUrl: vi.fn(),
  };
  const channel = new FabricChannel(
    database as never,
    "user-1",
    storage as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    database.fabric.findMany.mockResolvedValue([]);
    storage.createDownloadUrl.mockImplementation(
      async (objectKey: string) => `https://signed.example/${objectKey}`,
    );
  });

  it("无面料元素时返回空结果且不访问数据库", async () => {
    await expect(
      channel.compile([
        {
          id: "note-1",
          record: { props: { text: "clean lines" } },
          role: "note",
          shapeType: "fashion-note",
        },
      ]),
    ).resolves.toEqual({ prompt: "", refImages: [] });
    expect(database.fabric.findMany).not.toHaveBeenCalled();
  });

  it("把多块面料编译成材质 prompt、纹理引用和血缘输入", async () => {
    database.fabric.findMany.mockResolvedValue([
      {
        attributes: {
          composition: { cotton: 60, polyester: 40 },
          drape: "moderate",
          opacity: "opaque",
          seasonSuggestion: ["autumn", "winter"],
          sheen: "matte",
          stretch: "slight",
          texture: "smooth",
          useCases: ["suit", "outerwear"],
          weave: "plain",
          weight: 260,
          width: 150,
        },
        id: "fabric-cotton",
        mainFile: {
          objectKey: "presets/cotton.webp",
          status: FileStatus.READY,
          thumbnail1024Key: "presets/cotton-1024.webp",
        },
        name: "Cotton Blend",
        ownerId: null,
        scope: FabricScope.PRESET,
      },
      {
        attributes: {
          composition: [
            { name: "silk", percentage: 92 },
            { name: "spandex", percentage: 8 },
          ],
          drape: "fluid",
          sheen: "glossy",
          texture: "smooth",
          weave: "twill",
        },
        id: "fabric-silk",
        mainFile: {
          objectKey: "users/user-1/silk.webp",
          status: FileStatus.READY,
          thumbnail1024Key: null,
        },
        name: "Stretch Silk",
        ownerId: "user-1",
        scope: FabricScope.USER,
      },
    ]);

    const result = await channel.compile([
      element("element-cotton", "fabric-cotton"),
      element("element-silk", "fabric-silk", { weight: 0.85 }),
    ]);

    expect(result.prompt).toContain(
      "fabric material: cotton 60%, polyester 40%, weave type: plain, fabric texture: smooth, drape: moderate, sheen: matte",
    );
    expect(result.prompt).toContain("weight: 260 GSM");
    expect(result.prompt).toContain("stretch: slight");
    expect(result.prompt).toContain("opacity: opaque");
    expect(result.prompt).toContain("fabric width: 150 cm");
    expect(result.prompt).toContain("recommended seasons: autumn, winter");
    expect(result.prompt).toContain("use cases: suit, outerwear");
    expect(result.prompt).toContain(
      "fabric material: silk 92%, spandex 8%, weave type: twill, fabric texture: smooth, drape: fluid, sheen: glossy",
    );
    expect(result.refImages).toEqual([
      expect.objectContaining({
        fabricId: "fabric-cotton",
        imageUrl: "https://signed.example/presets/cotton-1024.webp",
        role: "fabric_texture",
        weight: 0.7,
      }),
      expect.objectContaining({
        fabricId: "fabric-silk",
        imageUrl: "https://signed.example/users/user-1/silk.webp",
        role: "fabric_texture",
        weight: 0.85,
      }),
    ]);
    expect(result.fabricInputs).toEqual([
      expect.objectContaining({
        boardElementId: "element-cotton",
        fabricId: "fabric-cotton",
      }),
      expect.objectContaining({
        boardElementId: "element-silk",
        fabricId: "fabric-silk",
      }),
    ]);
  });

  it("数据库查询限定为预置面料或当前用户面料，越权记录不会进入输出", async () => {
    const result = await channel.compile([
      element("element-private", "fabric-user-2"),
    ]);

    expect(database.fabric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { scope: FabricScope.PRESET },
            { ownerId: "user-1", scope: FabricScope.USER },
          ],
        }),
      }),
    );
    expect(result).toEqual({ prompt: "", refImages: [] });
    expect(JSON.stringify(result)).not.toContain("fabric-user-2");
  });
});
