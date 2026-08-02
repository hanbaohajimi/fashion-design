import { describe, expect, it } from "vitest";

import {
  decodeFabricDragPayload,
  fabricToShapeProps,
} from "./fabric-drag";

const payload = {
  fabricCategory: "silk",
  fabricId: "fabric-1",
  fabricName: "真丝缎",
  thumbnailUrl: "/api/fabrics/fabric-1/image",
};

describe("fabric drag payload", () => {
  it("解析有效载荷并自动生成 fabric_ref 角色", () => {
    expect(decodeFabricDragPayload(JSON.stringify(payload))).toEqual(payload);
    expect(fabricToShapeProps(payload)).toMatchObject({
      fabricId: "fabric-1",
      role: "fabric_ref",
    });
  });

  it("拒绝残缺或非 JSON 载荷", () => {
    expect(decodeFabricDragPayload("not-json")).toBeNull();
    expect(
      decodeFabricDragPayload(JSON.stringify({ fabricId: "fabric-1" })),
    ).toBeNull();
  });
});
