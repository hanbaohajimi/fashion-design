import { describe, expect, it } from "vitest";

import { buildFabricUploadFormData, validateFabricUpload } from "./fabric-api";
import { canManageFabric, filterFabricsByTag } from "./fabric-filters";
import type { Fabric } from "./fabric-types";

function fabric(id: string, tags: readonly string[]): Fabric {
  return {
    canManage: true,
    createdAt: "2026-08-02T08:00:00.000Z",
    id,
    mainFileId: `file-${id}`,
    mainImageUrl: `/api/fabrics/${id}/image`,
    scope: "user",
    tags,
    updatedAt: "2026-08-02T08:00:00.000Z",
  };
}

function imageFile(): File {
  return new File(["image"], "fabric.png", { type: "image/png" });
}

describe("filterFabricsByTag", () => {
  it("按标签进行不区分大小写的包含匹配", () => {
    const fabrics = [
      fabric("1", ["轻薄", "Summer"]),
      fabric("2", ["厚重", "Winter"]),
    ];

    expect(filterFabricsByTag(fabrics, "sum")).toEqual([fabrics[0]]);
    expect(filterFabricsByTag(fabrics, "轻")).toEqual([fabrics[0]]);
  });
});

describe("canManageFabric", () => {
  it("只向用户自己的面料显示管理与删除入口", () => {
    const userFabric = fabric("user-fabric", ["轻薄"]);
    const presetFabric: Fabric = {
      ...userFabric,
      canManage: false,
      scope: "preset",
    };
    const adminPreset: Fabric = { ...presetFabric, canManage: true };

    expect(canManageFabric(userFabric)).toBe(true);
    expect(canManageFabric(presetFabric)).toBe(false);
    expect(canManageFabric(adminPreset)).toBe(true);
  });
});

describe("fabric upload", () => {
  it("只提交图片和去重后的标签", () => {
    const formData = buildFabricUploadFormData({
      file: imageFile(),
      tags: [" 轻薄 ", "垂坠", "轻薄"],
    });

    expect(formData.get("mainImage")).toBeInstanceOf(File);
    expect(formData.get("tags")).toBe('["轻薄","垂坠"]');
    expect([...formData.keys()].sort()).toEqual(["mainImage", "tags"]);
  });

  it("要求图片和至少一个标签", () => {
    expect(validateFabricUpload({ file: null, tags: ["轻薄"] })).toContain(
      "图片",
    );
    expect(validateFabricUpload({ file: imageFile(), tags: [] })).toContain(
      "标签",
    );
  });
});
