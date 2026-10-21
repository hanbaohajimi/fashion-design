import PDFDocument from "pdfkit";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { studioPresentationSchema } from "@fashion/shared";
import { renderPresentationPdf } from "./presentation-pdf";

const fontPath = ["C:/Windows/Fonts/simhei.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(existsSync);
const font = (document: PDFKit.PDFDocument) => {
  if (!fontPath) return "Helvetica";
  document.registerFont("FixtureFont", fontPath);
  return "FixtureFont";
};
const fixture = () => studioPresentationSchema.parse({ name: "商品展示包", styleRevisionId: "style-revision", items: [{ assetId: "front", kind: "front", label: "正面展示", reviewed: true }] });
const render = (payload: unknown, images: { id: string; body: Buffer }[] = []) => renderPresentationPdf({ payload, revision: 2, styleCode: "FW-001", styleName: "结构风衣", images }, font);
afterEach(() => vi.restoreAllMocks());

describe("product presentation PDF", () => {
  it("exports reviewed images with visual limitations and paginates long notes without shrinking the image", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const image = vi.spyOn(PDFDocument.prototype, "image");
    const body = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#dfd3bd" } }).png().toBuffer();
    const payload = fixture(); payload.status = "READY";
    payload.notes = "展示信息需要完整保留，商品物性应由供应商或实测确认。".repeat(70);
    const first = payload.items[0]; if (!first) throw new Error("missing fixture item");
    first.label = "正面外观信息需要逐张人工核对。".repeat(100);
    const result = await render(payload, [{ id: "front", body }]);
    const calls = text.mock.calls as unknown as [string, number, number, PDFKit.Mixins.TextOptions][];
    const pageCount = result.toString("latin1").match(/\/Type\s*\/Page\b/gu)?.length;
    expect(pageCount).toBeGreaterThan(3);
    expect(calls.filter(call => call[2] === 29)).toHaveLength(pageCount ?? 0);
    expect(calls.filter(call => call[2] === 562)).toHaveLength(pageCount ?? 0);
    expect(calls.some(call => call[0].includes("不能确认真实版型"))).toBe(true);
    expect(calls.some(call => call[0].includes("所有图片已人工复核"))).toBe(true);
    const bodyText = calls.filter(call => ![29, 54, 562].includes(call[2])).map(call => call[0]).join("");
    expect(bodyText).toContain(payload.notes);
    expect(bodyText).toContain(first.label);
    const drawn = (image.mock.calls as unknown as [Buffer, number, number, { height: number }][])[0];
    if (!drawn) throw new Error("image was not rendered");
    expect(drawn[3].height).toBe(380);
    expect(drawn[2] + drawn[3].height).toBeLessThanOrEqual(520);
  });

  it("rejects ready presentation data with an unreviewed image", async () => {
    await expect(render({ ...fixture(), status: "READY", items: [{ assetId: "front", kind: "front", reviewed: false }] })).rejects.toThrow("逐张人工核对");
  });

  it("fails rather than silently skipping a missing presentation image", async () => {
    await expect(render(fixture())).rejects.toThrow("商品展示图片缺失");
  });
});
