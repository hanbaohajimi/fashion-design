import PDFDocument from "pdfkit";
import sharp from "sharp";
import { studioPresentationSchema } from "@fashion/shared";
import type { TechPackPdfImage } from "./tech-pack-pdf";

const MARGIN = 42;
const BOTTOM = 520;
const DISCLAIMER = "展示图用于视觉说明。AI 生成或编辑的图像不能确认真实版型、合体度、面料性能或商品成分，交付前应逐张核对商品外观。";

export async function renderPresentationPdf(input: {
  payload: unknown;
  revision: number;
  styleCode: string;
  styleName: string;
  images: TechPackPdfImage[];
}, font: (document: PDFKit.PDFDocument, text: string) => string): Promise<Buffer> {
  const set = studioPresentationSchema.parse(input.payload);
  const document = new PDFDocument({ autoFirstPage: false, bufferPages: true, size: "A4", layout: "landscape", margin: MARGIN,
    info: { Title: set.name, Subject: "Product presentation revision " + input.revision } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  try {
    const bodyFont = font(document, JSON.stringify(set) + input.styleCode + input.styleName + DISCLAIMER + "商品展示包草稿人工复核交付准备已完成未知正面背面细节场景电商社交系列续页绑定款式修订版本");
    let cursor = 0, section = set.name;
    const width = () => document.page.width - MARGIN * 2;
    const body = () => document.font(bodyFont).fontSize(10).fillColor("#353b36");
    const page = (title: string, continued = false) => {
      if (!continued) section = title;
      document.addPage();
      document.font(bodyFont).fillColor("#687168").fontSize(9).text(input.styleCode + " / REV " + input.revision, MARGIN, 29,
        { width: width(), height: 14, lineBreak: false, ellipsis: true });
      document.fillColor("#242824").fontSize(21).text(title + (continued ? " / 续页" : ""), MARGIN, 54, { width: width() });
      cursor = Math.max(104, document.y + 16);
    };
    const ensure = (height: number) => { if (cursor + height > BOTTOM) page(section, true); };
    const line = (text: string) => {
      let remaining = Array.from(text || " ");
      while (remaining.length) {
        body(); ensure(document.heightOfString("国", { width: width(), lineGap: 4 }));
        const measure = (length: number) => { body(); return document.heightOfString(remaining.slice(0, length).join(""), { width: width(), lineGap: 4 }); };
        let count = remaining.length;
        if (measure(count) > BOTTOM - cursor) {
          let low = 1, high = count; count = 0;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (measure(mid) <= BOTTOM - cursor) { count = mid; low = mid + 1; } else high = mid - 1;
          }
        }
        if (!count) { page(section, true); continue; }
        body().text(remaining.slice(0, count).join(""), MARGIN, cursor, { width: width(), lineGap: 4 });
        cursor = document.y; remaining = remaining.slice(count);
        if (remaining.length) page(section, true);
      }
      cursor += 8;
    };
    page(set.name);
    line(input.styleCode + " · " + input.styleName);
    line("商品展示包 / " + ({ marketplace: "电商", social: "社交", lookbook: "系列" } as const)[set.channel]);
    line(set.status === "READY" ? "交付准备已完成 · 所有图片已人工复核" : "草稿 · 图片仍需人工复核");
    line("绑定款式修订：" + set.styleRevisionId + "；展示包版本：" + input.revision);
    line(DISCLAIMER);
    if (set.notes) line(set.notes);
    const labels = { front: "正面", back: "背面", detail: "细节", scene: "场景" } as const;
    for (const [index, item] of set.items.entries()) {
      const image = input.images.find(candidate => candidate.id === item.assetId);
      if (!image) throw new Error("商品展示图片缺失：" + item.assetId);
      page(String(index + 1) + " / " + labels[item.kind] + " · " + (item.reviewed ? "已人工复核" : "待人工复核"));
      if (item.label) line(item.label);
      const prepared = await sharp(image.body, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
      const fit = Math.min(width() / prepared.info.width, 380 / prepared.info.height);
      const w = prepared.info.width * fit, h = prepared.info.height * fit;
      ensure(h);
      document.image(prepared.data, MARGIN + (width() - w) / 2, cursor, { width: w, height: h });
    }
    const range = document.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      document.switchToPage(i);
      document.font(bodyFont).fontSize(8).fillColor("#687168").text((set.status === "DRAFT" ? "草稿 · " : "") + input.styleCode + " / " + (i + 1) + " / " + range.count,
        MARGIN, 562, { width: width(), height: 12, lineBreak: false, align: "right" });
    }
    document.end();
  } catch (error) {
    document.end(); await complete.catch(() => undefined); throw error;
  }
  return complete;
}
