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
const render = (payload: unknown, images: { id: string; body: Buffer }[] = [], selectFont: (document: PDFKit.PDFDocument) => string = font) => renderPresentationPdf({ payload, revision: 2, styleCode: "FW-001", styleName: "结构风衣", images }, selectFont);
afterEach(() => vi.restoreAllMocks());

describe("product presentation PDF", () => {
  it.each([
    { name: "system fixture font", selectFont: font },
    { name: "built-in fallback font", selectFont: () => "Helvetica" },
  ])("exports reviewed images and paginates long notes without shrinking the image ($name)", async ({ selectFont }) => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const image = vi.spyOn(PDFDocument.prototype, "image");
    const body = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#dfd3bd" } }).png().toBuffer();
    const payload = fixture(); payload.status = "READY";
    // Explicit paragraphs exercise overflow even when the fallback font lacks CJK glyphs.
    payload.notes = "展示信息需要完整保留，商品物性应由供应商或实测确认。\n".repeat(60).trim();
    const first = payload.items[0]; if (!first) throw new Error("missing fixture item");
    first.label = "正面外观信息需要逐张人工核对。\n".repeat(100).trim();
    const result = await render(payload, [{ id: "front", body }], selectFont);
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
    for (const [index, call] of calls.entries()) {
      if ([29, 54, 562].includes(call[2])) continue;
      const document = text.mock.contexts[index] as PDFKit.PDFDocument;
      document.fontSize(10);
      const height = document.heightOfString(call[0], { width: call[3].width, lineGap: 4 });
      expect(call[2] + height).toBeLessThanOrEqual(520);
    }
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
