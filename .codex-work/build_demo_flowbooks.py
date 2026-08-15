from __future__ import annotations

import os
from dataclasses import dataclass, fields, is_dataclass, replace
from pathlib import Path
from typing import Iterable, Sequence

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = Path(os.environ.get("FLOWBOOK_OUTPUT_DIR", ROOT / "doc"))
OUTPUT_SUFFIX = os.environ.get("FLOWBOOK_OUTPUT_SUFFIX", "")

INK = "18212B"
NAVY = "0B2545"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
MUTED = "5D6875"
PALE_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
CALLOUT = "F4F6F9"
GOLD = "B07A24"
ORANGE = "E85D36"
WHITE = "FFFFFF"
RED = "9B1C1C"
GREEN = "1F5D42"

PAGE_WIDTH_DXA = 12240
CONTENT_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120
CELL_MARGINS = {"top": 80, "bottom": 80, "start": 120, "end": 120}


@dataclass(frozen=True)
class Scene:
    timecode: str
    title: str
    purpose: str
    actions: tuple[str, ...]
    voiceover: str
    proof: tuple[str, ...]
    direction: str
    fallback: str | None = None


@dataclass(frozen=True)
class Flowbook:
    number: str
    title: str
    subtitle: str
    duration: str
    role: str
    core_proof: str
    hook: str
    execution_summary: tuple[tuple[str, str], ...]
    project_name: str
    assets: tuple[str, ...]
    fixed: tuple[str, ...]
    variables: tuple[str, ...]
    reject: tuple[str, ...]
    scenes: tuple[Scene, ...]
    prompts: tuple[tuple[str, str, str], ...]
    coverage: tuple[tuple[str, str, str], ...]
    closing: str


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)
    shd.set(qn("w:val"), "clear")


def set_cell_margins(cell, margins=CELL_MARGINS) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.find(qn("w:tcMar"))
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for name, value in margins.items():
        node = tc_mar.find(qn(f"w:{name}"))
        if node is None:
            node = OxmlElement(f"w:{name}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_width(cell, width_dxa: int) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width_dxa))
    tc_w.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths: Sequence[int], indent: int = TABLE_INDENT_DXA) -> None:
    if sum(widths) != CONTENT_WIDTH_DXA:
        raise ValueError(f"table widths must total {CONTENT_WIDTH_DXA}: {widths}")
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(CONTENT_WIDTH_DXA))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        for index, cell in enumerate(row.cells):
            set_cell_width(cell, widths[index])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def set_run_font(run, *, size=None, color=INK, bold=None, italic=None, east_asia="Microsoft YaHei") -> None:
    run.font.name = "Calibri"
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:ascii"), "Calibri")
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:hAnsi"), "Calibri")
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), east_asia)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = rgb(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def set_para_spacing(paragraph, *, before=0, after=6, line=1.25, keep_next=False) -> None:
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    fmt.keep_with_next = keep_next


def configure_styles(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(11)
    normal.font.color.rgb = rgb(INK)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    for style_name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 18, 10),
        ("Heading 2", 13, BLUE, 14, 7),
        ("Heading 3", 12, DARK_BLUE, 10, 5),
    ):
        style = styles[style_name]
        style.font.name = "Calibri"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = rgb(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.line_spacing = 1.0
        style.paragraph_format.keep_with_next = True


def add_numbering_definition(doc: Document, *, bullet: bool) -> int:
    numbering = doc.part.numbering_part.element
    abstract_ids = [int(node.get(qn("w:abstractNumId"))) for node in numbering.findall(qn("w:abstractNum"))]
    num_ids = [int(node.get(qn("w:numId"))) for node in numbering.findall(qn("w:num"))]
    abstract_id = max(abstract_ids, default=0) + 1
    num_id = max(num_ids, default=0) + 1

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    lvl = OxmlElement("w:lvl")
    lvl.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    lvl.append(start)
    num_fmt = OxmlElement("w:numFmt")
    num_fmt.set(qn("w:val"), "bullet" if bullet else "decimal")
    lvl.append(num_fmt)
    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), "•" if bullet else "%1.")
    lvl.append(lvl_text)
    suff = OxmlElement("w:suff")
    suff.set(qn("w:val"), "tab")
    lvl.append(suff)
    p_pr = OxmlElement("w:pPr")
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "num")
    tab.set(qn("w:pos"), "540")
    tabs.append(tab)
    p_pr.append(tabs)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "540")
    ind.set(qn("w:hanging"), "270")
    p_pr.append(ind)
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:after"), "80")
    spacing.set(qn("w:line"), "300")
    spacing.set(qn("w:lineRule"), "auto")
    p_pr.append(spacing)
    lvl.append(p_pr)
    r_pr = OxmlElement("w:rPr")
    fonts = OxmlElement("w:rFonts")
    fonts.set(qn("w:ascii"), "Calibri")
    fonts.set(qn("w:hAnsi"), "Calibri")
    fonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    r_pr.append(fonts)
    lvl.append(r_pr)
    abstract.append(lvl)
    first_num_index = next(
        (index for index, child in enumerate(numbering) if child.tag == qn("w:num")),
        len(numbering),
    )
    numbering.insert(first_num_index, abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    cleanup_index = next(
        (
            index
            for index, child in enumerate(numbering)
            if child.tag == qn("w:numIdMacAtCleanup")
        ),
        len(numbering),
    )
    numbering.insert(cleanup_index, num)
    return num_id


def add_list_item(doc: Document, text: str, num_id: int, *, bold_prefix: str | None = None) -> None:
    p = doc.add_paragraph()
    num_pr = p._p.get_or_add_pPr().get_or_add_numPr()
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num = OxmlElement("w:numId")
    num.set(qn("w:val"), str(num_id))
    num_pr.append(ilvl)
    num_pr.append(num)
    set_para_spacing(p, after=4, line=1.25)
    if bold_prefix and text.startswith(bold_prefix):
        head = p.add_run(bold_prefix)
        set_run_font(head, bold=True)
        tail = p.add_run(text[len(bold_prefix):])
        set_run_font(tail)
    else:
        run = p.add_run(text)
        set_run_font(run)


def add_label_paragraph(doc: Document, label: str, text: str, *, color=INK, after=5) -> None:
    p = doc.add_paragraph()
    set_para_spacing(p, after=after)
    label_run = p.add_run(f"{label}：")
    set_run_font(label_run, bold=True, color=DARK_BLUE)
    body = p.add_run(text)
    set_run_font(body, color=color)


def add_heading(doc: Document, text: str, level: int) -> None:
    p = doc.add_paragraph(text, style=f"Heading {level}")
    for run in p.runs:
        set_run_font(run, size={1: 16, 2: 13, 3: 12}[level], color={1: BLUE, 2: BLUE, 3: DARK_BLUE}[level], bold=True)


def add_callout(doc: Document, label: str, text: str, *, fill=CALLOUT, accent=BLUE) -> None:
    table = doc.add_table(rows=1, cols=1)
    set_table_geometry(table, [CONTENT_WIDTH_DXA])
    set_repeat_table_header(table.rows[0])
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    p = cell.paragraphs[0]
    set_para_spacing(p, before=2, after=2, line=1.2)
    head = p.add_run(f"{label}  ")
    set_run_font(head, size=10.5, color=accent, bold=True)
    body = p.add_run(text)
    set_run_font(body, size=10.5, color=INK)
    after = doc.add_paragraph()
    set_para_spacing(after, after=2, line=1.0)


def add_page_field(paragraph) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])
    set_run_font(run, size=8.5, color=MUTED)


def configure_section(doc: Document, flow: Flowbook) -> None:
    doc.settings.odd_and_even_pages_header_footer = True
    section = doc.sections[0]
    section.different_first_page_header_footer = False
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.right_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_para_spacing(hp, after=0, line=1.0)
    hr = hp.add_run(f"AI FASHION DESIGN / RUN OF SHOW     VIDEO {flow.number}")
    set_run_font(hr, size=8.5, color=MUTED, bold=True)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_para_spacing(fp, after=0, line=1.0)
    rr = fp.add_run("内部拍摄执行稿  ·  ")
    set_run_font(rr, size=8.5, color=MUTED)
    add_page_field(fp)

    even_header = section.even_page_header
    ehp = even_header.paragraphs[0]
    ehp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_para_spacing(ehp, after=0, line=1.0)
    ehr = ehp.add_run(f"AI FASHION DESIGN / RUN OF SHOW     VIDEO {flow.number}")
    set_run_font(ehr, size=8.5, color=MUTED, bold=True)

    even_footer = section.even_page_footer
    efp = even_footer.paragraphs[0]
    efp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_para_spacing(efp, after=0, line=1.0)
    efrr = efp.add_run("内部拍摄执行稿  ·  ")
    set_run_font(efrr, size=8.5, color=MUTED)
    add_page_field(efp)


def add_metric_strip(doc: Document, items: Sequence[tuple[str, str]]) -> None:
    table = doc.add_table(rows=1, cols=len(items))
    widths = [CONTENT_WIDTH_DXA // len(items)] * len(items)
    widths[-1] += CONTENT_WIDTH_DXA - sum(widths)
    set_table_geometry(table, widths)
    set_repeat_table_header(table.rows[0])
    for index, (label, value) in enumerate(items):
        cell = table.cell(0, index)
        set_cell_shading(cell, "FFF8E8" if index == 0 else LIGHT_GRAY)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        set_para_spacing(p, before=2, after=1, line=1.0)
        r = p.add_run(label.upper())
        set_run_font(r, size=8, color=GOLD, bold=True)
        p2 = cell.add_paragraph()
        set_para_spacing(p2, before=0, after=2, line=1.05)
        r2 = p2.add_run(value)
        set_run_font(r2, size=10.5, color=NAVY, bold=True)
    spacer = doc.add_paragraph()
    set_para_spacing(spacer, after=3, line=1.0)


def add_opening(doc: Document, flow: Flowbook) -> None:
    kicker = doc.add_paragraph()
    set_para_spacing(kicker, before=6, after=2, line=1.0)
    kr = kicker.add_run(f"DEMO FILM {flow.number} / 拍摄流程书")
    set_run_font(kr, size=10, color=ORANGE, bold=True)

    title = doc.add_paragraph()
    set_para_spacing(title, before=0, after=5, line=1.0, keep_next=True)
    tr = title.add_run(flow.title)
    set_run_font(tr, size=27, color=NAVY, bold=True)

    subtitle = doc.add_paragraph()
    set_para_spacing(subtitle, after=16, line=1.2)
    sr = subtitle.add_run(flow.subtitle)
    set_run_font(sr, size=13.2, color=MUTED)

    add_metric_strip(doc, (
        ("建议成片", flow.duration),
        ("扮演身份", flow.role),
        ("核心证明", flow.core_proof),
        ("版本", "v1.0 · 2026-08-11"),
    ))
    add_callout(doc, "开场钩子", flow.hook, fill="FFF6EE", accent=ORANGE)


def add_timeline_table(doc: Document, scenes: Sequence[Scene]) -> None:
    table = doc.add_table(rows=1, cols=4)
    widths = [1100, 1950, 3010, 3300]
    set_table_geometry(table, widths)
    headers = ("时间", "场景", "关键操作", "画面证明")
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        set_cell_shading(cell, PALE_BLUE)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i == 0 else WD_ALIGN_PARAGRAPH.LEFT
        set_para_spacing(p, before=2, after=2, line=1.0)
        r = p.add_run(header)
        set_run_font(r, size=9, color=NAVY, bold=True)
    set_repeat_table_header(table.rows[0])
    for scene in scenes:
        cells = table.add_row().cells
        values = (scene.timecode, scene.title, scene.actions[0], scene.proof[0])
        for i, value in enumerate(values):
            p = cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i == 0 else WD_ALIGN_PARAGRAPH.LEFT
            set_para_spacing(p, before=1, after=1, line=1.05)
            r = p.add_run(value)
            set_run_font(r, size=8.8, color=INK, bold=(i == 1))


def add_execution_summary(doc: Document, items: Sequence[tuple[str, str]]) -> None:
    table = doc.add_table(rows=1, cols=2)
    widths = [1900, 7460]
    set_table_geometry(table, widths)
    for i, header in enumerate(("执行项", "本片确定方案")):
        cell = table.rows[0].cells[i]
        set_cell_shading(cell, PALE_BLUE)
        p = cell.paragraphs[0]
        set_para_spacing(p, before=2, after=2, line=1.0)
        r = p.add_run(header)
        set_run_font(r, size=9.2, color=NAVY, bold=True)
    set_repeat_table_header(table.rows[0])
    for label, value in items:
        cells = table.add_row().cells
        set_cell_shading(cells[0], "F7F8FA")
        for i, text in enumerate((label, value)):
            p = cells[i].paragraphs[0]
            set_para_spacing(p, before=1, after=1, line=1.12)
            r = p.add_run(text)
            set_run_font(r, size=9.3, color=NAVY if i == 0 else INK, bold=(i == 0))


def add_scene(doc: Document, scene: Scene, bullet_id: int, number_id: int, index: int) -> None:
    add_heading(doc, f"{index:02d}  {scene.timecode}  {scene.title}", 2)
    add_label_paragraph(doc, "本段目的", scene.purpose)
    for action in scene.actions:
        add_list_item(doc, action, number_id)
    add_callout(doc, "建议口播", scene.voiceover, fill="F4F7FB", accent=BLUE)
    add_label_paragraph(doc, "必须拍到", "；".join(scene.proof))
    add_label_paragraph(doc, "导演提示", scene.direction, color=MUTED)
    if scene.fallback:
        add_callout(doc, "失败兜底", scene.fallback, fill="FFF4F2", accent=RED)


def add_prompt_table(doc: Document, prompts: Sequence[tuple[str, str, str]]) -> None:
    for label, use, prompt in prompts:
        add_heading(doc, label, 2)
        add_label_paragraph(doc, "使用时机", use)
        table = doc.add_table(rows=1, cols=1)
        set_table_geometry(table, [CONTENT_WIDTH_DXA])
        set_repeat_table_header(table.rows[0])
        cell = table.cell(0, 0)
        set_cell_shading(cell, "F8F9FB")
        p = cell.paragraphs[0]
        set_para_spacing(p, before=2, after=2, line=1.22)
        r = p.add_run(prompt)
        set_run_font(r, size=9.8, color=INK)
        spacer = doc.add_paragraph()
        set_para_spacing(spacer, after=2, line=1.0)


def add_coverage_table(doc: Document, coverage: Sequence[tuple[str, str, str]]) -> None:
    table = doc.add_table(rows=1, cols=3)
    widths = [2500, 3300, 3560]
    set_table_geometry(table, widths)
    for i, header in enumerate(("工具/能力", "本片中的动作", "证明的产品价值")):
        cell = table.rows[0].cells[i]
        set_cell_shading(cell, PALE_BLUE)
        p = cell.paragraphs[0]
        set_para_spacing(p, before=2, after=2, line=1.0)
        r = p.add_run(header)
        set_run_font(r, size=9.2, color=NAVY, bold=True)
    set_repeat_table_header(table.rows[0])
    for tool, action, value in coverage:
        cells = table.add_row().cells
        for i, text in enumerate((tool, action, value)):
            p = cells[i].paragraphs[0]
            set_para_spacing(p, before=1, after=1, line=1.08)
            r = p.add_run(text)
            set_run_font(r, size=9.0, color=INK, bold=(i == 0))


def build_doc(flow: Flowbook) -> Path:
    doc = Document()
    configure_styles(doc)
    configure_section(doc, flow)
    bullet_id = add_numbering_definition(doc, bullet=True)
    number_id = add_numbering_definition(doc, bullet=False)
    add_opening(doc, flow)

    add_heading(doc, "0. 具体设计执行单", 1)
    add_execution_summary(doc, flow.execution_summary)

    add_heading(doc, "1. 成片目标与叙事纪律", 1)
    add_callout(
        doc,
        "导演结论",
        "这不是一次“提示词抽奖”。镜头必须让观众看到：输入被结构化、约束被确认、候选被专业淘汰、修改有版本血缘、系列扩展有稳定 DNA，最终决定仍由设计师做出。",
        fill="EEF6F2",
        accent=GREEN,
    )
    for item in (
        "先判断、后生成：至少保留一次“先不要出图”的分析对话。",
        "每次选择都说出理由：采纳、丢弃、局部改、强制保留都要对应可观察的服装标准。",
        "等待可见但不夸大速度：显示任务状态；剪辑跳时必须加“生成处理中”转场。",
        "相似度只是诊断，不把分数包装成审美评分；最终由设计师裁决。",
    ):
        add_list_item(doc, item, bullet_id)

    add_heading(doc, "2. 拍摄前准备", 1)
    add_label_paragraph(doc, "项目名", flow.project_name)
    add_label_paragraph(doc, "显示环境", "1920×1080 桌面端；浏览器缩放 100%；关闭系统通知；保留鼠标高亮；画布右侧设计助手展开。")
    add_label_paragraph(doc, "账户状态", "确认登录、生成额度充足、API/Worker/对象存储健康；预先测试一次图片上传、生成、局部重绘与导出。")
    add_label_paragraph(doc, "录制策略", "连续录制操作和口播；生成等待段单独录制。准备同一输入的已完成候选作为断线备份，但切换时明确标注“预生成备份结果”。")
    add_heading(doc, "素材清单", 2)
    for asset in flow.assets:
        add_list_item(doc, asset, bullet_id)

    add_heading(doc, "3. 本片专业设计约束卡", 1)
    add_heading(doc, "必须保持（锁定项）", 2)
    for item in flow.fixed:
        add_list_item(doc, item, bullet_id)
    add_heading(doc, "允许探索（变化项）", 2)
    for item in flow.variables:
        add_list_item(doc, item, bullet_id)
    add_heading(doc, "一票淘汰（拒绝项）", 2)
    for item in flow.reject:
        add_list_item(doc, item, bullet_id)

    add_heading(doc, "4. 时间轴总览", 1)
    add_timeline_table(doc, flow.scenes)

    doc.add_page_break()
    add_heading(doc, "5. 分镜与操作流程", 1)
    for index, scene in enumerate(flow.scenes, 1):
        add_scene(doc, scene, bullet_id, number_id, index)

    add_heading(doc, "6. 可直接复制的设计师指令", 1)
    add_prompt_table(doc, flow.prompts)

    add_heading(doc, "7. 工具覆盖与产品优点", 1)
    add_coverage_table(doc, flow.coverage)

    add_heading(doc, "8. 拍摄验收清单", 1)
    for item in (
        "内容：固定项、变化项、拒绝项至少各被口播一次；不得只说“好看/不好看”。",
        "操作：关键按钮点击前停顿 0.5 秒；点击后保留状态反馈；不把鼠标挡在结果主体上。",
        "画面：输入素材与最终结果至少出现一次同屏；局部重绘保留掩码画面；版本页保留操作类型。",
        "真实性：若使用跳剪、预生成结果或失败兜底，必须用字幕说明；不声称 AI 自动替代打版、工艺单或真人试衣。",
        "收尾：用一句设计判断总结本轮取舍，并明确下一轮仍可从源资产、版本或 DNA 继续。",
    ):
        add_list_item(doc, item, bullet_id)

    add_heading(doc, "9. 通用失败兜底", 1)
    for item in (
        "上传/缩略图未完成：停在“正在保存/正在处理”状态，解释私有对象存储与缩略图链路；恢复后继续，不重复上传。",
        "实时连接中断：保留任务托盘“轮询同步”提示，等待状态回补；不要刷新正在运行的任务。",
        "生成超时或内容审核失败：展示明确状态，使用“重试”或切换到已标注的预生成备份；不要掩盖失败。",
        "导出暂未完成：展示后台队列状态和临时下载时效；用已生成的同项目导出文件完成收尾。",
    ):
        add_list_item(doc, item, bullet_id)

    add_callout(doc, "结尾口播", flow.closing, fill="FFF6EE", accent=ORANGE)

    path = OUTPUT_DIR / f"演示视频{flow.number}_{flow.title}_拍摄流程书{OUTPUT_SUFFIX}.docx"
    doc.core_properties.title = f"演示视频{flow.number}：{flow.title}拍摄流程书"
    doc.core_properties.subject = flow.subtitle
    doc.core_properties.author = "AI 服装设计平台演示团队"
    doc.core_properties.keywords = "服装设计, 演示视频, 拍摄流程, 设计迭代"
    doc.core_properties.comments = "版式：compact_reference_guide；首屏：workshop_agenda；命名覆盖：WorkshopTitle 27pt、TimelineMatrix 8.8pt。"
    doc.save(path)
    return path


def s(timecode, title, purpose, actions, voiceover, proof, direction, fallback=None) -> Scene:
    return Scene(timecode, title, purpose, tuple(actions), voiceover, tuple(proof), direction, fallback)


FLOWBOOKS = (
    Flowbook(
        number="01",
        title="从一张面料图片入手",
        subtitle="把真实材质变成第一设计约束，而不是把纹理贴到任意廓形上",
        duration="10–12 分钟",
        role="高级服装设计师",
        core_proof="材质驱动闭环",
        hook="先用 4 秒并排展示面料微距、冬季羊毛大衣与系列 Lookbook，再回到面料原图：‘这件大衣不是从一句风格词开始，而是从一块 520 GSM 的双面羊毛开始。’",
        execution_summary=(
            ("面料库记录", "图片：燕麦驼面料近摄图；名称：燕麦驼双面羊毛 / F-01。库内不填写、不显示、不携带任何其他面料信息。"),
            ("项目材料约束（普通白板备注）", "独立于面料库的“PROJECT MATERIAL NOTE / F-01”普通便签记录供应商/样卡确认的羊毛 90% / 羊绒 10%、520 GSM、双面平纹、门幅 150 cm、无弹、不透，以及设计判断的厚实柔软、低光泽、保暖和冬季大衣用途。"),
            ("首轮生成服装", "冬季长款双面羊毛大衣：后中长 118 cm，肩宽 44 cm，微落肩，8.5 cm 枪驳领，双排四扣，腰部暗省，斜插袋，后中开衩 38 cm，直筒长袖；燕麦驼 80%、骨白 15%、深棕 5%。"),
            ("首轮提示词", "生成 3 组可量产冬季长款双面羊毛大衣。锁定羊毛90%/羊绒10%、520 GSM、燕麦驼、厚实柔软低光泽、后中长118 cm、肩宽44 cm、微落肩、8.5 cm枪驳领、双排四扣、腰部暗省、斜插袋、后中开衩38 cm；允许扣位与袖袢小幅变化；避免浴袍感、过薄垂软、皮革化、超大翻领、门襟错位、文字和水印。"),
            ("第一次具体修改", "局部重绘领口与上门襟：掩码只覆盖驳领、领座与第一扣位；把驳头宽统一为 8.5 cm、串口线角度约 35°、左右领面对称，第一扣位位于自然腰上 4 cm；肩宽、袖型、118 cm 衣长、口袋、面料和光线全部保持。"),
            ("第二次具体修改", "选择“面料”变化轴，强度 0.30，生成 3 个变体；只比较双面呢厚度、细短绒面与下摆垂坠，不允许改变驳领、扣位、腰省和衣长。淘汰任何薄针织化、毛绒玩具化或亮面化结果。"),
            ("最终系列", "5 款冬季大衣胶囊：01 Hero 双排长大衣、02 单排茧形大衣、03 无领双面大衣、04 系带裹身大衣、05 短款双面夹克；锁定燕麦驼双面羊毛、低光泽与克制扣具，现场至少生成 02/03 两款。"),
        ),
        project_name="AW27 / 燕麦驼双面羊毛大衣系列",
        assets=(
            "主面料图：燕麦驼双面羊毛，平铺近摄，光线均匀，可见细短绒面与双面切边。",
            "备用面料图：同一面料的垂坠照，用于口播说明但不替代主输入。",
            "色板：燕麦驼 #B9A184、骨白 #E8E2D7、深棕 #3B2D25。",
            "预生成备份：同一项目、同一面料约束的 3 个候选；只在实时生成失败时使用并加字幕。",
            "导出备份：同一系列的 PDF Lookbook，保证收尾镜头可完成。",
        ),
        fixed=(
            "面料身份：羊毛 90% / 羊绒 10%，双面平纹，520 GSM，厚实柔软、低光泽；不得呈现薄针织、长毛绒、皮革或亮缎。",
            "核心款：冬季长款双排羊毛大衣；后中长 118 cm、肩宽 44 cm、8.5 cm 枪驳领、双排四扣、腰部暗省、斜插袋、后中开衩 38 cm。",
            "色彩：燕麦驼为 80% 主色，骨白和深棕仅作内搭/扣具；不得自动变灰黑或出现大面积撞色。",
            "呈现：正面 3/4 全身、真实服装比例、工作室中性光；不出现文字、水印和夸张配饰。",
        ),
        variables=(
            "扣位可在双排四扣与双排六扣之间比较；袖口可比较净袖口与 4 cm 袖袢。",
            "口袋可比较斜插袋与窄嵌线袋，但袋口必须在腰节下 6–10 cm 且左右对称。",
            "轮廓可在直身与轻茧形之间小幅变化，但不得牺牲 520 GSM 厚度、后中开衩与步行量。",
            "系列扩展可转译到单排、无领、裹身和短款大衣，但锁定双面羊毛语言与燕麦驼主色。",
        ),
        reject=(
            "面料读成薄针织、长毛绒、硬挺皮革、塑料涂层或过亮缎面。",
            "生成结果忽略 520 GSM 厚度与双面呢切边；或出现无法缝制的悬空驳领、断裂门襟。",
            "枪驳领左右不对称、双排扣位错列、后开衩消失、左右袖长不一、额外肢体、文字或水印。",
            "系列扩展相似度极高而只是换姿势，或低于参考区间且丢失核心 DNA。",
        ),
        scenes=(
            s("00:00–00:25", "结果先行：从成衣回溯面料", "在 25 秒内建立专业差异。", ("展示面料微距 → Hero 成衣 → 4 款系列网格的快速三连切。", "切回项目库，打开“AW27 / 深海斜纹通勤系列”。"), "我不会先问它能生成什么，而是先定义这块面料允许我们做什么。面料库内只有图片和名称，到此为止；成分、克重、织法、垂坠等专业约束属于项目设计备注，由我在普通白板便签中单独维护。", ("面料纹理与成衣材质同屏", "项目名称可见"), "开头不解释界面；先给结果，再用项目回溯建立因果。"),
            s("00:25–01:35", "建立只含图片与名称的面料资产", "准确展示面料库的绝对信息边界。", ("从项目库顶部进入“面料库”；用名称搜索已有面料，清楚展示每张卡片只有缩略图和名称。", "点击“＋ 添加面料”，上传主面料图；名称只填“深海蓝羊毛真丝斜纹 / F-01”。", "检查上传预览与名称无误，点击“保存到面料库”。", "在“我的”列表用完整名称搜索并打开该卡片，镜头只确认图片与名称；不展开、不填写、不口播任何其他信息。"), "这里的面料库严格只有图片和名称，不包含分类、成分、克重、织法、门幅、弹性、透明度、颜色、用途、来源、标签、备注或任何其他面料信息，也不会把这些内容自动推断或携带到白板。", ("面料库标题", "图片上传预览", "名称输入框", "保存后的缩略图与名称"), "上传预览、名称输入、保存结果各给一个近景；镜头放大 120%，保存状态停留至少 1 秒。", "若上传处理较慢，切到已经保存的同名个人面料；仍需现场拍到图片上传、名称填写和同名搜索，并加字幕“使用预先上传的同一图片资产”。"),
            s("01:35–02:25", "回流白板并建立项目材料备注", "展示图片资产与项目设计知识完全分离。", ("返回项目并打开“AW27 / 深海斜纹通勤系列”；从工具条点击“打开面料库”。", "在抽屉切到“我的”，只按名称搜索“深海蓝羊毛真丝斜纹 / F-01”。", "点击“添加到白板”或把图片卡拖到画布；确认落位内容仍然只有面料图片与名称，没有其他字段。", "关闭面料库后，使用普通便签工具新建“PROJECT MATERIAL NOTE / F-01”：供应商/样卡确认＝羊毛82%/真丝18%、185 GSM、斜纹、门幅150 cm、无弹、不透；设计判断＝中等偏流动垂坠、细腻微光、秋冬外套/西装；未知项标“待测试”。再添加色卡、工艺禁止项并固定素材。"), "面料库回流结束时仍然只有图片和名称。现在这张项目材料备注是我关闭面料库后用普通便签另建的，不属于面料库，也不会写回或自动附着到面料库素材。", ("面料抽屉的“我的”选中态", "仅名称搜索", "只含图片与名称的落位节点", "关闭面料库后新建普通项目备注"), "分成两个连续近景：先证明落位节点只有图片与名称，再关闭面料库并拍摄普通便签创建；不得让观众误以为备注是面料库字段。"),
            s("02:25–03:20", "人工确认语义角色", "证明参考图不会被无差别混用。", ("点击面料图片左上角标签，打开“标签设计”。", "确认角色为“面料参考”；不在面料节点中补写任何物性备注。", "确认色卡为“色彩方案”、项目材料备注与工艺便签为“备注”。", "若 VLM 给出低置信度提示，演示人工修正并保存。"), "真正的设计控制来自角色与普通项目备注分工。面料节点仍只有图片和名称；项目材料备注负责有来源的设计约束，色卡负责比例，工艺便签负责边界。", ("标签设计面板", "面料参考/色彩方案/备注", "PROJECT MATERIAL NOTE / F-01"), "标签切换前后各停 0.5 秒；镜头不得出现向面料节点写入其他信息的动作。"),
            s("03:20–04:15", "先分析，不急于出图", "让 Agent 先把材质转译成可执行设计方向。", ("框选面料、色卡和便签，确认“已附加内容”出现 3 项。", "在设计助手输入分析指令，明确“先不要生成”。", "要求返回三条方向，并逐条说明面料适配、结构风险和淘汰条件。"), "在出图之前，我要先看它是否理解：这块面料适合什么体量、哪些结构会破坏垂坠、哪些工艺风险必须被排除。", ("附件芯片", "分析回复", "没有立即创建生成任务"), "Agent 回复较长时缓慢滚动，只保留结构风险、面料适配和建议方向。"),
            s("04:15–05:45", "生成三组候选并专业筛选", "把生成变成受约束的方案比较。", ("继续同一会话，提交完整生成指令。", "在任务托盘显示等待/创作状态；完成后展开全部候选。", "逐张检查立领、门襟、面料微光、肩线和衣长。", "采纳最符合面料物性的候选；对一张面料过亮的候选点击“丢弃”，明确淘汰理由。"), "我不是选最戏剧化的一张。我先排除把羊毛真丝误读成亮缎的方案，再检查立领能否成立、门襟是否连续、肩线是否能被真实打版。", ("任务状态", "全部候选", "采纳与丢弃状态"), "每张候选停留 2–3 秒；用鼠标沿立领和门襟移动，形成审图轨迹。", "若实时任务超时，打开“历史 → 生成”中的同输入备份候选，字幕标注“同项目预生成结果”。"),
            s("05:45–07:00", "局部重绘：修领口，不破坏面料", "展示精准、非整体推翻的修改。", ("打开候选详情，进入“局部重绘”。", "把画笔尺寸调小，只涂领口与上门襟；检查覆盖率。", "输入“领高收至 5 cm，领角更干净；保持面料、色彩、肩线、光线和其他区域不变”。", "提交并对比原图与局部结果。"), "这不是重做一件衣服。我只修正立领和上门襟，其他已经通过的面料、比例和光线必须保留。", ("白色掩码", "覆盖率", "修改说明", "局部结果"), "掩码一定要小且边界清楚；若第一次覆盖不足 5%，保留系统提示并再补一笔。"),
            s("07:00–08:05", "受控变体：只沿面料轴探索", "证明变化不是随机重抽。", ("在候选操作中选择“再来一版”或打开变体控制。", "选择“面料”变化轴，强度设为 0.30–0.40。", "点击“生成 3 个变体”，比较垂坠、微光和克重表达。", "明确锁定结构，不接受轮廓被意外改写。"), "现在只开放面料表达这一个变化轴。结构已经通过，不应该因为探索触感就把立领、门襟和衣长一起改变。", ("变化轴：面料", "变化强度", "3 个可追踪变体"), "后期用三分屏比较同一结构下的面料表达。"),
            s("08:05–08:55", "版本与血缘：恢复不覆盖", "证明可长期迭代而非一次性覆盖。", ("进入候选详情“版本”。", "展示初次生成、局部重绘、设计变体的时间线。", "选择早一版点击“恢复此版”，说明恢复会创建新版本。", "回到当前版本，确认历史仍可追溯。"), "我可以回到任何一个设计判断，但不会抹掉已经发生的探索。恢复是新版本，不是覆盖，这让团队复盘和继续开发都有依据。", ("资产版本时间线", "操作类型", "恢复后的新版本"), "在“恢复会创建新版本，当前记录不会被覆盖”这行停 1 秒。"),
            s("08:55–10:25", "从 Hero 到系列：锁定材质 DNA", "证明单款可扩展为可管理系列。", ("把通过的候选“设为 Hero → 建系列”。", "打开“DNA 定义”，核对色板、廓形、面料、情绪词和标志性构造细节。", "手工修正并锁定色板、面料、暗门襟；保留廓形可变。", "在“Look 扩展”中新增裙装/裤装/轻外套，设置系列开发目标并生成 1–2 款。", "打开“一致性”，解释 0.50–0.95 为参考区间；最后“导出 PDF”。"), "Hero 不是终点，它是系列原点。我锁定面料、主色和暗门襟，让裙装、裤装和外套共享同一语言；廓形仍然开放，避免系列只是复制粘贴。相似度只是提醒，最终是否保留仍由设计判断决定。", ("Hero 原点", "DNA 锁定按钮", "系列槽位", "相似度矩阵", "系列 Lookbook 导出"), "这一段是全片高潮。DNA 锁定、扩展 Look 和一致性矩阵各给一个清晰近景。", "若系列实时生成未完成，展示已就绪的同项目系列备份并明确字幕；仍需现场演示 DNA 编辑与锁定。"),
            s("10:25–10:50", "收束：面料资产仍可继续", "把产品优势落在长期迭代。", ("缩放画布，让面料图片、项目材料备注、Hero、变体、系列同屏。", "打开设计助手历史，指向本次对话与生成记录。", "停在面料原图、普通项目备注与最终系列之间。"), "面料库中的图片与名称可以复用，但项目材料备注、版本和系列 DNA 都留在项目上下文中，绝不会变成面料库里的附加信息。", ("完整设计链", "对话/生成历史", "面料图片与项目备注彼此独立"), "最后 2 秒无鼠标移动，给片尾字幕留干净画面。"),
        ),
        prompts=(
            ("A. 材质分析指令", "第一次与设计助手沟通；必须先分析后生成。", "先不要生成图片。请以高级服装设计师身份读取我选中的面料、色卡和备注：1）概括可确认的成分、克重、织法、垂坠、光泽；2）提出三条适合 AW27 城市通勤的核心款方向；3）每条说明为什么适合这块面料、潜在结构/工艺风险和一票淘汰条件。不要把未知属性当成事实。"),
            ("B. 首轮生成指令", "分析确认后创建候选。", "生成三组短款雕塑感通勤夹克方案。锁定：羊毛82%/真丝18%、185 GSM斜纹、深海蓝主色、细腻微光、中等偏流动垂坠、落肩但肩线可读、4–7 cm立领、暗门襟、干净前片。允许变化：衣长、口袋、袖口。正面3/4全身，中性工作室光。避免皮革、牛仔、亮缎、涂层塑料、塌领、门襟断裂、不可能缝制结构、文字和水印。"),
            ("C. 局部重绘指令", "只修改领口与上门襟。", "仅修改掩码区域：将立领收至约5 cm，领角更克制，上门襟连续且可缝制。严格保持原有羊毛真丝斜纹的微光与垂坠、深海蓝、肩线、袖型、衣长、人物、姿态、构图和光线；不得改动掩码外区域。"),
        ),
        coverage=(
            ("面料库（仅图片＋名称）", "上传图片、填写名称、按名称搜索、从“我的”回流；无任何其他信息", "私有视觉面料资产可复用，信息边界绝对清晰"),
            ("普通白板项目材料备注", "关闭面料库后另建，记录来源、设计约束与待测试项", "项目知识可追溯，但不写入或附着于面料库"),
            ("选择/抓手/画框", "组织素材与调整画布", "设计工作台而非聊天窗口"),
            ("便签/色卡/固定素材", "补充文字、色彩与装裱", "多模态上下文与工作室感"),
            ("标签设计 + VLM", "自动识别后人工确认角色", "可控语义，不盲目混图"),
            ("设计助手/附件", "先分析再生成", "决策链可讨论、可复盘"),
            ("候选工作台", "展开、采纳、丢弃", "专业筛选而非单图中奖"),
            ("局部重绘", "掩码、画笔、覆盖率", "局部改而不推翻已通过部分"),
            ("变体轴/强度", "面料轴生成 3 个变体", "可控探索与可追踪 seed"),
            ("版本时间线", "恢复旧版并保留历史", "非破坏性长期迭代"),
            ("系列 DNA/Look/一致性", "锁定、扩展、诊断", "从单款到系列的稳定设计语言"),
            ("导出", "单图/系列 PDF", "可交付的最终成果"),
        ),
        closing="真正可用的 AI 服装设计，不是把一张面料图变成一张漂亮图，而是让这块面料在每一轮判断、修改和系列扩展中都不丢失。",
    ),
    Flowbook(
        number="02",
        title="从一张草绘图入手",
        subtitle="把设计师线稿变成可编辑的廓形源资产，并沿版本持续发展",
        duration="10–11 分钟",
        role="女装设计师",
        core_proof="草图到版本血缘",
        hook="先叠化显示原始轮廓草图、第一版成衣和局部修正版：‘我需要 AI 尊重的是肩宽、非对称分割和长度关系，不是照着线条做一张插画。’",
        execution_summary=(
            ("面料库记录", "图片：石灰白面料近摄图；名称：石灰白轻量棉锦 / F-02。库内不填写、不显示、不携带任何其他面料信息。"),
            ("项目材料约束（普通白板备注）", "独立于面料库的“PROJECT MATERIAL NOTE / F-02”普通便签记录供应商确认的棉 68% / 尼龙 32%、135 GSM、平纹、门幅 148 cm、微弹、不透，以及设计判断的微挺、哑光和春夏轻外套/连衣裙用途。"),
            ("草图目标服装", "膝下非对称模块风衣裙：肩宽 42 cm 视觉比例，A 形下摆，左前片短至膝上 6 cm、右前片至小腿中部，斜向前中开合，腰节位于自然腰下 2 cm，直筒长袖。"),
            ("首轮提示词", "以“模块风衣裙 / V1”草图为廓形第一约束生成 3 组可实现女装；严格保持肩宽、A形下摆、左短右长、膝下长度、直筒袖、斜向开合和腰节；使用 135 GSM 微挺哑光棉锦，石灰白主色、炭黑辅色、信号橙≤5%；避免腰带、大贴袋、夸张垫肩和结构断裂。"),
            ("第一次具体修改", "局部重绘领口与斜门襟交界：掩码覆盖颈窝至胸线约 12×18 cm；改为 3.5 cm 窄翻领，门襟在右胸处连续闭合；肩宽、腰节、左右下摆和面料保持不动。"),
            ("第二次具体修改", "选择“细节”轴，强度 0.25，生成 3 个变体，只比较低立领/窄翻领与平口/窄袢袖口；若下摆或腰节变化，立即丢弃。"),
            ("源草图 V2", "返回可编辑草图，把右侧模块片上边缘整体抬高 4 cm，其他线不动；草图显示“有新改动”后重新“完成并引用”，再沿 V2 生成一组结构候选。"),
            ("最终交付", "V1 草图、V2 草图、初次生成、领口局部修正版和 V2 成衣并排；导出最终 V2 的原图高清 JPG/PNG。"),
        ),
        project_name="SS27 / 非对称模块风衣裙",
        assets=(
            "草图目标：正面女装风衣裙，左短右长的非对称前片，明确肩线、腰节与模块分割。",
            "色板：石灰白 #D7D1C7、炭黑 #202225、信号橙 #E85D36（≤5% 点缀）。",
            "面料库素材：图片为石灰白面料近摄图，名称为“石灰白轻量棉锦 / F-02”；库内没有其他任何信息。",
            "普通白板项目材料备注：PROJECT MATERIAL NOTE / F-02；独立记录供应商确认的棉 68% / 尼龙 32%、135 GSM、平纹、门幅 148 cm、微弹、不透，以及设计判断的微挺、中性哑光；不属于面料库。",
            "预生成备份：同一完成草图引用下的 3 个候选，以及一次局部重绘结果。",
            "单图导出备份：最终 Hero 的高清 JPG/PNG。",
        ),
        fixed=(
            "草图轮廓：肩宽、A 形下摆、左短右长的前片关系、膝下长度和直筒长袖。",
            "结构线：斜向前中开合、腰节位置、右侧模块片和背部活动量；不得被装饰线取代。",
            "比例：肩—腰—下摆关系遵循草图，人物姿态不得扭曲轮廓判断。",
            "呈现：正面微 3/4、手臂离开身体、全身可见；中性背景便于对照草图。",
        ),
        variables=(
            "领型可比较小翻领、低立领；袖口可比较平口、窄袢带。",
            "面料可在微挺棉锦与轻量防水科技布之间做受控比较。",
            "信号橙只允许出现在拉链头、打枣或内层窄条，不超过视觉面积 5%。",
            "第二轮允许把右侧模块片抬高 3–5 cm，但必须回写并完成新的草图引用。",
        ),
        reject=(
            "肩宽、腰节、斜向开合或左右长度关系偏离草图。",
            "把结构线画成无功能装饰；出现不闭合裁片、断裂门襟或无法穿脱。",
            "为了“时尚感”添加腰带、大口袋、夸张垫肩或大面积橙色。",
            "局部重绘改动掩码外区域，或版本恢复覆盖既有历史。",
        ),
        scenes=(
            s("00:00–00:20", "草图、成衣、修正版三态叠化", "先建立“源资产持续存在”的概念。", ("4 秒草图全屏。", "叠化到第一版成衣，再切局部修正版。", "回到空白项目画布。"), "我不会让 AI 自由发挥掉这张草图最重要的比例。今天要验证的是：轮廓、结构线和版本能不能被持续保留。", ("三态同一设计", "草图结构线清晰"), "三张图构图尽量一致，方便后期做透明叠化。"),
            s("00:20–01:05", "新建并命名廓形草图", "展示草绘是专门工具而非普通涂鸦。", ("点击“新建廓形草图”。", "将草图重命名为“模块风衣裙 / V1”。", "点击“适配草图纸”，把画布居中。", "选择黑色、细笔画。"), "我先给草图命名，因为它会成为后续版本的源头。轮廓和结构必须分开画，才能让系统和团队都知道哪些线不能丢。", ("草绘工具条", "草图名称", "轮廓/结构笔型"), "进入草绘模式后完整拍一次工具条变化。"),
            s("01:05–02:25", "画轮廓与结构线", "体现真实设计师的线稿纪律。", ("用“自由轮廓笔”画肩线、袖外形、A 形下摆和左右不对称长度。", "切换“结构线”画斜向开合、腰节、模块分割。", "演示细/中笔画与黑/灰切换，让结构线比轮廓更轻。", "画错一笔后用撤销/重做；再用安全橡皮只删除当前草图笔画。"), "外轮廓定义体量，结构线定义衣服如何成立。我会故意画错一笔：安全橡皮只处理当前草图，不会伤到底层参考或其他素材。", ("轮廓/结构计数", "笔画粗细与颜色", "撤销/重做", "安全橡皮提示"), "鼠标动作放慢；每切一次工具，工具按钮状态至少保留 0.5 秒。"),
            s("02:25–03:05", "完成并引用", "把可编辑草图转换为可用于 AI 的廓形引用。", ("检查草图完整，无空白纸。", "点击“完成并引用”。", "等待渲染、上传与缩略图状态。", "确认“草图已保存为 AI 廓形参考”。"), "完成并引用不是把草图拍扁后丢掉。原始笔画仍可编辑，同时生成一份干净的 AI 廓形参考；后续修改时必须重新完成，避免脏草图误入生成。", ("渲染/上传状态", "完成提示", "草图角色为廓形参考"), "这一步不要跳剪状态；可加 2× 加速，但需保留状态顺序。", "若离线，保留系统说明“笔画已保留”，联网后点击“重试完成”，不要重画。"),
            s("03:05–04:00", "补充色彩、面料与工艺备注", "让草图成为多约束设计输入，并严格展示面料库的信息边界。", ("从工具条打开“面料库”，在抽屉切到“我的”，只按名称搜索“石灰白轻量棉锦 / F-02”。", "点击“添加到白板”或拖拽卡片；确认落位节点仍然只有面料图片与名称，没有其他任何信息。", "关闭面料库后，用普通便签工具新建“PROJECT MATERIAL NOTE / F-02”：供应商确认＝棉68%/尼龙32%、135 GSM、平纹、门幅148 cm、微弹、不透；设计判断＝微挺、哑光、春夏轻外套/连衣裙；未知项标“待测试”。另加三色色卡与工艺便签“橙色≤5%、斜向门襟必须可穿脱、禁止腰带”。", "逐一在“标签设计”确认草图=廓形参考、面料图片=面料参考、色卡=色彩方案、两张普通项目便签=备注；不向面料节点补写任何信息。"), "草图锁比例，面料库严格只有图片和名称。关闭面料库以后，我才用普通白板便签记录项目材料约束和工艺边界；这些内容不会写回或附着到面料库素材。", ("面料抽屉的“我的”选中态", "仅名称搜索", "只含图片与名称的落位节点", "关闭面料库后新建 PROJECT MATERIAL NOTE / F-02"), "先拍面料节点只有图片和名称，再拍关闭面料库与普通便签创建；不得在同一界面中把项目备注表现成面料库信息。"),
            s("04:00–04:50", "先做草图可实现性审查", "在生成前暴露结构风险。", ("选中草图、面料、色卡、便签。", "在设计助手要求“先不要生成”，列出固定比例、可变细节和潜在穿脱/缝制风险。", "若 Agent 把装饰线误判成结构，补充备注并再次确认。"), "我先要求它像版型评审一样说清楚：哪些线是轮廓，哪些是结构，哪里可能无法穿脱。不能解释清楚，就不进入生成。", ("4 个附件", "固定/可变/风险三段回复", "人工补充备注"), "只截取关键结论，避免把视频变成滚动阅读。"),
            s("04:50–06:10", "从草图生成候选", "检查模型是否尊重轮廓而非只做风格化。", ("提交生成指令并观察任务托盘。", "展开 3 个候选，把每张与草图并排。", "沿肩宽、腰节、斜向门襟、左右下摆逐项检查。", "丢弃一张腰节漂移的方案，采纳结构最清楚的一张。"), "这轮我不评价摄影氛围，只对照四个点：肩宽、腰节、斜向开合和左右长度。腰节一旦漂移，整个比例就不再是我的草图。", ("候选与草图同屏", "逐项审图轨迹", "淘汰理由"), "用画布缩放让草图和候选同时可读；不要全屏候选到看不见源图。", "若实时生成失败，打开同会话的预生成候选并标注；仍需现场完成附件选择与指令提交。"),
            s("06:10–07:25", "局部重绘修正门襟与领口", "只改结构缺陷，保留通过的轮廓。", ("打开候选详情 →“局部重绘”。", "小画笔只涂领口和斜向门襟交界。", "输入窄翻领、门襟连续、保持肩腰下摆关系。", "提交后回到预览对比。"), "这张的轮廓已经通过，只是领口与门襟交界不够干净。我只允许改掩码区域，肩、腰、下摆和面料都必须保持。", ("精确掩码", "保持项写入说明", "局部结果"), "若局部色调变化过大，保留系统警告并说明将降低强度或重做。"),
            s("07:25–08:20", "受控探索：细节轴与廓形轴分开", "展示变量隔离。", ("先选择“细节”轴、较低强度生成 3 个变体，比领型/袖口。", "再口播说明：若要改右侧模块片高度，应回到草图，而不是用高强度随机变体。", "拒绝一张改变下摆比例的细节变体。"), "细节轴只比较领型和袖口。真正涉及模块片高度的改动要回到源草图，否则很快失去设计意图。", ("变化轴：细节", "变化强度", "拒绝越界变体"), "这里不必等待第二轮生成；重点是说明变化轴边界。"),
            s("08:20–09:05", "版本时间线与恢复", "证明修改可以撤回、比较、继续。", ("进入“版本”，展示初次生成、局部重绘、设计变体。", "恢复初次生成版本。", "说明恢复后产生新版本，不覆盖局部修正版。"), "我可以回到最初方案做另一条支线，同时保留刚才的局部修正。这才是设计迭代，而不是最后一张图覆盖前面的判断。", ("版本操作类型", "恢复此版", "历史仍在"), "时间线缩略图与操作标签同屏。"),
            s("09:05–10:05", "回到源草图做 V2", "把长期迭代落到源资产。", ("在画布选中原草图，点击“编辑选中的廓形草图”。", "把右侧模块片抬高约 4 cm，演示草图变为“有新改动”。", "点击“完成并引用”，确认新引用就绪。", "新建设计助手会话或重命名为“模块风衣裙 / V2”，附加草图并要求沿 V2 继续。"), "源草图修改后，系统不会偷偷使用旧引用，也不会把未完成笔画送去生成。我重新完成并引用，V2 才成为下一轮的正式廓形依据。", ("编辑选中草图", "草图脏状态", "重新完成", "新会话标题"), "这是本片最重要的长期迭代证据，必须完整连续拍摄。", "若重新上传缩略图较慢，保留状态并切到已完成的 V2 备份，但必须展示“有新改动”到“完成并引用”的状态转变。"),
            s("10:05–10:40", "高清导出与结尾对照", "形成可交付闭环。", ("打开最终候选详情点击“导出”。", "选择原图高清或标准 JPG/PNG，展示套餐/水印说明与临时链接时效。", "最后把 V1 草图、V2 草图、成衣版本并排。"), "从草图到成衣，每一次线条修改都留下来源和版本。下一轮我可以继续改草图、局部结构或材料，而不必从头开始。", ("单图高清导出", "V1/V2/成衣同屏", "临时下载说明"), "结尾停在三态对照，不要停在下载按钮。"),
        ),
        prompts=(
            ("A. 草图审查指令", "草图完成并引用后，先分析。", "先不要生成。请读取选中的廓形草图、面料、色卡和备注，以服装设计/版型评审方式输出：1）必须保持的肩宽、腰节、前中开合、左右长度和袖型；2）可以变化的领型、袖口和材料表达；3）可能的穿脱、裁片闭合与缝制风险；4）一票淘汰条件。无法从草图确认的内容请标为未知。"),
            ("B. 草图生成指令", "可实现性审查通过后。", "以“模块风衣裙 / V1”草图为廓形第一约束生成三组可实现女装。严格保持肩宽、A形下摆、左短右长前片、膝下长度、直筒长袖、斜向前中开合与腰节。面料为135 GSM微挺哑光棉锦，石灰白主色、炭黑辅色、信号橙≤5%。允许小翻领/低立领与袖口变化。正面微3/4全身、手臂离体、中性背景。避免腰带、大贴袋、夸张垫肩、大面积橙色、结构断裂、文字和水印。"),
            ("C. V2 延续指令", "重新完成草图 V2 后继续。", "基于新完成的“模块风衣裙 / V2”廓形引用继续，不沿用旧草图中右侧模块片的高度。保持 V1 已确认的肩宽、腰节、面料、主色和斜向开合；只把右侧模块片上移约4 cm并重新平衡门襟交界。输出一组正面结构清楚的候选，避免改变其他轮廓比例。"),
        ),
        coverage=(
            ("廓形草绘工具", "新建、命名、轮廓笔、结构线", "服装专用草图语义"),
            ("笔画粗细/颜色", "区分外轮廓与结构线", "提高线稿可读性"),
            ("撤销/重做/安全橡皮", "演示纠错与底层保护", "非破坏性草绘"),
            ("适配草图纸/完成并引用", "渲染、上传、就绪", "可编辑源草图与 AI 引用分离"),
            ("面料库/色卡/普通项目备注", "面料库只按名称回流图片；关闭后另建普通便签补充项目约束", "图片名称与其他设计信息彻底分离"),
            ("标签设计", "确认廓形/面料/色彩/备注", "多通道上下文编译"),
            ("设计助手", "可实现性审查与新会话", "先推理、后生成、可持续讨论"),
            ("候选/丢弃/采纳", "按结构逐项审查", "设计师掌握筛选权"),
            ("局部重绘", "修正领口与门襟", "保留已通过轮廓"),
            ("变化轴", "细节轴低强度探索", "变量隔离"),
            ("版本时间线", "恢复不覆盖", "多支线开发"),
            ("源草图 V2", "重新编辑并完成引用", "真正长久的源资产迭代"),
            ("单图导出", "高清 JPG/PNG", "可交付成果"),
        ),
        closing="好的草图工作流不是把线稿消耗成一张成图，而是让草图始终作为可编辑的设计原点，支撑每一次结构修正和版本分支。",
    ),
    Flowbook(
        number="03",
        title="从多参考图入手",
        subtitle="让风格、廓形、面料、细节、色彩与避用参考各司其职",
        duration="12–14 分钟",
        role="系列主设计师",
        core_proof="多参考到系列系统",
        hook="快速扫过 7 张被不同颜色标签和图钉固定的参考图，再切到 6 款系列：‘多参考不是把所有图平均混在一起，而是先定义每张图负责什么、绝不能带来什么。’",
        execution_summary=(
            ("参考组合", "7 类输入：2 张风格图、1 张宽肩短外套廓形图、1 张 118 GSM 再生尼龙微距、1 张隐藏通风褶细节图、1 张可拆模块参考衣、1 张战术背心避用图；另加 1 条有原文链接的趋势摘要。"),
            ("面料库记录", "图片：矿物灰面料微距图；名称：矿物灰再生尼龙微格 / F-03。库内不填写、不显示、不携带任何其他面料信息。"),
            ("项目材料约束（普通白板备注）", "独立于面料库的“PROJECT MATERIAL NOTE / F-03”普通便签记录供应商/测试确认的再生尼龙 92% / 氨纶 8%、118 GSM、微格平纹、门幅 145 cm、轻微弹力、不透、轻量防泼水，以及设计判断的哑光表现；信号橙只作≤3% 点缀。"),
            ("Hero 服装", "宽肩短身城市防护外套：后中长 58 cm，肩线外扩约 3 cm，无帽，连续前片，隐藏双向拉链，隐形口袋，后背隐藏通风褶，窄压胶边；明确非军事化。"),
            ("首轮提示词", "生成 3 组 SS27 Urban Shelter 宽肩短外套。锁定矿物灰/骨白、118 GSM 哑光轻防水再生尼龙、连续前片、隐形口袋、隐藏通风褶、窄压胶边、信号橙≤3%；风格图只管氛围，建筑图只管比例与阴影，细节图只管构造；禁止战术背心、外挂口袋、MOLLE、军绿色、完整复制参考衣。"),
            ("第一次具体修改", "丢弃带外挂口袋的候选；对结构正确但细节弱的候选点“再来一版”，只加强后背隐藏通风褶与窄压胶边，保持宽肩、58 cm 衣长、连续前片和面料。"),
            ("DNA 锁定", "锁定：矿物灰/骨白+橙≤3%、118 GSM 哑光轻防水面料、隐藏通风褶、窄压胶边；不锁廓形和造型，允许跨品类转译。"),
            ("6 款系列", "01 Hero 短外套、02 通风褶长衬衫、03 隐形侧袋锥形裤、04 非对称裹裙、05 无袖柱形连衣裙、06 可收纳长外套；避免战术口袋。对 <0.50 实验款说明理由后强制保留，对 >0.95 近重复安排下一轮拉开。"),
        ),
        project_name="SS27 / Urban Shelter 城市庇护系列",
        assets=(
            "风格参考 A：克制城市机能摄影；风格参考 B：现代主义建筑阴影与比例。",
            "廓形参考：宽肩短外套正面图；面料参考：灰白轻量防水织物微距。",
            "细节参考：隐藏式通风褶与窄压胶边；参考衣：可拆模块外套结构照。",
            "避用参考：多口袋军装战术背心（必须标“避用”，用红色图钉）。",
            "趋势来源：一条公开来源趋势摘要，含原文入口、关键词与色卡；存入本项目白板。",
            "系列备份：同一 Hero 的 6 款计划、2 款已完成 Look、相似度矩阵与 PDF Lookbook。",
        ),
        fixed=(
            "系列概念：Urban Shelter；城市通勤中的轻防护感，克制、非军事化。",
            "共同 DNA：矿物灰/骨白主色，信号橙≤3%；轻量防水哑光面料；隐藏通风褶；窄压胶边。",
            "Hero：宽肩短外套，前片连续、口袋隐形；不得出现战术背心式外挂系统。",
            "参考职责：风格只管氛围，廓形只管比例，面料只管材质，细节只管构造，避用只进入负向约束。",
        ),
        variables=(
            "廓形可转译到外套、上装、下装、连身款；系列应有搭配链路而不是同款换姿势。",
            "通风褶与压胶边可以在不同品类换位置，但必须保持识别度。",
            "系列 6 款中允许 1 款低相似度的实验款，由设计师说明保留理由。",
            "造型层次可变化，但不得借用避用图的军装口袋、织带和 MOLLE 语言。",
        ),
        reject=(
            "把多张参考平均融合成拼贴，或从某一风格图直接复制完整成衣。",
            "避用图中的多外挂口袋、军绿色、战术织带、MOLLE 系统进入正向结果。",
            "系列款式只是 Hero 换姿势/换长度，品类结构缺少下装或连身款。",
            "一致性 >0.95 的近重复没有被识别，或 <0.50 的偏离没有人工解释。",
        ),
        scenes=(
            s("00:00–00:25", "七类参考与六款系列快速建立", "用结果证明角色化多参考的价值。", ("扫过白板上的风格、廓形、面料、细节、参考衣、避用、趋势 7 类素材。", "切到 Hero、系列计划与 6 款网格。", "回到趋势入口开始回溯。"), "多参考不是把图片越堆越多。我先给每张图分配职责，再把冲突、禁止项和系列边界写清楚。", ("不同角色标签", "红色避用图钉", "系列网格"), "开场扫画布时用抓手平移，不要快速缩放造成眩晕。"),
            s("00:25–01:20", "趋势有来源，先核实再回流", "展示趋势不是无来源灵感。", ("从工具条打开“趋势分析”。", "浏览本周综述与目标趋势卡；点“查看原文”确认平台和发布日期。", "指出“AI整理，建议结合原文判断”。", "点击“存入白板”，选择本项目。"), "趋势摘要只帮我缩短阅读时间，设计判断必须能回到原文。存入后，摘要便签、色卡和代表图会进入白板，原文地址也会保留。", ("原文入口", "AI 整理边界", "存入位置", "导入提示"), "外部原文只停留 2 秒，重点拍平台、日期和可溯源入口。", "若原文站点临时不可用，保留趋势卡的平台、日期与链接，并口播说明稍后核实，不假装已阅读。"),
            s("01:20–02:25", "上传并组织多参考图", "建立清楚、可读的参考板，并严格展示面料库的信息边界。", ("返回项目，连续上传 6 张本地参考图：2 张风格、1 张廓形、1 张细节、1 张参考衣、1 张避用图。", "从工具条打开“面料库”，在抽屉切到“我的”，只按名称搜索“矿物灰再生尼龙微格 / F-03”，点击或拖拽加入白板，作为第 7 张参考；确认落位节点仍然只有图片与名称。", "关闭面料库；添加组织画框 STYLE、SILHOUETTE、MATERIAL、DETAIL、AVOID，用选择/抓手排列并添加文本标题。", "使用普通便签工具在 MATERIAL 区新增“PROJECT MATERIAL NOTE / F-03”：供应商/测试确认＝再生尼龙92%/氨纶8%、118 GSM、微格平纹、门幅145 cm、轻微弹力、不透、轻量防泼水；设计判断＝哑光；未知项标“待测试”。给正向参考加黄铜图钉，避用参考加红色图钉。"), "面料库回流结束时只有图片和名称，不包含任何其他信息。关闭面料库以后，我才在普通白板便签中记录项目材料约束；这张便签不属于面料库，也不会写回或自动附着到面料素材。", ("6 张本地上传状态", "面料抽屉的“我的”与仅名称搜索", "只含图片与名称的面料节点", "关闭面料库后新建 PROJECT MATERIAL NOTE / F-03", "7 张参考进入 5 个组织区"), "采用 1.5× 轻微加速，但必须原速保留两个近景：面料节点只有图片与名称；面料库关闭后普通项目备注被单独创建。"),
            s("02:25–03:45", "逐张定义角色与备注", "防止模型无差别融合参考。", ("依次打开“标签设计”。", "标风格 A/B=风格参考；正面宽肩图=廓形参考；织物微距=面料参考；通风褶=细节参考；模块外套=参考衣；战术背心=避用。", "在每张图备注其可取/不可取信息。", "对 VLM 误判或低置信度项进行人工纠正。"), "同一张图不是全能参考。建筑图给我比例和情绪，不给我服装细节；战术背心只告诉系统哪些语言必须排除。", ("全部角色选项", "逐图备注", "人工修正", "避用标签"), "后期可叠加简洁图例：Style / Silhouette / Fabric / Detail / Avoid。"),
            s("03:45–04:40", "先做参考冲突审查", "让多参考在生成前完成角色与冲突消解。", ("框选 7 类素材，确认附件不超过 16 张。", "要求设计助手“先不要生成”，输出角色矩阵、冲突、主次关系和缺失信息。", "根据回复把建筑图备注改为“只取尺度/阴影，不取硬质材料”，把避用图追加“禁止军绿色与外挂口袋”。"), "多参考最容易出错的地方不是数量，而是冲突。我先要求它说明谁负责什么、哪里互相打架，再由我改标签和备注。", ("附件芯片", "角色矩阵", "冲突结论", "备注修订"), "附件较多时拍到自动换行与缩略图预览，证明上下文可检查。"),
            s("04:40–06:10", "角色化多参考生成", "展示最多 16 张参考按角色/权重有序进入生成。", ("提交完整生成指令。", "保留任务托盘状态；完成后展开全部候选。", "说明系统按权重和类型排序参考，并将角色说明写入生成提示。", "逐张检查：是否非军事化、宽肩比例、哑光防水材质、隐藏通风褶、橙色比例。"), "这不是平均混图。风格、廓形、面料、细节和避用项各走自己的通道，系统会把最多 16 张参考按角色和权重排序。我的审图仍按五项标准逐条通过。", ("多附件生成", "任务状态", "3 个候选", "五项审图轨迹"), "不要口播内部模型名称；强调可观察的角色化行为。", "若实时生成失败，使用同一角色集合的预生成备份，并在画面标注“同一参考板备份结果”。"),
            s("06:10–07:05", "候选淘汰与再来一版", "展示设计师主动拒绝拼贴和近复制。", ("丢弃一张出现战术外挂口袋的候选。", "对一张结构正确但细节弱的候选点“再来一版”，要求加强隐藏通风褶但不改廓形。", "采纳最符合共同 DNA 的候选并放回画布。"), "这张虽然完整，但把避用图的外挂口袋带了回来，直接淘汰。另一张只缺少标志性通风褶，我会沿原结构再来一版，而不是把所有条件重新洗牌。", ("丢弃", "再来一版", "采纳后上画布"), "把淘汰理由说在点击前，让动作与判断形成因果。"),
            s("07:05–08:20", "设为 Hero 并人工校正 DNA", "把多参考共识沉淀为系列规则。", ("打开候选详情，点击“设为 Hero → 建系列”。", "进入“DNA 定义”，核对自动提取的色板、廓形、面料、情绪词。", "补充“隐藏通风褶、窄压胶边”为标志性构造细节。", "锁定色板、面料、标志性细节；保持廓形未锁。"), "自动提取只是草案。我锁定真正要跨品类保留的材料、主色和构造细节，但不锁廓形，因为系列需要从外套转译到下装和连身款。", ("Hero 原点", "DNA 草案", "人工编辑", "锁定/解锁状态"), "锁定按钮变化要拍清楚；至少保留一个未锁维度作为对比。"),
            s("08:20–10:05", "建立 6 款系列开发计划", "证明系列扩展不是重复生成。", ("切到“Look 扩展 → 系列计划”。", "系列款数设为 6；目标写入 SS27、城市通勤、轻防护、中高价格带。", "配置外套、上装、下装、连身款等槽位；演示上移、复制、删除和恢复推荐配比。", "选择待生成款，点击“生成选中”，观察按计划顺序逐款生成。"), "我先做商品结构，再做图。6 款里必须有外套、上装、下装和连身款，确保搭配链路完整；系统会提示品类占比过高或缺失。", ("系列款数", "开发目标", "品类结构分析", "槽位操作", "逐款生成状态"), "配置槽位可轻微加速；品类结构警告与“覆盖完整”状态必须原速。", "若批量生成耗时，先生成 1 款；其余使用同一计划的备份结果，字幕注明。"),
            s("10:05–11:05", "一致性诊断与人工裁决", "把数值放在设计判断之后。", ("打开“一致性”矩阵。", "解释 <0.50 偏离、0.50–0.95 系列区间、>0.95 高度相似。", "对低相似度实验款点击“忽略提示并强制保留”，口播其功能理由。", "指出一对 >0.95 近重复，决定下一轮从廓形轴重新发展。"), "相似度只告诉我哪里可能偏离或重复，不替我判断。这件实验款虽然低于区间，但它承担系列中的轻量连身层次，我会说明理由后保留；高度相似的一对则需要下一轮重新拉开。", ("相似度矩阵", "阈值图例", "强制保留状态", "近重复诊断"), "严禁把分数说成“质量分”；口播必须出现“仅用于发现重复与偏离”。"),
            s("11:05–12:00", "历史、会话命名与复盘", "展示设计讨论和生成记录可长期管理。", ("把当前会话重命名为“SS27 Urban Shelter / 多参考决策”。", "打开“历史”，切换“对话/生成”查看记录。", "指出附件、回复与候选仍可回溯；返回对话。"), "参考图、判断、生成结果和系列不是散落在不同工具里。会话和生成历史让下一轮可以从同一决策上下文继续。", ("重命名会话", "对话/生成历史", "候选记录"), "不要在片中演示归档，避免误操作；归档可作为片尾可选 B-roll。"),
            s("12:00–12:45", "系列 Lookbook 导出", "以可交付成果结束。", ("在系列抽屉点击“导出 PDF”。", "说明 PDF 包含系列名、DNA 色板和全部 Look 网格；展示 Free 水印/Pro 原图说明。", "点击开始导出，保留后台状态与下载链接有效期。", "最后回到白板，参考板、Hero 与系列同屏。"), "最终交付不只是一张图，而是带系列名、DNA 色板和全部 Look 的 Lookbook。更重要的是，白板上的每张参考仍保留角色和来源，下一轮可以继续调整。", ("导出成果窗口", "系列 PDF 说明", "后台状态", "完整白板"), "下载链接只显示，不在录屏中暴露签名参数。"),
        ),
        prompts=(
            ("A. 多参考冲突审查", "选中全部角色后，先分析。", "先不要生成。请逐项读取我附加的参考，并按“风格/廓形/面料/细节/参考衣/避用/趋势”输出角色矩阵：每项只写可取信息、不可取信息和置信度。然后列出参考之间的冲突、主次关系、缺失信息，并给出需要我人工确认的 3 个问题。建筑图只取尺度与阴影；避用图只进入负向约束。"),
            ("B. 多参考首轮生成", "冲突消解与角色备注确认后。", "生成 3 组 SS27 Urban Shelter 城市通勤宽肩短外套。风格：克制现代、轻防护、非军事化；廓形：宽肩短身、连续前片、隐形口袋；面料：矿物灰/骨白轻量防水哑光织物；细节：隐藏通风褶、窄压胶边；信号橙≤3%。风格图只用于氛围，建筑图只用于比例与阴影，细节图只用于构造。严格避免战术背心、多外挂口袋、MOLLE、军绿色、厚重盔甲感、完整复制任何参考成衣、文字和水印。"),
            ("C. 系列开发目标", "Hero DNA 校正后写入系列计划。", "SS27 城市通勤轻防护系列，目标客群 25–40 岁，通勤与轻旅行，中高价格带。6 款需形成外套/上装/下装/连身款搭配链；锁定矿物灰+骨白、信号橙≤3%、轻量防水哑光面料、隐藏通风褶、窄压胶边；开放廓形与造型。避免同款换姿势、军事化和外挂口袋。"),
        ),
        coverage=(
            ("趋势分析/原文入口", "核实来源后存入白板", "可溯源趋势输入"),
            ("上传/面料库/文本/画框", "6 张本地图 + 1 张仅含图片与名称的私有面料资产；关闭面料库后另建普通项目备注", "面料库不包含任何其他面料信息"),
            ("固定素材", "黄铜图钉与红色避用图钉", "语义化工作室呈现"),
            ("标签设计 + VLM", "逐图角色与人工纠正", "参考职责隔离"),
            ("多附件上下文", "预览并控制不超过 16 张", "多参考可检查、可排序"),
            ("设计助手", "角色矩阵与冲突审查", "生成前消解冲突"),
            ("候选操作", "采纳、丢弃、再来一版", "人类设计判断闭环"),
            ("Hero / DNA", "提取、校正、选择性锁定", "单款共识沉淀为系列语言"),
            ("系列计划", "款数、目标、槽位、品类平衡", "商品结构先于批量出图"),
            ("任务托盘", "逐款队列与失败重试", "长任务透明可控"),
            ("一致性矩阵", "偏离/重复诊断与强制保留", "数据辅助、设计师裁决"),
            ("会话/生成历史", "重命名与复盘", "长期上下文管理"),
            ("系列 PDF 导出", "Lookbook 与 DNA 色板", "可交付成果"),
        ),
        closing="多参考的价值不在于数量，而在于职责、冲突和边界都可被管理；当这些判断沉淀为系列 DNA，系统才真正支持长期服装开发。",
    ),
)


def _rewrite_text(value, replacements: tuple[tuple[str, str], ...]):
    """Apply final garment-specific editorial corrections without weakening the shared layout model."""
    if isinstance(value, str):
        for old, new in replacements:
            value = value.replace(old, new)
        return value
    if isinstance(value, tuple):
        return tuple(_rewrite_text(item, replacements) for item in value)
    if is_dataclass(value):
        return replace(
            value,
            **{field.name: _rewrite_text(getattr(value, field.name), replacements) for field in fields(value)},
        )
    return value


GARMENT_REWRITES: dict[str, tuple[tuple[str, str], ...]] = {
    "01": (
        ("标签设计面板；面料参考/色彩方案/备注；PROJECT MATERIAL NOTE / F-01", "标签设计面板；面料参考、色彩方案与避用项；面料节点始终只有图片和名称"),
        ("先用 4 秒并排展示面料微距、冬季羊毛大衣与系列 Lookbook，再回到面料原图：‘这件大衣不是从一句风格词开始，而是从一块 520 GSM 的双面羊毛开始。’", "先用 4 秒并排展示面料微距、冬季羊毛大衣与系列 Lookbook，再回到面料原图：‘这件大衣不是从一句风格词开始，而是从这张燕麦驼双面羊毛面料图开始。’"),
        ("我不会先问它能生成什么，而是先定义这块面料允许我们做什么。面料库内只有图片和名称，到此为止；成分、克重、织法、垂坠等专业约束属于项目设计备注，由我在普通白板便签中单独维护。", "我不会先问它能生成什么，而是先观察这张面料图能提供哪些可见线索。面料库内只有图片和名称；生成时只要求保持图中可见的颜色、纹理、厚实感和光泽，不宣称模型理解不可见的面料工程参数。"),
        ("这里的面料库严格只有图片和名称，不包含分类、成分、克重、织法、门幅、弹性、透明度、颜色、用途、来源、标签、备注或任何其他面料信息，也不会把这些内容自动推断或携带到白板。", "这里的面料库严格只有图片和名称，不包含任何其他面料信息，也不会自动推断或携带隐藏属性到白板。"),
        ("我不是选最戏剧化的一张。我先排除把 520 GSM 双面羊毛误读成薄针织或长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。", "我不是选最戏剧化的一张。我先排除没有保持参考图厚实低光泽视觉、或被误读成薄针织和长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。"),
        ("AW27 / 深海斜纹通勤系列", "AW27 / 燕麦驼双面羊毛大衣系列"),
        ("深海蓝羊毛真丝斜纹 / F-01", "燕麦驼双面羊毛 / F-01"),
        ("羊毛82%/真丝18%、185 GSM、斜纹、门幅150 cm、无弹、不透；设计判断＝中等偏流动垂坠、细腻微光、秋冬外套/西装", "羊毛90%/羊绒10%、520 GSM、双面平纹、门幅150 cm、无弹、不透；设计判断＝厚实柔软、低光泽、保暖、冬季大衣"),
        ("展示面料微距 → Hero 成衣 → 4 款系列网格", "展示面料微距 → 冬季羊毛大衣 Hero → 4 款大衣系列网格"),
        ("逐张检查立领、门襟、面料微光、肩线和衣长。", "逐张检查枪驳领、双排扣位、双面呢厚度、肩宽、118 cm 衣长和后中开衩。"),
        ("对一张面料过亮的候选", "对一张面料过薄且扣位错列的候选"),
        ("把羊毛真丝误读成亮缎", "把 520 GSM 双面羊毛误读成薄针织或长毛绒"),
        ("立领能否成立、门襟是否连续、肩线是否能被真实打版", "枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版"),
        ("用鼠标沿立领和门襟移动", "用鼠标沿驳领、扣位和后开衩移动"),
        ("把画笔尺寸调小，只涂领口与上门襟；检查覆盖率。", "把画笔尺寸调小，只涂枪驳领、领座与第一扣位；检查覆盖率。"),
        ("输入“领高收至 5 cm，领角更干净；保持面料、色彩、肩线、光线和其他区域不变”", "输入“驳头宽统一为 8.5 cm、串口线约 35°、左右领面对称、第一扣位位于自然腰上 4 cm；保持肩宽、袖型、118 cm 衣长、口袋、面料和光线不变”"),
        ("我只修正立领和上门襟", "我只修正驳领、领座和第一扣位"),
        ("选择“面料”变化轴，强度设为 0.30–0.40。", "选择“面料”变化轴，强度设为 0.30。"),
        ("比较垂坠、微光和克重表达", "比较双面呢厚度、细短绒面和下摆垂坠"),
        ("把立领、门襟和衣长一起改变", "把驳领、扣位、腰省和衣长一起改变"),
        ("手工修正并锁定色板、面料、暗门襟；保留廓形可变。", "手工修正并锁定燕麦驼色板、双面羊毛、克制扣具与双面切边；保留大衣廓形可变。"),
        ("在“Look 扩展”中新增裙装/裤装/轻外套", "在“Look 扩展”中新增单排、无领、裹身与短款大衣"),
        ("我锁定面料、主色和暗门襟，让裙装、裤装和外套共享同一语言", "我锁定双面羊毛、燕麦驼和克制扣具，让不同大衣廓形共享同一冬季语言"),
        ("生成三组短款雕塑感通勤夹克方案。锁定：羊毛82%/真丝18%、185 GSM斜纹、深海蓝主色、细腻微光、中等偏流动垂坠、落肩但肩线可读、4–7 cm立领、暗门襟、干净前片。允许变化：衣长、口袋、袖口。正面3/4全身，中性工作室光。避免皮革、牛仔、亮缎、涂层塑料、塌领、门襟断裂、不可能缝制结构、文字和水印。", "生成三组可量产冬季长款双面羊毛大衣。锁定：羊毛90%/羊绒10%、520 GSM双面平纹、燕麦驼、厚实柔软低光泽、后中长118 cm、肩宽44 cm、微落肩、8.5 cm枪驳领、双排四扣、腰部暗省、斜插袋、后中开衩38 cm。允许变化：四扣/六扣、净袖口/4 cm袖袢、斜插袋/窄嵌线袋。正面3/4全身，中性工作室光。避免浴袍感、薄针织、长毛绒、皮革、亮缎、超大翻领、扣位错列、开衩消失、不可能缝制结构、文字和水印。"),
        ("仅修改掩码区域：将立领收至约5 cm，领角更克制，上门襟连续且可缝制。严格保持原有羊毛真丝斜纹的微光与垂坠、深海蓝、肩线、袖型、衣长、人物、姿态、构图和光线；不得改动掩码外区域。", "仅修改掩码区域：驳头宽统一为8.5 cm，串口线约35°，左右领面对称，第一扣位位于自然腰上4 cm且双排扣成列。严格保持燕麦驼双面羊毛的520 GSM厚度与低光泽、肩宽44 cm、袖型、后中长118 cm、口袋、后开衩、人物、姿态、构图和光线；不得改动掩码外区域。"),
        ("提出三条适合 AW27 城市通勤的核心款方向", "提出三条适合AW27冬季通勤的长款大衣方向，并至少比较双排直身、轻茧形与裹身结构"),
    ),
    "02": (
        ("面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后新建 PROJECT MATERIAL NOTE / F-02", "面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后直接选中面料图片参与生成"),
        ("草图锁比例，面料库严格只有图片和名称。关闭面料库以后，我才用普通白板便签记录项目材料约束和工艺边界；这些内容不会写回或附着到面料库素材。", "草图锁比例，面料库严格只有图片和名称。关闭面料库以后，我直接选中面料图片作为视觉参考；服装尺寸、结构和避用项写进本轮设计提示词，不为面料资产补充隐藏属性。"),
        ("草图目标：正面女装风衣裙，左短右长的非对称前片，明确肩线、腰节与模块分割。", "草图目标：正面无袖方领夏季连衣裙，明确 18 cm 方领、3 cm 肩带、自然腰线、八片 A 形裙摆、左侧叠片与 112 cm 裙长。"),
        ("珊瑚粉 #E98B82（≤5% 点缀）", "珊瑚粉 #E98B82（≤3% 点缀）"),
        ("非对称模块风衣裙", "非对称叠片夏季连衣裙"),
        ("模块风衣裙", "叠片夏季裙"),
        ("石灰白轻量棉锦 / F-02", "雾薄荷棉真丝府绸 / F-02"),
        ("棉 68% / 尼龙 32%、135 GSM、平纹、门幅 148 cm、微弹、不透，以及设计判断的微挺、哑光和春夏轻外套/连衣裙用途", "棉 72% / 真丝 28%、105 GSM、细平纹、门幅 145 cm、无弹、轻微透，以及设计判断的轻薄微挺、柔和微光和盛夏连衣裙用途；衣身需轻薄棉里布"),
        ("棉 68% / 尼龙 32%、135 GSM、平纹、门幅 148 cm、微弹、不透，以及设计判断的微挺、中性哑光", "棉 72% / 真丝 28%、105 GSM、细平纹、门幅 145 cm、无弹、轻微透，以及设计判断的轻薄微挺、柔和微光；衣身需轻薄棉里布"),
        ("棉68%/尼龙32%、135 GSM、平纹、门幅148 cm、微弹、不透；设计判断＝微挺、哑光、春夏轻外套/连衣裙", "棉72%/真丝28%、105 GSM、细平纹、门幅145 cm、无弹、轻微透；设计判断＝轻薄微挺、柔和微光、盛夏连衣裙；衣身需轻薄棉里布"),
        ("膝下非对称模块风衣裙：肩宽 42 cm 视觉比例，A 形下摆，左前片短至膝上 6 cm、右前片至小腿中部，斜向前中开合，腰节位于自然腰下 2 cm，直筒长袖。", "无袖方领非对称叠片夏季连衣裙：方领宽 18 cm、前领深 11 cm、肩带宽 3 cm、自然腰线、八片 A 形裙摆、左前叠片止于裙长的 2/3、后中隐形拉链，成衣后中长 112 cm。"),
        ("以“叠片夏季裙 / V1”草图为廓形第一约束生成 3 组可实现女装；严格保持肩宽、A形下摆、左短右长、膝下长度、直筒袖、斜向开合和腰节；使用 135 GSM 微挺哑光棉锦，石灰白主色、炭黑辅色、信号橙≤5%；避免腰带、大贴袋、夸张垫肩和结构断裂。", "以“叠片夏季裙 / V1”草图为廓形第一约束生成 3 组可实现夏季连衣裙；严格保持18 cm方领、11 cm前领深、3 cm肩带、自然腰线、八片A形裙摆、左前叠片与112 cm后中长；使用105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白里布、珊瑚粉≤3%；后中隐形拉链，避免袖子、腰带、大贴袋、透明走光和结构断裂。"),
        ("局部重绘领口与斜门襟交界：掩码覆盖颈窝至胸线约 12×18 cm；改为 3.5 cm 窄翻领，门襟在右胸处连续闭合；肩宽、腰节、左右下摆和面料保持不动。", "局部重绘方领与右侧袖窿：掩码覆盖领口至腋下约 14×20 cm；把方领宽校正为18 cm、前领深11 cm、肩带统一3 cm，右袖窿抬高1.5 cm以消除走光；自然腰线、左侧叠片、112 cm裙长和面料保持不动。"),
        ("选择“细节”轴，强度 0.25，生成 3 个变体，只比较低立领/窄翻领与平口/窄袢袖口；若下摆或腰节变化，立即丢弃。", "选择“细节”轴，强度0.20，生成3个变体，只比较肩带包边、同料净缝与背部细系带；若方领、腰线、叠片或裙长变化，立即丢弃。"),
        ("把右侧模块片上边缘整体抬高 4 cm", "把左侧叠片下端延长 6 cm"),
        ("把右侧模块片抬高约 4 cm", "把左侧叠片下端延长约 6 cm"),
        ("右侧模块片的高度", "左侧叠片的长度"),
        ("只把右侧模块片上移约4 cm并重新平衡门襟交界", "只把左侧叠片下端延长约6 cm并重新平衡叠片边缘"),
        ("右侧模块片", "左侧叠片"),
        ("石灰白", "雾薄荷"),
        ("#D7D1C7", "#BFD8CF"),
        ("炭黑", "骨白"),
        ("#202225", "#F1ECE2"),
        ("信号橙", "珊瑚粉"),
        ("#E85D36", "#E98B82"),
        ("135 GSM微挺哑光棉锦", "105 GSM轻薄微挺棉真丝府绸"),
        ("135 GSM 微挺哑光棉锦", "105 GSM 轻薄微挺棉真丝府绸"),
        ("肩宽、A 形下摆、左短右长的前片关系、膝下长度和直筒长袖", "方领宽度、3 cm肩带、自然腰线、八片A形裙摆、左侧叠片和112 cm裙长"),
        ("斜向前中开合、腰节位置、左侧叠片和背部活动量", "方领、腋下省、自然腰线、左侧叠片和后中隐形拉链"),
        ("领型可比较小翻领、低立领；袖口可比较平口、窄袢带。", "肩带衔接可比较包边、同料净缝与背部细系带；裙摆缝可比较明线或无明线。"),
        ("面料可在微挺棉锦与轻量防水科技布之间做受控比较。", "面料表达只比较棉真丝府绸的轻薄微挺、柔和微光与里布透视控制。"),
        ("第二轮允许把左侧叠片抬高 3–5 cm", "第二轮允许把左侧叠片下端延长 6 cm"),
        ("肩宽、腰节、斜向开合或左右长度关系偏离草图。", "方领宽度、肩带、自然腰线、左侧叠片或112 cm裙长偏离草图。"),
        ("把结构线画成无功能装饰；出现不闭合裁片、断裂门襟或无法穿脱。", "把省道或叠片线画成无功能装饰；出现袖窿走光、后中拉链断裂或无法穿脱。"),
        ("为了“时尚感”添加腰带、大口袋、夸张垫肩或大面积珊瑚粉。", "为了“度假感”添加大荷叶边、腰带、大口袋或大面积珊瑚粉。"),
        ("肩宽、非对称分割和长度关系", "方领、自然腰线、叠片和裙长关系"),
        ("肩线、袖外形、A 形下摆和左右不对称长度", "方领、3 cm肩带、上身轮廓、八片A形裙摆和左侧叠片"),
        ("斜向开合、腰节、模块分割", "腋下省、自然腰线、叠片边界和后中拉链"),
        ("外轮廓定义体量，结构线定义衣服如何成立", "外轮廓定义夏季裙的比例，结构线定义省道、腰线、叠片和拉链如何成立"),
        ("橙色≤5%、斜向门襟必须可穿脱、禁止腰带", "珊瑚粉≤3%、袖窿不得走光、后中拉链连续、禁止大荷叶边"),
        ("肩宽、腰节、前中开合、左右长度和袖型", "方领宽度、肩带、自然腰线、叠片长度、裙长和后中拉链"),
        ("领型、袖口和材料表达", "肩带收口、裙摆明线与材料表达"),
        ("肩宽、腰节、斜向门襟、左右下摆", "方领、肩带、自然腰线、左侧叠片、裙长"),
        ("腰节漂移", "方领变形或腰线漂移"),
        ("肩宽、腰节、斜向开合和左右长度", "方领、肩带、自然腰线、叠片和裙长"),
        ("领口与斜向门襟交界", "方领与右侧袖窿"),
        ("窄翻领、门襟连续、保持肩腰下摆关系", "方领宽18 cm、前领深11 cm、肩带3 cm、右袖窿抬高1.5 cm，并保持腰线、叠片和裙长"),
        ("领型和袖口", "肩带收口和背部细系带"),
        ("叠片高度", "叠片长度"),
        ("改下摆比例", "改变方领或裙长比例"),
        ("修正领口与门襟", "修正方领与袖窿"),
        ("局部重绘修正门襟与领口", "局部重绘修正方领与袖窿"),
        ("领口和斜向门襟交界", "方领和右侧袖窿"),
        ("领口与门襟交界不够干净", "方领转角与右侧袖窿贴合不够干净"),
        ("肩、腰、下摆和面料都必须保持", "自然腰线、左侧叠片、裙长和面料都必须保持"),
        ("保持 V1 已确认的肩宽、腰节、面料、主色和斜向开合", "保持V1已确认的方领、肩带、自然腰线、面料、主色和后中拉链"),
        ("以“叠片夏季裙 / V1”草图为廓形第一约束生成三组可实现女装。严格保持肩宽、A形下摆、左短右长前片、膝下长度、直筒长袖、斜向前中开合与腰节。面料为105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白辅色、珊瑚粉≤5%。允许小翻领/低立领与袖口变化。正面微3/4全身、手臂离体、中性背景。避免腰带、大贴袋、夸张垫肩、大面积珊瑚粉、结构断裂、文字和水印。", "以“叠片夏季裙 / V1”草图为廓形第一约束生成三组可实现夏季连衣裙。严格保持方领宽18 cm、前领深11 cm、肩带宽3 cm、自然腰线、八片A形裙摆、左前叠片、后中隐形拉链与后中长112 cm。面料为105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白轻薄棉里布、珊瑚粉≤3%。允许肩带包边/同料净缝与背部细系带变化。正面微3/4全身、手臂离体、中性背景。避免袖子、大荷叶边、腰带、大贴袋、透明走光、方领变形、结构断裂、文字和水印。"),
        ("膝下非对称叠片夏季连衣裙：肩宽 42 cm 视觉比例，A 形下摆，左前片短至膝上 6 cm、右前片至小腿中部，斜向前中开合，腰节位于自然腰下 2 cm，直筒长袖。", "无袖方领非对称叠片夏季连衣裙：方领宽18 cm、前领深11 cm、肩带宽3 cm、自然腰线、八片A形裙摆、左前叠片止于裙长的2/3、后中隐形拉链，成衣后中长112 cm。"),
        ("以“叠片夏季裙 / V1”草图为廓形第一约束生成三组可实现女装。严格保持肩宽、A形下摆、左短右长前片、膝下长度、直筒长袖、斜向前中开合与腰节。面料为105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白辅色、珊瑚粉≤5%。允许小翻领/低立领与袖口变化。正面微3/4全身、手臂离体、中性背景。避免腰带、大贴袋、夸张垫肩、大面积橙色、结构断裂、文字和水印。", "以“叠片夏季裙 / V1”草图为廓形第一约束生成三组可实现夏季连衣裙。严格保持方领宽18 cm、前领深11 cm、肩带宽3 cm、自然腰线、八片A形裙摆、左前叠片、后中隐形拉链与后中长112 cm。面料为105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白轻薄棉里布、珊瑚粉≤3%。允许肩带包边/同料净缝与背部细系带变化。正面微3/4全身、手臂离体、中性背景。避免袖子、大荷叶边、腰带、大贴袋、透明走光、方领变形、结构断裂、文字和水印。"),
        ("珊瑚粉只允许出现在拉链头、打枣或内层窄条，不超过视觉面积 5%。", "珊瑚粉只允许出现在拉链头、打枣或内层窄条，不超过视觉面积3%。"),
        ("大面积橙色", "大面积珊瑚粉"),
        ("只对照四个点", "只对照五个点"),
        ("腰节一旦漂移", "自然腰线一旦漂移"),
        ("比领型/袖口", "比较肩带包边、同料净缝与背部细系带"),
        ("真正涉及模块片高度", "真正涉及左侧叠片长度"),
        ("改变下摆比例", "改变方领或裙长比例"),
        ("领口局部修正版", "方领袖窿局部修正版"),
    ),
    "03": (
        ("6 张本地上传状态；面料抽屉的“我的”与仅名称搜索；只含图片与名称的面料节点；关闭面料库后新建 PROJECT MATERIAL NOTE / F-03；7 张参考进入 5 个组织区", "6 张本地上传状态；面料抽屉的“我的”与仅名称搜索；只含图片与名称的面料节点；7 张参考进入 5 个组织区"),
        ("面料库回流结束时只有图片和名称，不包含任何其他信息。关闭面料库以后，我才在普通白板便签中记录项目材料约束；这张便签不属于面料库，也不会写回或自动附着到面料素材。", "面料库回流结束时只有图片和名称，不包含任何其他信息。关闭面料库以后，我直接把面料图片作为视觉参考参与生成，不补建或推断材料参数。"),
        ("SS27 / Urban Shelter 城市庇护系列", "SS27 / Air Veil 雪纺衫系列"),
        ("SS27 Urban Shelter", "SS27 Air Veil"),
        ("Urban Shelter", "Air Veil"),
        ("矿物灰再生尼龙微格 / F-03", "雾杏真丝雪纺 / F-03"),
        ("再生尼龙 92% / 氨纶 8%、118 GSM、微格平纹、门幅 145 cm、轻微弹力、不透、轻量防泼水，以及设计判断的哑光表现；信号橙只作≤3% 点缀", "真丝 100%、52 GSM、绉平纹、门幅 140 cm、无弹、半透明，以及设计判断的流动垂坠与柔雾光泽；衣身配同色轻薄吊带，法式缝，酒红只作≤2% 点缀"),
        ("再生尼龙92%/氨纶8%、118 GSM、微格平纹、门幅145 cm、轻微弹力、不透、轻量防泼水；设计判断＝哑光", "真丝100%、52 GSM、绉平纹、门幅140 cm、无弹、半透明；设计判断＝流动垂坠、柔雾光泽；工艺＝同色吊带、法式缝、领口包边"),
        ("2 张风格图、1 张宽肩短外套廓形图、1 张 118 GSM 再生尼龙微距、1 张隐藏通风褶细节图、1 张可拆模块参考衣、1 张战术背心避用图", "2 张风格图、1 张飘带领雪纺衫廓形图、1 张真丝雪纺微距、1 张细密褶裥细节图、1 张插肩袖参考衣、1 张过度荷叶边复古衬衫避用图"),
        ("宽肩短身城市防护外套：后中长 58 cm，肩线外扩约 3 cm，无帽，连续前片，隐藏双向拉链，隐形口袋，后背隐藏通风褶，窄压胶边；明确非军事化。", "长袖飘带领真丝雪纺衫：后中长62 cm，松量胸围成衣98 cm，2.5 cm窄飘带、前V开口16 cm，肩部六道0.4 cm细褶，微灯笼袖、5 cm双扣袖克夫，法式缝；克制通勤、不做复古戏服。"),
        ("生成 3 组 SS27 Air Veil 宽肩短外套。锁定矿物灰/骨白、118 GSM 哑光轻防水再生尼龙、连续前片、隐形口袋、隐藏通风褶、窄压胶边、信号橙≤3%；风格图只管氛围，建筑图只管比例与阴影，细节图只管构造；禁止战术背心、外挂口袋、MOLLE、军绿色、完整复制参考衣。", "生成3组SS27 Air Veil长袖飘带领真丝雪纺衫。锁定雾杏/骨白、52 GSM柔雾真丝雪纺、后中长62 cm、胸围98 cm、2.5 cm窄飘带、前V开口16 cm、肩部六道0.4 cm细褶、微灯笼袖、5 cm双扣袖克夫、法式缝、酒红≤2%；风格图只管气质，建筑图只管比例与留白，细节图只管褶裥；禁止层叠大荷叶边、夸张泡泡袖、荧光色、婚纱礼服感和完整复制参考衣。"),
        ("丢弃带外挂口袋的候选；对结构正确但细节弱的候选点“再来一版”，只加强后背隐藏通风褶与窄压胶边，保持宽肩、58 cm 衣长、连续前片和面料。", "丢弃带层叠大荷叶边的候选；对结构正确但细节弱的候选点“再来一版”，只校正2.5 cm窄飘带、肩部六道细褶与5 cm袖克夫，保持62 cm衣长、98 cm胸围、前V开口和真丝雪纺。"),
        ("锁定：矿物灰/骨白+橙≤3%、118 GSM 哑光轻防水面料、隐藏通风褶、窄压胶边；不锁廓形和造型，允许跨品类转译。", "锁定：雾杏/骨白+酒红≤2%、52 GSM柔雾真丝雪纺、2.5 cm窄飘带、肩部细褶、法式缝；不锁领型和袖型，允许在雪纺衫品类内迭代。"),
        ("01 Hero 短外套、02 通风褶长衬衫、03 隐形侧袋锥形裤、04 非对称裹裙、05 无袖柱形连衣裙、06 可收纳长外套；避免战术口袋。", "01 Hero飘带领长袖衫、02 隐门襟小立领衫、03 交叠V领衫、04 无袖褶裥衫、05 长版束腰衫、06 微灯笼袖圆领衫；全部为雪纺上装，避免层叠大荷叶边。"),
        ("克制城市机能摄影", "克制法式通勤摄影"),
        ("现代主义建筑阴影与比例", "现代建筑留白与垂直比例"),
        ("宽肩短外套正面图；面料参考：灰白轻量防水织物微距", "飘带领雪纺衫正面图；面料参考：雾杏真丝雪纺微距"),
        ("隐藏式通风褶与窄压胶边；参考衣：可拆模块外套结构照", "肩部细密褶裥与法式缝；参考衣：插肩袖雪纺衫结构照"),
        ("多口袋军装战术背心", "层叠大荷叶边复古衬衫"),
        ("城市通勤中的轻防护感，克制、非军事化", "都市通勤中的轻盈空气感，克制、非戏服化"),
        ("矿物灰/骨白主色，信号橙≤3%；轻量防水哑光面料；隐藏通风褶；窄压胶边", "雾杏/骨白主色，酒红≤2%；52 GSM柔雾真丝雪纺；窄飘带；肩部细褶；法式缝"),
        ("宽肩短外套，前片连续、口袋隐形；不得出现战术背心式外挂系统", "长袖飘带领雪纺衫，前V开口、肩部细褶、袖克夫清楚；不得出现层叠大荷叶边或夸张泡泡袖"),
        ("廓形可转译到外套、上装、下装、连身款；系列应有搭配链路而不是同款换姿势。", "廓形可转译到飘带领、小立领、交叠V领、无袖、长版和圆领雪纺衫；系列应覆盖通勤、层搭与轻场合，而不是同款换姿势。"),
        ("通风褶与压胶边可以在不同品类换位置", "细褶与飘带可以在不同领型和袖型间换位置"),
        ("军装口袋、织带和夸张泡泡袖语言", "层叠大荷叶边、过宽飘带和戏剧化泡泡袖语言"),
        ("多外挂口袋、荧光色、战术织带、夸张泡泡袖系统", "层叠大荷叶边、荧光色、过宽飘带和夸张泡泡袖"),
        ("系列款式只是 Hero 换姿势/换长度，品类结构缺少下装或连身款。", "系列款式只是Hero换姿势或换颜色，领型、袖型与穿着场景没有形成雪纺衫款式差异。"),
        ("矿物灰", "雾杏"),
        ("再生尼龙", "真丝雪纺"),
        ("118 GSM", "52 GSM"),
        ("信号橙≤3%", "酒红≤2%"),
        ("隐藏通风褶", "肩部细褶"),
        ("窄压胶边", "法式缝"),
        ("战术背心", "过度荷叶边复古衬衫"),
        ("外挂口袋", "层叠大荷叶边"),
        ("MOLLE", "夸张泡泡袖"),
        ("军绿色", "荧光色"),
        ("厚重盔甲感", "婚纱礼服感"),
        ("非军事化", "非戏服化"),
        ("轻防护", "轻盈通勤"),
        ("宽肩比例、哑光防水材质、肩部细褶、橙色比例", "飘带宽度、雪纺透明度、肩部细褶、袖克夫和酒红比例"),
        ("结构正确但细节弱的候选点“再来一版”，要求加强肩部细褶但不改廓形", "结构正确但细节弱的候选点“再来一版”，要求校正窄飘带、肩部六道细褶和袖克夫但不改衣身松量"),
        ("宽肩、58 cm 衣长、连续前片和面料", "62 cm衣长、98 cm胸围、16 cm前V开口和真丝雪纺"),
        ("锁定色板、面料、标志性细节；保持廓形未锁。", "锁定色板、52 GSM真丝雪纺、窄飘带、肩部细褶与法式缝；保持领型和袖型未锁。"),
        ("从外套转译到下装和连身款", "在雪纺衫品类内发展不同领型、袖型和穿着场景"),
        ("配置外套、上装、下装、连身款等槽位", "配置飘带领、小立领、交叠V领、无袖、长版、圆领六个雪纺衫槽位"),
        ("6 款里必须有外套、上装、下装和连身款，确保搭配链路完整", "6款必须覆盖通勤、层搭和轻场合，并在领型、袖型与衣长上形成清楚差异"),
        ("轻量连身层次", "无袖层搭与盛夏通勤场景"),
        ("城市通勤轻盈通勤系列", "都市轻盈雪纺衫系列"),
        ("6 款需形成外套/上装/下装/连身款搭配链", "6款需形成飘带领/小立领/交叠V领/无袖/长版/圆领雪纺衫矩阵"),
        ("轻量防水哑光面料", "52 GSM柔雾真丝雪纺"),
        ("军事化", "戏服化"),
        ("不同大衣廓形", "不同雪纺衫领型与袖型"),
        ("生成 3 组 SS27 Air Veil 城市通勤宽肩短外套。风格：克制现代、轻盈通勤、非戏服化；廓形：宽肩短身、连续前片、隐形口袋；面料：雾杏/骨白轻量防水哑光织物；细节：肩部细褶、法式缝；酒红≤2%。风格图只用于氛围，建筑图只用于比例与阴影，细节图只用于构造。严格避免过度荷叶边复古衬衫、多层叠大荷叶边、夸张泡泡袖、荧光色、婚纱礼服感、完整复制任何参考成衣、文字和水印。", "生成3组SS27 Air Veil长袖飘带领真丝雪纺衫。风格：克制法式通勤、轻盈、非戏服化；廓形：后中长62 cm、胸围成衣98 cm、2.5 cm窄飘带、前V开口16 cm；面料：雾杏/骨白52 GSM柔雾真丝雪纺，配同色轻薄吊带；细节：肩部六道0.4 cm细褶、微灯笼袖、5 cm双扣袖克夫、法式缝；酒红≤2%。风格图只用于气质，建筑图只用于比例与留白，细节图只用于褶裥构造。严格避免层叠大荷叶边、过宽飘带、夸张泡泡袖、荧光色、婚纱礼服感、完整复制任何参考成衣、文字和水印。"),
        ("军装口袋、织带和 夸张泡泡袖 语言", "层叠大荷叶边、过宽飘带和戏剧化泡泡袖语言"),
        ("多层叠大荷叶边、荧光色、战术织带、夸张泡泡袖 系统", "层叠大荷叶边、过宽飘带、荧光色和夸张泡泡袖"),
        ("正面宽肩图=廓形参考；织物微距=面料参考；通风褶=细节参考；模块外套=参考衣", "飘带领正面图=廓形参考；雪纺微距=面料参考；细密褶裥=细节参考；插肩袖雪纺衫=参考衣"),
        ("出现战术层叠大荷叶边", "出现层叠大荷叶边"),
        ("另一张只缺少标志性通风褶", "另一张只缺少肩部六道标志性细褶"),
        ("城市通勤、轻盈通勤、中高价格带", "都市通勤、轻盈层搭、中高价格带"),
        ("我的审图仍按五项标准逐条通过", "我的审图仍按六项标准逐条通过"),
        ("跨品类保留", "跨款式保留"),
    ),
}

FLOWBOOKS = tuple(_rewrite_text(flowbook, GARMENT_REWRITES[flowbook.number]) for flowbook in FLOWBOOKS)


# The image model can follow visible material appearance, but numeric textile
# engineering data is not reliably verifiable in generated imagery.  Keep the
# fabric library and the shooting script grounded in the actual product: one
# fabric image plus its name, followed by qualitative visual constraints only.
VISIBLE_FABRIC_REWRITES: dict[str, tuple[tuple[str, str], ...]] = {
    "01": (
        ("面料身份：羊毛 90% / 羊绒 10%，双面平纹，520 GSM，厚实柔软、低光泽；不得呈现薄针织、长毛绒、皮革或亮缎。", "面料视觉：以“燕麦驼双面羊毛 / F-01”的图片为唯一材质依据，保持图片中可见的燕麦驼色、细密表面、厚实柔软感与低光泽；不得呈现薄针织、长毛绒、皮革或亮缎。"),
        ("轮廓可在直身与轻茧形之间小幅变化，但不得牺牲 520 GSM 厚度、后中开衩与步行量。", "轮廓可在直身与轻茧形之间小幅变化，但不得牺牲参考图所示的厚实感、后中开衩与步行量。"),
        ("生成结果忽略 520 GSM 厚度与双面呢切边；或出现无法缝制的悬空驳领、断裂门襟。", "生成结果没有保持参考图所示的厚实低光泽视觉；或出现无法缝制的悬空驳领、断裂门襟。"),
        ("回流白板并建立项目材料备注", "回流白板并确认面料引用"),
        ("关闭面料库后，使用普通便签工具新建“PROJECT MATERIAL NOTE / F-01”：供应商/样卡确认＝羊毛90%/羊绒10%、520 GSM、双面平纹、门幅150 cm、无弹、不透；设计判断＝厚实柔软、低光泽、保暖、冬季大衣；未知项标“待测试”。再添加色卡、工艺禁止项并固定素材。", "关闭面料库后，将“燕麦驼双面羊毛 / F-01”面料图片与名称保留在画布；再添加色卡和工艺禁止项并固定素材。面料节点不补写任何其他信息。"),
        ("确认色卡为“色彩方案”、项目材料备注与工艺便签为“备注”。", "确认面料图片为“面料参考”、色卡为“色彩方案”、工艺禁止项为“避用”。"),
        ("必须拍到：标签设计面板；面料参考/色彩方案/备注；PROJECT MATERIAL NOTE / F-01", "必须拍到：标签设计面板；面料参考、色彩方案与避用项；面料节点始终只有图片和名称"),
        ("缩放画布，让面料图片、项目材料备注、Hero、变体、系列同屏。", "缩放画布，让面料图片、Hero、变体和系列同屏。"),
        ("开场钩子  先用 4 秒并排展示面料微距、冬季羊毛大衣与系列 Lookbook，再回到面料原图：‘这件大衣不是从一句风格词开始，而是从一块 520 GSM 的双面羊毛开始。’", "开场钩子  先用 4 秒并排展示面料微距、冬季羊毛大衣与系列 Lookbook，再回到面料原图：‘这件大衣不是从一句风格词开始，而是从这张燕麦驼双面羊毛面料图开始。’"),
        ("项目材料约束（普通白板备注）", "面料视觉约束"),
        ("独立于面料库的“PROJECT MATERIAL NOTE / F-01”普通便签记录供应商/样卡确认的羊毛 90% / 羊绒 10%、520 GSM、双面平纹、门幅 150 cm、无弹、不透，以及设计判断的厚实柔软、低光泽、保暖和冬季大衣用途。", "仅依据“燕麦驼双面羊毛 / F-01”的图片与名称，要求成衣保持图中可见的燕麦驼色、细密表面、厚实柔软感和低光泽；不添加任何面料工程参数。"),
        ("生成 3 组可量产冬季长款双面羊毛大衣。锁定羊毛90%/羊绒10%、520 GSM、燕麦驼、厚实柔软低光泽、", "生成 3 组可量产冬季长款双面羊毛大衣。以“燕麦驼双面羊毛 / F-01”的图片为唯一材质参考，保持图片中可见的燕麦驼色、细密表面、厚实柔软感与低光泽；锁定"),
        ("建议口播  我不会先问它能生成什么，而是先定义这块面料允许我们做什么。面料库内只有图片和名称，到此为止；成分、克重、织法、垂坠等专业约束属于项目设计备注，由我在普通白板便签中单独维护。", "建议口播  我不会先问它能生成什么，而是先观察这张面料图能提供哪些可见线索。面料库内只有图片和名称；生成时只要求保持图中可见的颜色、纹理、厚实感和光泽，不宣称模型理解不可见的面料工程参数。"),
        ("建议口播  这里的面料库严格只有图片和名称，不包含分类、成分、克重、织法、门幅、弹性、透明度、颜色、用途、来源、标签、备注或任何其他面料信息，也不会把这些内容自动推断或携带到白板。", "建议口播  这里的面料库严格只有图片和名称，不包含任何其他面料信息，也不会自动推断或携带隐藏属性到白板。"),
        ("建议口播  面料库回流结束时仍然只有图片和名称。现在这张项目材料备注是我关闭面料库后用普通便签另建的，不属于面料库，也不会写回或自动附着到面料库素材。", "建议口播  面料库回流结束时仍然只有图片和名称；关闭面料库后，我直接把这张图片作为视觉参考参与生成，不补建材料参数。"),
        ("建议口播  真正的设计控制来自角色与普通项目备注分工。面料节点仍只有图片和名称；项目材料备注负责有来源的设计约束，色卡负责比例，工艺便签负责边界。", "建议口播  真正的设计控制来自输入分工：面料图片负责可见材质表现，色卡负责颜色比例，避用项负责边界，服装尺寸与结构由设计提示词负责。"),
        ("建议口播  我不是选最戏剧化的一张。我先排除把 520 GSM 双面羊毛误读成薄针织或长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。", "建议口播  我不是选最戏剧化的一张。我先排除没有保持参考图厚实低光泽视觉、或被误读成薄针织和长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。"),
        ("建议口播  面料库中的图片与名称可以复用，但项目材料备注、版本和系列 DNA 都留在项目上下文中，绝不会变成面料库里的附加信息。", "建议口播  面料库中的图片与名称可以长期复用；版本和系列 DNA 留在项目上下文中，面料库仍不增加任何附加信息。"),
        ("先不要生成图片。请以高级服装设计师身份读取我选中的面料、色卡和备注：1）概括可确认的成分、克重、织法、垂坠、光泽；2）提出三条适合AW27冬季通勤的长款大衣方向，并至少比较双排直身、轻茧形与裹身结构；3）每条说明为什么适合这块面料、潜在结构/工艺风险和一票淘汰条件。不要把未知属性当成事实。", "先不要生成图片。请以高级服装设计师身份观察我选中的面料图片和色卡：1）只描述图片中可见的颜色、纹理、厚薄感与光泽，不推断成分或其他隐藏属性；2）提出三条适合AW27冬季通勤的长款大衣方向，并至少比较双排直身、轻茧形与裹身结构；3）每条说明视觉匹配理由、潜在结构/工艺风险和一票淘汰条件。"),
        ("生成三组可量产冬季长款双面羊毛大衣。锁定：羊毛90%/羊绒10%、520 GSM双面平纹、燕麦驼、厚实柔软低光泽、", "生成三组可量产冬季长款双面羊毛大衣。以“燕麦驼双面羊毛 / F-01”的图片为唯一材质参考，保持图片中可见的燕麦驼色、细密表面、厚实柔软感与低光泽。锁定："),
        ("严格保持燕麦驼双面羊毛的520 GSM厚度与低光泽、", "严格保持参考面料图所示的燕麦驼色、厚实感与低光泽，以及"),
        ("普通白板项目材料备注", "面料图片视觉参考"),
        ("关闭面料库后另建，记录来源、设计约束与待测试项", "直接选中面料图片，仅使用图片与名称"),
        ("项目知识可追溯，但不写入或附着于面料库", "视觉输入可复用，且不为面料库增加附加信息"),
        ("我不是选最戏剧化的一张。我先排除把 520 GSM 双面羊毛误读成薄针织或长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。", "我不是选最戏剧化的一张。我先排除没有保持参考图厚实低光泽视觉、或被误读成薄针织和长毛绒的方案，再检查枪驳领是否对称、双排扣位是否成列、后开衩与步行量是否能被真实打版。"),
        ("PROJECT MATERIAL NOTE / F-01", "面料节点 F-01（仅图片与名称）"),
        ("520 GSM", "参考图所示"),
        ("面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后新建普通项目备注", "面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后直接选中面料图片"),
        ("分成两个连续近景：先证明落位节点只有图片与名称，再关闭面料库并拍摄普通便签创建；不得让观众误以为备注是面料库字段。", "分成两个连续近景：先证明落位节点只有图片与名称，再关闭面料库并拍摄面料图片被选入设计助手上下文；不得暗示存在隐藏面料字段。"),
        ("停在面料原图、普通项目备注与最终系列之间。", "停在面料原图、设计助手对话与最终系列之间。"),
        ("完整设计链；对话/生成历史；面料图片与项目备注彼此独立", "完整设计链；对话/生成历史；面料图片作为视觉上下文"),
        ("面料库回流结束时仍然只有图片和名称。现在这张项目材料备注是我关闭面料库后用普通便签另建的，不属于面料库，也不会写回或自动附着到面料库素材。", "面料库回流结束时仍然只有图片和名称。关闭面料库后，我直接选中这张图片作为设计助手的视觉上下文，不新建材料参数。"),
        ("真正的设计控制来自角色与普通项目备注分工。面料节点仍只有图片和名称；项目材料备注负责有来源的设计约束，色卡负责比例，工艺便签负责边界。", "真正的设计控制来自输入分工：面料图片负责可见材质表现，色卡负责比例，避用项负责边界，服装结构由设计提示词负责。"),
        ("面料库中的图片与名称可以复用，但项目材料备注、版本和系列 DNA 都留在项目上下文中，绝不会变成面料库里的附加信息。", "面料库中的图片与名称可以复用；对话版本和系列 DNA 留在项目上下文中，面料库始终不增加附加信息。"),
        ("关闭面料库后新建普通项目备注", "关闭面料库后直接选中面料图片"),
        ("面料图片与项目备注彼此独立", "面料图片作为视觉上下文"),
    ),
    "02": (
        ("普通白板项目材料备注：PROJECT MATERIAL NOTE / F-02；独立记录供应商确认的棉 72% / 真丝 28%、105 GSM、细平纹、门幅 145 cm、无弹、轻微透，以及设计判断的轻薄微挺、柔和微光；衣身需轻薄棉里布；不属于面料库。", "面料参考：从面料库加入“雾薄荷棉真丝府绸 / F-02”的图片与名称；只要求生成结果保持图中可见的雾薄荷色、轻薄微挺感与柔和微光，不补充面料工程参数。"),
        ("关闭面料库后，用普通便签工具新建“PROJECT MATERIAL NOTE / F-02”：供应商确认＝棉72%/真丝28%、105 GSM、细平纹、门幅145 cm、无弹、轻微透；设计判断＝轻薄微挺、柔和微光、盛夏连衣裙；衣身需轻薄棉里布；未知项标“待测试”。另加三色色卡与工艺便签“珊瑚粉≤3%、袖窿不得走光、后中拉链连续、禁止大荷叶边”。", "关闭面料库后，将“雾薄荷棉真丝府绸 / F-02”的图片作为视觉参考，另加三色色卡与避用项“珊瑚粉≤3%、袖窿不得走光、后中拉链连续、禁止大荷叶边”；面料节点仍只有图片和名称。"),
        ("必须拍到：面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后新建 PROJECT MATERIAL NOTE / F-02", "必须拍到：面料抽屉的“我的”选中态；仅名称搜索；只含图片与名称的落位节点；关闭面料库后直接选中面料图片参与生成"),
        ("项目材料约束（普通白板备注）", "面料视觉约束"),
        ("独立于面料库的“PROJECT MATERIAL NOTE / F-02”普通便签记录供应商确认的棉 72% / 真丝 28%、105 GSM、细平纹、门幅 145 cm、无弹、轻微透，以及设计判断的轻薄微挺、柔和微光和盛夏连衣裙用途；衣身需轻薄棉里布。", "仅依据“雾薄荷棉真丝府绸 / F-02”的图片与名称，要求成衣保持图中可见的雾薄荷色、轻薄微挺感和柔和微光；不添加任何面料工程参数。"),
        ("使用105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白里布、", "以“雾薄荷棉真丝府绸 / F-02”的图片为材质参考，保持雾薄荷色、轻薄微挺感与柔和微光，骨白内层、"),
        ("建议口播  草图锁比例，面料库严格只有图片和名称。关闭面料库以后，我才用普通白板便签记录项目材料约束和工艺边界；这些内容不会写回或附着到面料库素材。", "建议口播  草图锁比例，面料库严格只有图片和名称。关闭面料库以后，我直接选中面料图片作为视觉参考；服装尺寸、结构和避用项写进本轮设计提示词，不为面料资产补充隐藏属性。"),
        ("面料为105 GSM轻薄微挺棉真丝府绸，雾薄荷主色、骨白轻薄棉里布、", "以“雾薄荷棉真丝府绸 / F-02”的图片为材质参考，保持图中可见的雾薄荷色、轻薄微挺感与柔和微光，骨白内层、"),
        ("PROJECT MATERIAL NOTE / F-02", "面料节点 F-02（仅图片与名称）"),
        ("逐一在“标签设计”确认草图=廓形参考、面料图片=面料参考、色卡=色彩方案、两张普通项目便签=备注；不向面料节点补写任何信息。", "逐一在“标签设计”确认草图=廓形参考、面料图片=面料参考、色卡=色彩方案、禁止大荷叶边参考=避用；不向面料节点补写任何信息。"),
        ("先拍面料节点只有图片和名称，再拍关闭面料库与普通便签创建；不得在同一界面中把项目备注表现成面料库信息。", "先拍面料节点只有图片和名称，再拍关闭面料库并把该图片选入设计助手上下文；不得暗示面料资产包含隐藏参数。"),
        ("面料库/色卡/普通项目备注", "面料库/色卡/设计助手"),
        ("面料库只按名称回流图片；关闭后另建普通便签补充项目约束", "面料库只按名称回流图片；关闭后直接以图片、草图和色卡作为设计助手上下文"),
        ("图片名称与其他设计信息彻底分离", "图片名称与服装结构提示词边界清楚"),
    ),
    "03": (
        ("共同 DNA：雾杏/骨白主色，酒红≤2%；52 GSM柔雾真丝雪纺；窄飘带；肩部细褶；法式缝。", "共同 DNA：雾杏/骨白主色，酒红≤2%；参考图所示的轻盈垂坠与柔雾光泽；窄飘带；肩部细褶；法式缝。"),
        ("使用普通便签工具在 MATERIAL 区新增“PROJECT MATERIAL NOTE / F-03”：供应商/测试确认＝真丝100%、52 GSM、绉平纹、门幅140 cm、无弹、半透明；设计判断＝流动垂坠、柔雾光泽；工艺＝同色吊带、法式缝、领口包边；未知项标“待测试”。给正向参考加黄铜图钉，避用参考加红色图钉。", "在 MATERIAL 区放入“雾杏真丝雪纺 / F-03”的图片与名称，只把图片作为材质视觉参考；给正向参考加黄铜图钉，避用参考加红色图钉。服装提示词另行要求轻盈垂坠、柔雾光泽和同色吊带避免走光。"),
        ("必须拍到：6 张本地上传状态；面料抽屉的“我的”与仅名称搜索；只含图片与名称的面料节点；关闭面料库后新建 PROJECT MATERIAL NOTE / F-03；7 张参考进入 5 个组织区", "必须拍到：6 张本地上传状态；面料抽屉的“我的”与仅名称搜索；只含图片与名称的面料节点；7 张参考进入 5 个组织区"),
        ("逐张检查：是否非戏服化、飘带宽度、雪纺透明度、肩部细褶、袖克夫和酒红比例。", "逐张检查：是否非戏服化、飘带宽度、轻微透视是否克制且不走光、肩部细褶、袖克夫和酒红比例。"),
        ("锁定色板、52 GSM真丝雪纺、窄飘带、肩部细褶与法式缝；保持领型和袖型未锁。", "锁定色板、参考图所示的轻盈垂坠与柔雾光泽、窄飘带、肩部细褶与法式缝；保持领型和袖型未锁。"),
        ("项目材料约束（普通白板备注）", "面料视觉约束"),
        ("独立于面料库的“PROJECT MATERIAL NOTE / F-03”普通便签记录供应商/测试确认的真丝 100%、52 GSM、绉平纹、门幅 140 cm、无弹、半透明，以及设计判断的流动垂坠与柔雾光泽；衣身配同色轻薄吊带，法式缝，酒红只作≤2% 点缀。", "仅依据“雾杏真丝雪纺 / F-03”的图片与名称，保持图中可见的轻盈垂坠与柔雾光泽；服装结构另行要求同色吊带避免走光、法式缝和酒红≤2%，不添加任何面料工程参数。"),
        ("锁定雾杏/骨白、52 GSM柔雾真丝雪纺、", "以“雾杏真丝雪纺 / F-03”的图片为材质参考，保持雾杏/骨白、轻盈垂坠与柔雾光泽；锁定"),
        ("锁定：雾杏/骨白+酒红≤2%、52 GSM柔雾真丝雪纺、", "锁定：雾杏/骨白+酒红≤2%、参考图所示的轻盈垂坠与柔雾光泽、"),
        ("建议口播  面料库回流结束时只有图片和名称，不包含任何其他信息。关闭面料库以后，我才在普通白板便签中记录项目材料约束；这张便签不属于面料库，也不会写回或自动附着到面料素材。", "建议口播  面料库回流结束时只有图片和名称，不包含任何其他信息。关闭面料库以后，我直接把面料图片作为视觉参考参与生成，不补建或推断材料参数。"),
        ("面料：雾杏/骨白52 GSM柔雾真丝雪纺，配同色轻薄吊带；", "面料视觉：以“雾杏真丝雪纺 / F-03”的图片为参考，保持雾杏/骨白、轻盈垂坠、柔雾光泽和克制透视，配同色轻薄吊带避免走光；"),
        ("锁定雾杏+骨白、酒红≤2%、52 GSM柔雾真丝雪纺、", "锁定雾杏+骨白、酒红≤2%、参考图所示的轻盈垂坠与柔雾光泽、"),
        ("PROJECT MATERIAL NOTE / F-03", "面料节点 F-03（仅图片与名称）"),
        ("采用 1.5× 轻微加速，但必须原速保留两个近景：面料节点只有图片与名称；面料库关闭后普通项目备注被单独创建。", "采用 1.5× 轻微加速，但必须原速保留两个近景：面料节点只有图片与名称；面料库关闭后该图片被选入多参考上下文。"),
        ("上传/面料库/文本/画框", "上传/面料库/标签/画框"),
        ("6 张本地图 + 1 张仅含图片与名称的私有面料资产；关闭面料库后另建普通项目备注", "6 张本地图 + 1 张仅含图片与名称的私有面料资产；按参考职责组织并进入生成"),
    ),
}

FLOWBOOKS = tuple(
    _rewrite_text(flowbook, VISIBLE_FABRIC_REWRITES[flowbook.number])
    for flowbook in FLOWBOOKS
)


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for flowbook in FLOWBOOKS:
        print(build_doc(flowbook))
