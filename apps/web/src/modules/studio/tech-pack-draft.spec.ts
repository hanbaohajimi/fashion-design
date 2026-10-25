import { describe, expect, it, vi } from "vitest";
import type { StudioTechPack } from "@fashion/shared";
import { techPackFixture } from "./studio-test-fixtures";
import {
  createTechPackDraft,
  createTechPackRowId,
  serializeTechPackDraft,
  validateTechPack,
} from "./tech-pack-draft";

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("缺少测试行");
  return row;
}
function draft() {
  return createTechPackDraft(
    techPackFixture({
      bom: [
        {
          name: "主料",
          material: "棉",
          quantity: 1,
          unit: "米",
          supplier: "",
          source: "manual",
          reviewed: true,
        },
      ],
      pom: [
        {
          name: "胸围",
          value: 12,
          tolerance: 0,
          unit: "cm",
          source: "measured",
          reviewed: true,
        },
      ],
    }).currentRevision.payload as StudioTechPack,
  );
}
describe("技术包字符串草稿", () => {
  it("HTTP 预览缺少安全上下文 API 时仍可建立唯一稳定行身份", () => {
    vi.stubGlobal("crypto", {});
    try {
      const input = draft();
      const ids = [...input.bom, ...input.pom].map((row) => row.uiId);
      ids.push(createTechPackRowId(), createTechPackRowId());
      expect(new Set(ids).size).toBe(ids.length);
      expect(first(input.bom).uiId).toBe(ids[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("允许细小正数和零公差，剥离 UI id，空白是未知", () => {
    const input = draft();
    first(input.bom).quantity = "0.0001";
    first(input.pom).value = " ";
    const payload = serializeTechPackDraft(input);
    expect(first(payload.bom).quantity).toBe(0.0001);
    expect(payload.pom[0]).toMatchObject({ value: null, tolerance: 0 });
    expect(JSON.stringify(payload)).not.toContain("uiId");
    expect(() => validateTechPack(payload)).not.toThrow();
  });
  it.each([
    "-",
    ".",
    "1e",
    "Infinity",
    "1e999",
    "NaN",
    "0x10",
    "-1",
    "0",
    "1,2",
  ])("拒绝无效用量 %s 而不提交旧数值", (value) => {
    const input = draft();
    first(input.bom).quantity = value;
    expect(() => serializeTechPackDraft(input)).toThrow("BOM 1 用量");
  });
  it("保留编辑中尾随小数点，提交时转换为数字", () => {
    const input = draft();
    first(input.bom).quantity = "1.";
    expect(first(serializeTechPackDraft(input).bom).quantity).toBe(1);
    expect(first(input.bom).quantity).toBe("1.");
  });
});
