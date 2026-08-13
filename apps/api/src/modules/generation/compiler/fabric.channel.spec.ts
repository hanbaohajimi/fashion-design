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

  it("把多块面料的图片和标签编译成纹理引用及血缘输入", async () => {
    database.fabric.findMany.mockResolvedValue([
      {
        id: "fabric-cotton",
        mainFile: {
          objectKey: "presets/cotton.webp",
          status: FileStatus.READY,
          thumbnail1024Key: "presets/cotton-1024.webp",
        },
        tags: ["cotton blend", "matte", "structured"],
      },
      {
        id: "fabric-silk",
        mainFile: {
          objectKey: "users/user-1/silk.webp",
          status: FileStatus.READY,
          thumbnail1024Key: null,
        },
        tags: ["stretch silk", "glossy", "fluid"],
      },
    ]);

    const result = await channel.compile([
      element("element-cotton", "fabric-cotton"),
      element("element-silk", "fabric-silk", { weight: 0.85 }),
    ]);

    expect(result.prompt).toContain(
      "fabric tags: cotton blend, matte, structured",
    );
    expect(result.prompt).toContain("fabric tags: stretch silk, glossy, fluid");
    expect(result.refImages).toEqual([
      expect.objectContaining({
        fabricId: "fabric-cotton",
        imageUrl: "https://signed.example/presets/cotton-1024.webp",
        labels: ["cotton blend", "matte", "structured"],
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
        tags: ["cotton blend", "matte", "structured"],
      }),
      expect.objectContaining({
        boardElementId: "element-silk",
        fabricId: "fabric-silk",
        tags: ["stretch silk", "glossy", "fluid"],
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
