import PDFDocument from "pdfkit";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { studioTechPackSchema } from "@fashion/shared";

import { renderTechPackPdf } from "./tech-pack-pdf";

const fontPath = [
  "C:/Windows/Fonts/simhei.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].find(existsSync);
const font = (document: PDFKit.PDFDocument) => {
  if (!fontPath) return "Helvetica";
  document.registerFont("FixtureFont", fontPath);
  return "FixtureFont";
};
const fixture = () =>
  studioTechPackSchema.parse({
    name: "Technical package",
    styleRevisionId: "revision-1",
  });
const render = (
  payload: unknown,
  images: { id: string; body: Buffer }[] = [],
) =>
  renderTechPackPdf(
    {
      payload,
      revision: 3,
      styleCode: "FW-001",
      styleName: "Coat",
      images,
    },
    font,
  );

afterEach(() => vi.restoreAllMocks());

describe("technical package PDF", () => {
  it("paginates oversized fields and long color labels without losing content or creating unlabelled pages", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const material = "已实测的面料成分和织造工艺记录。".repeat(110);
    const supplier =
      "Verified supplier contact and delivery reference. ".repeat(30);
    const payload = fixture();
    payload.constructionNotes =
      "Construction notes with finish details. ".repeat(45);
    payload.bom = [
      {
        name: "Outer shell",
        material,
        supplier,
        quantity: 1.4,
        unit: "m",
        reviewed: true,
        source: "supplier",
      },
    ];
    payload.colors = Array.from({ length: 30 }, (_, index) => ({
      name: "Color " + index + " detailed supplier color name ".repeat(3),
      hex: "#24533c",
      reviewed: true,
    }));
    const result = await render(payload);
    const calls = text.mock.calls as unknown as [
      string,
      number,
      number,
      PDFKit.Mixins.TextOptions,
    ][];
    const pageCount = result
      .toString("latin1")
      .match(/\/Type\s*\/Page\b/gu)?.length;
    const headers = calls.filter((call) => call[2] === 32);
    const footers = calls.filter((call) => call[2] === 804);
    expect(pageCount).toBeGreaterThan(4);
    expect(headers).toHaveLength(pageCount ?? 0);
    expect(footers).toHaveLength(pageCount ?? 0);
    const bodyText = calls
      .filter((call) => ![32, 61, 804].includes(call[2]))
      .map((call) => call[0])
      .join("");
    expect(bodyText).toContain(material.trim());
    expect(bodyText).toContain(supplier.trim());
    expect(calls.some((call) => call[0].includes("Color 29"))).toBe(true);
    for (const [index, call] of calls.entries()) {
      if (call[2] === 32 || call[2] === 61 || call[2] === 804) continue;
      const document = text.mock.contexts[index] as PDFKit.PDFDocument;
      document.font(fontPath ? "FixtureFont" : "Helvetica").fontSize(10);
      const height = document.heightOfString(call[0], {
        width: call[3].width,
        lineGap: 4,
      });
      expect(call[1]).toBeGreaterThanOrEqual(42);
      expect(call[2] + height).toBeLessThanOrEqual(778);
    }
  });

  it("keeps notes aligned with the body after drawing positional image markers", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const image = vi.spyOn(PDFDocument.prototype, "image");
    const body = await sharp({
      create: { width: 300, height: 400, channels: 3, background: "#e1d2b7" },
    })
      .png()
      .toBuffer();
    const payload = fixture();
    payload.views = [
      {
        assetId: "front",
        kind: "front",
        label: "正面结构说明与人工复核依据。".repeat(100),
        reviewed: true,
      },
    ];
    payload.annotations = [
      {
        assetId: "front",
        x: 1,
        y: 1,
        text: "Confirm the bottom seam allowance",
        reviewed: false,
      },
    ];
    const result = await render(payload, [{ id: "front", body }]);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    const calls = text.mock.calls as unknown as [
      string,
      number,
      number,
      PDFKit.Mixins.TextOptions,
    ][];
    const note = calls.find((call) =>
      call[0].includes("Confirm the bottom seam allowance"),
    );
    expect(note?.[1]).toBe(42);
    expect(note?.[0]).toContain("[待复核]");
    expect(calls.filter((call) => call[0] === "1")).toHaveLength(1);
    const drawnImage = (
      image.mock.calls as unknown as [
        Buffer,
        number,
        number,
        { width: number; height: number },
      ][]
    )[0];
    expect(drawnImage).toBeDefined();
    if (!drawnImage) throw new Error("Expected a rendered garment view");
    expect(drawnImage[3].height).toBe(500);
    expect(drawnImage[2] + drawnImage[3].height).toBeLessThanOrEqual(775);
  });

  it("fails instead of exporting an incomplete package when a required view is missing", async () => {
    const payload = fixture();
    payload.views = [
      { assetId: "missing", kind: "front", label: "", reviewed: false },
    ];
    await expect(render(payload)).rejects.toThrow("技术包视图图片缺失");
  });
  it("never labels an unreviewed package as production approved", async () => {
    const payload = fixture();
    payload.status = "PUBLISHED";
    await expect(render(payload)).rejects.toThrow(
      "已发布技术包缺少完整的人工复核记录",
    );
  });
});
