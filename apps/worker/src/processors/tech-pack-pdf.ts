import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  studioPublishIssues,
  studioTechPackSchema,
  type StudioTechPack,
} from "@fashion/shared";

export interface TechPackPdfImage {
  id: string;
  body: Buffer;
}

const MARGIN = 42;
const CONTENT_BOTTOM = 775;
const LINE_GAP = 4;

export async function renderTechPackPdf(
  input: {
    payload: unknown;
    revision: number;
    styleCode: string;
    styleName: string;
    images: TechPackPdfImage[];
  },
  font: (document: PDFKit.PDFDocument, text: string) => string,
): Promise<Buffer> {
  const pack = studioTechPackSchema.parse(input.payload);
  if (pack.status === "PUBLISHED" && studioPublishIssues(pack).length) {
    throw new Error("已发布技术包缺少完整的人工复核记录，请检查绑定修订");
  }
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: "A4",
    margin: MARGIN,
    info: {
      Title: pack.name,
      Subject: "Technical package revision " + input.revision,
    },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  try {
    const bodyFont = font(
      document,
      JSON.stringify(input.payload) +
        input.styleName +
        input.styleCode +
        "技术包草稿已发布人工复核材料用量供应商测量尺寸公差未知工艺标注配色绑定款式修订资料来源正面背面细节视图尚未填写图片不能确认真实尺寸续页",
    );
    let cursor = 0;
    let section = pack.name;
    let continuation = 0;
    const width = () => document.page.width - MARGIN * 2;
    const setBody = () =>
      document.font(bodyFont).fontSize(10).fillColor("#353b36");
    const page = (title: string, continued = false) => {
      if (!continued) {
        section = title;
        continuation = 0;
      } else continuation++;
      document.addPage();
      document
        .font(bodyFont)
        .fillColor("#687168")
        .fontSize(9)
        .text(input.styleCode + " / REV " + input.revision, MARGIN, 32, {
          width: width(),
          height: 14,
          lineBreak: false,
          ellipsis: true,
        });
      document
        .fillColor("#242824")
        .fontSize(22)
        .text(
          title + (continued ? " / 续页 " + continuation : ""),
          MARGIN,
          61,
          { width: width(), lineGap: 2 },
        );
      cursor = Math.max(document.y + 20, 112);
    };
    const nextPage = () => page(section, true);
    const ensureSpace = (height: number) => {
      if (cursor + height > CONTENT_BOTTOM) nextPage();
    };
    const measure = (text: string, textWidth = width()) => {
      setBody();
      return document.heightOfString(text, {
        width: textWidth,
        lineGap: LINE_GAP,
      });
    };
    // Split oversized paragraphs explicitly so PDFKit cannot insert an unlabelled page.
    const line = (text: string) => {
      let remaining = Array.from(text || " ");
      while (remaining.length) {
        ensureSpace(measure("国"));
        const available = CONTENT_BOTTOM - cursor;
        let length = remaining.length;
        if (measure(remaining.join("")) > available) {
          let low = 1,
            high = remaining.length;
          length = 0;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if (measure(remaining.slice(0, middle).join("")) <= available) {
              length = middle;
              low = middle + 1;
            } else high = middle - 1;
          }
          if (!length) {
            nextPage();
            continue;
          }
          // Prefer a natural boundary while preserving every non-whitespace character.
          const candidate = remaining.slice(0, length).join("");
          const boundary = Math.max(
            candidate.lastIndexOf("\n"),
            candidate.lastIndexOf(" "),
          );
          if (boundary > candidate.length * 0.65)
            length = Array.from(candidate.slice(0, boundary + 1)).length;
        }
        const part = remaining.slice(0, length).join("");
        setBody().text(part, MARGIN, cursor, {
          width: width(),
          lineGap: LINE_GAP,
        });
        cursor = document.y;
        remaining = remaining.slice(length);
        if (remaining.length) nextPage();
      }
      cursor += 7;
    };
    const rowHeading = (text: string) => {
      ensureSpace(measure(text) + measure("国") + 14);
      line(text);
    };
    page(pack.name);
    line(input.styleCode + " · " + input.styleName);
    line(
      pack.status === "PUBLISHED"
        ? "已发布 · 已记录人工复核"
        : "草稿 · 待确认资料不得作为生产定稿",
    );
    line("绑定款式修订：" + pack.styleRevisionId);
    line("技术包修订：" + input.revision);
    line(
      "已复核视图 " +
        pack.views.filter((view) => view.reviewed).length +
        " / " +
        pack.views.length,
    );
    line("工艺说明：" + (pack.constructionNotes || "未知 / 待填写"));
    for (const view of pack.views) {
      const image = input.images.find(
        (candidate) => candidate.id === view.assetId,
      );
      if (!image) throw new Error("技术包视图图片缺失：" + view.assetId);
      page(
        ({ front: "正面视图", back: "背面视图", detail: "细节视图" } as const)[
          view.kind
        ],
      );
      line(
        (view.label || "视图") +
          " · " +
          (view.reviewed ? "已复核" : "待人工复核"),
      );
      const data = await sharp(image.body, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: 1400,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      const fit = Math.min(width() / data.info.width, 500 / data.info.height);
      ensureSpace(data.info.height * fit + 18);
      const w = data.info.width * fit,
        h = data.info.height * fit;
      const x = MARGIN + (width() - w) / 2,
        y = cursor;
      document.image(data.data, x, y, { width: w, height: h });
      const notes = pack.annotations.filter(
        (note) => note.assetId === view.assetId,
      );
      for (const [index, note] of notes.entries()) {
        const cx = x + note.x * w,
          cy = y + note.y * h;
        document.circle(cx, cy, 8).fill("#294d3c");
        document
          .font(bodyFont)
          .fillColor("#ffffff")
          .fontSize(7)
          .text(String(index + 1), cx - 8, cy - 4, {
            width: 16,
            height: 10,
            align: "center",
            lineBreak: false,
          });
      }
      cursor = y + h + 18;
      for (const [index, note] of notes.entries())
        line(
          String(index + 1) +
            ". " +
            note.text +
            (note.reviewed ? "" : " [待复核]"),
        );
    }
    page("材料与辅料 / BOM");
    if (!pack.bom.length) line("尚未填写材料与用量。");
    for (const [index, row] of pack.bom.entries()) {
      rowHeading(
        String(index + 1) +
          ". " +
          row.name +
          " · " +
          (row.reviewed ? "已复核" : "待复核"),
      );
      line("材料：" + (row.material || "未知"));
      line("用量：" + (row.quantity ?? "未知") + " " + row.unit);
      line("供应商：" + (row.supplier || "未知"));
      line("资料来源：" + sourceName(row.source));
      cursor += 7;
    }
    page("测量规格 / POM");
    if (!pack.pom.length) line("尚未填写尺寸。图片不能确认真实尺寸。");
    for (const [index, row] of pack.pom.entries()) {
      rowHeading(String(index + 1) + ". " + row.name);
      line(
        "尺寸：" +
          (row.value ?? "未知") +
          " " +
          row.unit +
          "；公差：±" +
          (row.tolerance ?? "未知") +
          " " +
          row.unit,
      );
      line(
        (row.reviewed ? "已复核" : "待复核") + " · " + sourceName(row.source),
      );
      cursor += 7;
    }
    page("配色与工艺说明");
    if (!pack.colors.length) line("配色待填写。");
    for (const color of pack.colors) {
      const label =
        color.name +
        " " +
        color.hex +
        " · " +
        (color.reviewed ? "已复核" : "待复核");
      const rowHeight = Math.max(24, measure(label, width() - 36));
      ensureSpace(rowHeight + 16);
      document.rect(MARGIN, cursor, 24, 24).fill(color.hex);
      setBody().text(label, MARGIN + 36, cursor + 3, {
        width: width() - 36,
        lineGap: LINE_GAP,
      });
      cursor += rowHeight + 16;
    }
    line(pack.constructionNotes || "工艺说明待填写。");
    const range = document.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      document.switchToPage(i);
      document
        .font(bodyFont)
        .fontSize(8)
        .fillColor("#6b726c")
        .text(
          (pack.status === "DRAFT" ? "草稿 · " : "") +
            input.styleCode +
            " / " +
            (i + 1) +
            " / " +
            range.count,
          MARGIN,
          804,
          { width: width(), height: 12, lineBreak: false, align: "right" },
        );
    }
    document.end();
  } catch (error) {
    document.end();
    await complete.catch(() => undefined);
    throw error;
  }
  return complete;
}

function sourceName(value: StudioTechPack["bom"][number]["source"]) {
  return (
    {
      manual: "人工填写",
      supplier: "供应商资料",
      measured: "实测",
      ai: "AI建议，待确认",
    } as const
  )[value];
}
