from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_LINE_SPACING
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/documents/workflow-report/工作流画布系统设计与技术实现说明-20261017.docx'
OUT.parent.mkdir(parents=True, exist_ok=True)


def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tcPr.append(shd)
    shd.set(qn('w:fill'), fill)


def set_cell_border(cell, color='D9D9D9', sz='6'):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in('w:tcBorders')
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        tag = 'w:' + edge
        element = tcBorders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            tcBorders.append(element)
        element.set(qn('w:val'), 'single')
        element.set(qn('w:sz'), sz)
        element.set(qn('w:space'), '0')
        element.set(qn('w:color'), color)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar')
        tcPr.append(tcMar)
    for m, v in [('top', top), ('start', start), ('bottom', bottom), ('end', end)]:
        node = tcMar.find(qn('w:' + m))
        if node is None:
            node = OxmlElement('w:' + m)
            tcMar.append(node)
        node.set(qn('w:w'), str(v))
        node.set(qn('w:type'), 'dxa')


def set_run_font(run, name='Microsoft YaHei', size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.rFonts
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.insert(0, rFonts)
    rFonts.set(qn('w:eastAsia'), name)
    rFonts.set(qn('w:ascii'), name)
    rFonts.set(qn('w:hAnsi'), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)


def style_paragraph(p, before=0, after=8, line=1.35, align=None):
    fmt = p.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    if align is not None:
        p.alignment = align


def add_text(p, text, bold=False, color='000000', size=10.5, italic=False):
    r = p.add_run(text)
    set_run_font(r, size=size, bold=bold, color=color, italic=italic)
    return r


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(style=f'Heading {level}')
    add_text(p, text, bold=True, size=16 if level == 1 else 12.5, color='000000')
    style_paragraph(p, before=16 if level == 1 else 10, after=8 if level == 1 else 5, line=1.2)
    return p


def add_body(doc, text, after=8, first_indent=True):
    p = doc.add_paragraph(style='Body Text')
    if first_indent:
        p.paragraph_format.first_line_indent = Pt(21)
    add_text(p, text, size=10.5)
    style_paragraph(p, after=after, line=1.45)
    return p


def add_bullet(doc, lead, text):
    p = doc.add_paragraph(style='List Bullet')
    add_text(p, lead, bold=True, size=10.5)
    add_text(p, text, size=10.5)
    style_paragraph(p, after=4, line=1.3)
    return p


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_text(p, text, size=9, color='666666', italic=True)
    style_paragraph(p, before=2, after=10, line=1.2)
    return p


def add_table(doc, headers, rows, widths=None, header_fill='1F4E79'):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        if widths:
            hdr[i].width = Inches(widths[i])
        set_cell_shading(hdr[i], header_fill)
        set_cell_border(hdr[i])
        set_cell_margins(hdr[i])
        hdr[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_text(p, h, bold=True, color='FFFFFF', size=9.5)
        style_paragraph(p, after=0, line=1.15)
    for ridx, row in enumerate(rows):
        cells = table.add_row().cells
        for i, value in enumerate(row):
            if widths:
                cells[i].width = Inches(widths[i])
            set_cell_border(cells[i])
            set_cell_margins(cells[i])
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if ridx % 2 == 1:
                set_cell_shading(cells[i], 'F3F6FA')
            p = cells[i].paragraphs[0]
            style_paragraph(p, after=0, line=1.25)
            add_text(p, str(value), size=9.2)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def add_flow_table(doc):
    table = doc.add_table(rows=2, cols=9)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    labels = ['需求 / 参考', '→', '需求分析', '→', '方案生成', '→', '候选设计', '→', '评价 / 修改']
    details = ['目标、图片、色卡\n约束与待确认项', '', '提取有据约束\n形成 constraint', '', '绑定约束与参考\n生成 1–4 个候选', '', '候选、评价、采用\n保留真实输入', '', '检查约束\n派生新分支']
    for c in range(9):
        cell = table.cell(0, c)
        cell.width = Inches(0.78 if c % 2 == 0 else 0.28)
        set_cell_border(cell)
        set_cell_margins(cell, top=80, bottom=80, start=70, end=70)
        set_cell_shading(cell, 'EAF2F8' if c % 2 == 0 else 'FFFFFF')
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_text(p, labels[c], bold=c % 2 == 0, size=9.2, color='1F4E79' if c % 2 == 0 else '7F8C8D')
        style_paragraph(p, after=0, line=1.15)
        cell2 = table.cell(1, c)
        cell2.width = cell.width
        set_cell_border(cell2)
        set_cell_margins(cell2, top=80, bottom=80, start=70, end=70)
        p2 = cell2.paragraphs[0]
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_text(p2, details[c], size=8.2, color='333333')
        style_paragraph(p2, after=0, line=1.15)
    add_caption(doc, '图 1  工作流画布中的设计闭环示意（可结合实际画面补充截图）')


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    fldChar1 = OxmlElement('w:fldChar')
    fldChar1.set(qn('w:fldCharType'), 'begin')
    instrText = OxmlElement('w:instrText')
    instrText.set(qn('xml:space'), 'preserve')
    instrText.text = 'PAGE'
    fldChar2 = OxmlElement('w:fldChar')
    fldChar2.set(qn('w:fldCharType'), 'end')
    run._r.append(fldChar1)
    run._r.append(instrText)
    run._r.append(fldChar2)
    set_run_font(run, size=9, color='666666')


doc = Document()
section = doc.sections[0]
section.top_margin = Inches(0.72)
section.bottom_margin = Inches(0.68)
section.left_margin = Inches(0.82)
section.right_margin = Inches(0.82)

styles = doc.styles
styles['Normal'].font.name = 'Microsoft YaHei'
styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
styles['Normal'].font.size = Pt(10.5)
for name, size in [('Heading 1', 16), ('Heading 2', 12.5), ('Heading 3', 11.5)]:
    st = styles[name]
    st.font.name = 'Microsoft YaHei'
    st._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0, 0, 0)
styles['Body Text'].font.name = 'Microsoft YaHei'
styles['Body Text']._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
styles['Body Text'].font.size = Pt(10.5)

# Header and footer
header = section.header.paragraphs[0]
add_text(header, 'AI 服装设计平台｜工作流画布系统设计与技术实现', size=8.5, color='666666')
style_paragraph(header, after=0, line=1.0)
footer = section.footer.paragraphs[0]
add_text(footer, '系统汇报文档  ·  ', size=8.5, color='666666')
add_page_number(footer)

# Cover
p = doc.add_paragraph()
style_paragraph(p, before=50, after=10, line=1.1)
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_text(p, 'AI 服装设计平台', bold=True, size=14, color='1F4E79')
p = doc.add_paragraph(style='Title')
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_text(p, '工作流画布系统设计与技术实现说明', bold=True, size=25, color='000000')
style_paragraph(p, before=3, after=12, line=1.15)
p = doc.add_paragraph()
add_text(p, '围绕需求、素材、工具、候选与人工决策建立可追溯的设计路径', size=13, color='555555')
style_paragraph(p, after=22, line=1.25)
add_body(doc, '本文用于系统汇报，重点说明工作流画布如何成为 AI 服装设计平台的主入口，以及画布背后的数据模型、工具契约、助手协作机制、异步执行链路和可靠恢复策略。文档不嵌入项目截图，相关位置保留为可手动补充的实际画面说明。', first_indent=False, after=10)
add_body(doc, '核心结论：平台的价值不在于堆叠更多 Agent，而在于把设计目标、参考素材、约束、候选、评价和人工决定放进同一条可校验、可追溯、可恢复的工作流路径中。助手负责理解和提案，设计师掌握采用与执行开关。', first_indent=False, after=26)
p = doc.add_paragraph()
add_text(p, '汇报版本  2026 年 10 月', size=10, color='666666')
style_paragraph(p, after=0, line=1.2)
doc.add_page_break()

# Contents
add_heading(doc, '文档导读', 1)
add_body(doc, '阅读本文时，建议先理解画布的定位，再看节点和连线如何表达设计语义，随后进入助手协作、人工确认、版本追溯和技术实现。这样可以把“画面上看到的工作流”与“系统真正保存和执行的事实”对应起来。')
add_table(doc, ['章节', '主要回答的问题'], [
    ['一 系统定位', '为什么工作流画布是主入口，权威数据在哪里？'],
    ['二 画布设计', '节点、连线、输入槽位和版本分别表达什么？'],
    ['三 设计闭环', '从需求到候选、评价和修改是如何连续起来的？'],
    ['四 人机协作', '助手可以做什么，设计师在哪些环节做决定？'],
    ['五 技术实现', '前端、API、数据库、队列、模型和对象存储如何协同？'],
    ['六 亮点与边界', '系统优势如何观察，哪些能力不能被夸大？'],
], widths=[1.25, 5.65])

# 1
add_heading(doc, '一 系统定位与总体设计', 1)
add_heading(doc, '1.1 工作流画布是系统的主入口', 2)
add_body(doc, '当前主工作流以持久化 WorkflowGraph 为核心。浏览器中的 tldraw 负责拖拽、连线、缩放和选择等交互；服务端工作流图才是项目级的权威事实。画布因此不只是一个自由排版的白板，而是一个能够被服务端校验、被异步任务消费、被历史记录还原的结构化设计空间。')
add_bullet(doc, '设计事实：', '节点记录需求、参考、约束、候选和评价报告；连线记录来源关系与输入槽位；语义 revision 记录设计事实的变化。')
add_bullet(doc, '协作过程：', '助手读取有界上下文后返回回答、澄清或待确认提案；设计师确认画布变更，再主动执行生成、评价或修改。')
add_bullet(doc, '结果沉淀：', '每次执行形成尝试、候选、评价、采用或否决记录，并沿真实资产血缘回到画布。')
add_caption(doc, '建议补充实际画面：项目工作流画布总览，突出节点、连线和右侧助手栏')

add_heading(doc, '1.2 设计目标', 2)
add_table(doc, ['目标', '系统设计回应'], [
    ['可理解', '让设计师能从画面上看懂当前路径、输入来源和下一步动作。'],
    ['可控制', '助手先提案，设计师决定是否接受；接受提案不等于立即生成图片。'],
    ['可校验', '服务端检查节点类型、项目归属、输入槽位、节点版本和无环关系。'],
    ['可追溯', '候选绑定冻结输入、节点版本、提示词、模型参数和执行结果。'],
    ['可恢复', '数据库、Outbox、队列租约、幂等回填与扫描机制共同保证重启后可继续。'],
], widths=[1.25, 5.65])

# 2
add_heading(doc, '二 工作流画布的核心设计', 1)
add_heading(doc, '2.1 节点语义：把设计意图拆成可检查的对象', 2)
add_body(doc, '画布中的节点不是单纯的视觉卡片，而是带有输入、输出和状态边界的领域对象。每个节点有明确的类型、所属项目、语义版本和执行关系；节点之间的连接决定了工具能够读取哪些上游内容。')
add_table(doc, ['节点类别', '承载内容', '在画布中的作用'], [
    ['需求与参考', '目标、参考图片、色卡、草图、趋势、面料信息', '提供设计问题和可复用素材。'],
    ['约束节点', '必须保留项、可调整项、待确认项', '把自然语言需求整理成可验证的约束。'],
    ['工具节点', '工具类型、参数、输入槽位、执行状态', '把分析、生成、评价和修改变成明确动作。'],
    ['候选节点', '生成结果、候选序号、资产引用、采用状态', '承载实际设计结果与人工选择。'],
    ['评价与决定', '逐项观察、问题、无法判断项、采用或否决理由', '保留专业判断及其依据。'],
], widths=[1.25, 2.7, 2.95])

add_heading(doc, '2.2 连线与输入槽位：让来源关系可见', 2)
add_body(doc, '连线不是装饰性的箭头，而是工具输入的显式绑定。一个工具节点可以拥有多个输入槽位，例如需求分析需要目标与参考，方案生成需要约束与参考，局部修改则必须绑定唯一母图。服务端会在执行前再次验证连线的类型、归属、版本与是否成环。')
add_flow_table(doc)
add_heading(doc, '2.3 revision 与 layoutRevision 分离', 2)
add_body(doc, '系统把“设计事实变化”和“画面布局变化”分开记录。拖动节点、整理画布位置或调整视图，不会制造新的设计版本；改变约束、替换输入、接受提案或新增工具节点，才会推进语义 revision。这个分离避免了无意义的版本膨胀，也让历史记录更接近设计决策本身。')
add_table(doc, ['变化类型', '是否推进语义 revision', '原因'], [
    ['拖动节点位置', '否，仅更新 layoutRevision', '属于视图整理，不改变设计事实。'],
    ['修改约束内容', '是', '改变了后续工具可以依赖的设计条件。'],
    ['接受助手提案', '是', '画布结构或工具输入发生了语义变化。'],
    ['主动执行工具', '创建新的 attempt', '把当前图状态冻结为一次可追溯的执行事实。'],
], widths=[2.0, 2.1, 2.8])

# 3
add_heading(doc, '三 从需求到候选的设计闭环', 1)
add_heading(doc, '3.1 设计闭环的基本路径', 2)
add_body(doc, '系统围绕具体候选展开修改，而不是让设计师在一张不断覆盖的画布上反复试错。一个典型过程是：先记录目标和参考，再提取约束，之后生成少量候选，对候选进行逐项评价，最后基于唯一母图派生修改分支。原候选、原评价和原决定均被保留。')
add_heading(doc, '3.2 讲解示例', 2)
add_body(doc, '以“保留立领和藏蓝色，只收窄袖子”为例，系统会把“保留立领”和“保留藏蓝色”作为需要持续检查的保留项，把“收窄袖子”作为此次修改目标。设计师否决某个候选后，反馈会绑定到具体候选和具体尝试，不会自动升级为跨项目偏好，也不会顺手修改领型和颜色。')
add_table(doc, ['步骤', '系统记录', '设计师可观察到的结果'], [
    ['提出目标', '目标节点与原始描述', '知道这次设计要解决什么问题。'],
    ['提取约束', 'constraint 节点与待确认项', '看到哪些条件必须保留，哪些条件仍需确认。'],
    ['生成候选', 'attempt、输入快照、候选资产', '看到本次生成使用了哪些输入和参数。'],
    ['评价候选', '逐项 evaluation 与无法判断项', '知道候选符合什么、问题是什么。'],
    ['派生修改', '唯一母图、新工具节点、新候选分支', '能比较修改前后，不覆盖原始结果。'],
], widths=[1.25, 3.05, 2.6])
add_caption(doc, '建议补充实际画面：候选节点详情、评价结果与“派生修改”操作路径')

# 4
add_heading(doc, '四 助手协作与人工确认', 1)
add_heading(doc, '4.1 助手先理解上下文，再提出下一步', 2)
add_body(doc, '助手读取初始目标、当前目标、设计轨迹、对话、隐含意图和工具信息，必要时补读相关节点与真实图片。它的输出分为回答、澄清、读取请求和待确认提案。信息整合、Planner 和动作使能彼此分离，模型不能直接获得任意数据库写入权限。')
add_table(doc, ['层次', '职责', '控制边界'], [
    ['Information Integration', '整理目标、图目录、历史决定、输入和证据边界', '最多三轮补读，优先不可变版本与真实执行事实。'],
    ['Planner', '判断应该回答、澄清、读取还是提出动作', '最多五次调用，输出必须落在注册动作集合内。'],
    ['Action Enablement', '把提案编译为合法的图变更或执行请求', '再次校验节点、输入槽位、项目归属和版本。'],
], widths=[1.65, 3.2, 2.05])
add_heading(doc, '4.2 提案与执行分离', 2)
add_body(doc, '助手提案只描述下一步如何改变画布，例如新增一个方案生成工具、替换某个输入、保留某些条件或调整参数。设计师接受提案后，系统只保存图变更并将提案标记为已接受；真正的图片任务必须由设计师主动点击执行。')
add_flow_table(doc)
add_caption(doc, '图 2  提案接受与真实执行之间的人工确认边界')
add_body(doc, '如果图版本、节点版本或会话意图已经变化，旧提案会失效，不能覆盖新的设计决定。这一机制把“助手建议过什么”和“设计师最终决定了什么”清晰分开，也避免助手在没有明确操作时直接调用付费模型。')

# 5
add_heading(doc, '五 版本、追溯与可靠恢复', 1)
add_heading(doc, '5.1 冻结执行事实', 2)
add_body(doc, '执行过的设计不会被最新重试结果覆盖。节点版本用 UUID 与递增版本号记录语义状态；输入绑定引用来源节点版本，而不是当前卡片；执行尝试冻结输入、提示词、模型参数和生成任务。这样才能回答“当时看到了什么、用了什么输入、做了什么决定”。')
add_table(doc, ['对象', '冻结内容', '解决的问题'], [
    ['WorkflowNodeVersion', '节点语义、参数、输入绑定、版本号', '防止当前卡片内容冒充历史输入。'],
    ['WorkflowAttempt', '尝试状态、模型参数、提示词、输入快照', '区分不同次执行和重试。'],
    ['Candidate / Asset', '生成文件、血缘关系、采用状态', '让结果可沿真实资产关系回溯。'],
    ['Decision / Evaluation', '评价结论、理由、时间和操作者', '保留人工判断，不把技术失败伪装成设计结论。'],
], widths=[1.65, 3.15, 2.1])
add_heading(doc, '5.2 异步执行与恢复', 2)
add_body(doc, 'PostgreSQL 是事实与投递依据，Redis/BullMQ 负责异步唤醒。一次执行先由 API 在事务中写入图事实、尝试和 Outbox，再由 Worker 领取任务、调用模型、写回结果。队列租约、幂等回填和定期扫描共同覆盖浏览器关闭、Worker 重启、消息丢失和重复投递等情况。')
add_table(doc, ['阶段', '主要动作', '可靠性保障'], [
    ['提交', '校验图、冻结输入、创建 attempt 与 Outbox', '数据库事务保证事实和待投递记录一致。'],
    ['领取', 'Worker 获取任务并建立租约', '租约超时后可被重新领取。'],
    ['执行', '调用 Claude 或 GPT Image，完成审核与对象写入', '输入与参数来自冻结快照。'],
    ['回填', '写入候选、状态和资产血缘', '幂等键避免重复生成同一结果。'],
    ['通知', 'SSE 即时通知，画布约 3 秒轮询 reload', '即时更新与最终一致性并存。'],
], widths=[1.15, 3.25, 2.5])

# 6
add_heading(doc, '六 四类领域工具', 1)
add_body(doc, '四类工具构成从理解到修改的最小闭环。工具目录位于 packages/shared，输入槽位规定哪些节点可以连接，参数 schema 规定数量、尺寸、质量、负向提示和参考配置。工具契约让画布上的动作有明确语法，也让服务端可以在执行前拒绝非法连接。')
add_table(doc, ['工具', '输入', '输出', '关键边界'], [
    ['analyze_brief 需求分析', '唯一目标 + 参考', 'constraint', '不生成图片，不预定整条工具链。'],
    ['generate_design 方案生成', 'constraint + 参考', '1–4 个 candidate', '接受建议不生成；参考权重只是提示词引导。'],
    ['evaluate_design 服装评估', 'constraint + 1–4 个 candidate', 'evaluation', '不能判断纤维、精确尺寸或生产性能。'],
    ['edit_design 局部修改', '唯一母图 + 约束/参考', '新 candidate', '有上游约束须保留，图片总数不超过 16。'],
], widths=[1.55, 2.0, 1.45, 2.0])
add_heading(doc, '6.1 工具运行的共同校验', 2)
add_bullet(doc, '类型校验：', '输入必须符合工具所需的节点类型和槽位要求。')
add_bullet(doc, '归属校验：', '节点、资产和项目必须属于当前工作流与当前用户可访问的范围。')
add_bullet(doc, '无环校验：', '连线不能让图形成循环依赖，确保执行顺序可解释。')
add_bullet(doc, '输入就绪校验：', '工具执行前必须确认必需输入已存在且版本明确。')

# 7
add_heading(doc, '七 技术架构与数据流', 1)
add_heading(doc, '7.1 分层架构', 2)
add_table(doc, ['层次', '技术组成', '主要职责'], [
    ['浏览器交互层', 'Next.js 16、React 19、tldraw、助手栏', '画布交互、节点编辑、提案预览、状态订阅。'],
    ['领域 API 层', 'NestJS', '权限、图校验、提案、上下文读取、任务提交。'],
    ['持久事实层', 'PostgreSQL、Prisma', 'Graph、Node Version、Attempt、Candidate、Outbox。'],
    ['异步执行层', 'Redis、BullMQ Worker', '模型调用、审核、重试、租约、恢复。'],
    ['模型与对象层', 'Claude、GPT Image、MinIO/S3', '理解与规划、生成与编辑、私有对象存储。'],
], widths=[1.55, 2.35, 3.1])
add_caption(doc, '建议补充实际画面：技术架构或任务状态面板（如有）')
add_heading(doc, '7.2 一次真实执行的生命周期', 2)
add_body(doc, '设计师在画布上点击执行后，前端将当前图版本与节点版本提交给 API。API 重新校验输入并写入冻结事实，随后通过 Outbox 投递异步任务。Worker 从队列领取任务，调用模型并将生成结果写入私有对象存储，再把候选与资产血缘写回数据库。前端通过 SSE 获得即时状态，同时保留约 3 秒轮询 reload 作为最终状态刷新机制。')
add_body(doc, '生成和编辑过程中的图片字节只在内存中短暂处理，随后写入 MinIO/S3 私有对象存储，不直接落入任务数据库。数据库保存的是资产引用、血缘关系、状态和必要的元数据。')

# 8
add_heading(doc, '八 系统亮点、能力边界与评测方向', 1)
add_heading(doc, '8.1 可观察的系统亮点', 2)
add_table(doc, ['亮点', '具体表现', '对汇报的意义'], [
    ['设计师可控制', '助手先提案，设计师决定接受和执行', '生成过程保留人工判断，不把自动化等同于自动驾驶。'],
    ['输入关系清楚', '节点槽位、来源连线和版本绑定可见', '每个候选都能解释“用了什么”。'],
    ['设计资产可追溯', '候选、评价、采用和否决沿血缘回溯', '复盘时能回答“为什么得到这个结果”。'],
    ['运行可靠', '事务、Outbox、租约、幂等和扫描协同', '浏览器或 Worker 重启后仍能恢复状态。'],
    ['边界表达诚实', '明确视觉模型不能代替规格、打版和生产验证', '避免把图像生成能力夸大成完整服装工程能力。'],
], widths=[1.55, 3.25, 2.2])
add_heading(doc, '8.2 当前能力边界', 2)
add_bullet(doc, '视觉结果边界：', '图片不能确认纤维成分、精确尺寸、版型合体、工艺细节、成本或生产性能。')
add_bullet(doc, '参考控制边界：', '参考图角色和权重是提示词引导，不能保证精确的物理或结构控制。')
add_bullet(doc, '协作边界：', '接受助手提案不会自动生成图片，真实执行仍需设计师主动操作。')
add_bullet(doc, '评测边界：', '当前不宣称准确率、专业效果提升或节省时间数据，相关结论需要通过授权任务和专家标注独立验证。')
add_heading(doc, '8.3 建议评测指标', 2)
add_table(doc, ['评测方向', '建议观察的指标'], [
    ['约束覆盖', '必须保留项在生成、评价和修改中被正确传递的比例。'],
    ['评价一致性', '相同约束与候选在不同执行中的评价稳定性。'],
    ['保留条件破坏率', '局部修改后原有保留条件被破坏的比例。'],
    ['过程效率', '完成目标所需尝试次数、人工确认次数、时间和模型成本。'],
    ['恢复可靠性', '重启、重复投递和网络中断后的结果一致性与可恢复率。'],
], widths=[2.05, 4.95])

# 9
add_heading(doc, '九 汇报时的讲解主线', 1)
add_body(doc, '汇报时可以把画布理解为一条“设计事实链”：左侧是需求和参考，中间是约束与工具，右侧是候选、评价与修改分支。先讲清楚这条链如何表达设计意图，再说明助手如何在链上提出下一步，最后落到版本冻结、异步执行和可靠恢复。')
add_table(doc, ['讲解顺序', '建议强调的内容'], [
    ['先看画布', '画布是主入口，tldraw 是交互视图，WorkflowGraph 才是权威数据。'],
    ['再看一条路径', '用“保留立领和藏蓝色，只收窄袖子”说明候选、评价和修改分支。'],
    ['再讲助手', '助手理解上下文并提出提案，设计师决定接受与执行。'],
    ['最后讲工程', '版本冻结、Outbox、BullMQ、对象存储与轮询/SSE保证结果可靠。'],
], widths=[1.45, 5.55])
add_body(doc, '建议手动补入的实际画面包括：工作流画布总览、节点详情与输入槽位、助手提案差异预览、候选结果与评价面板、执行状态和历史分支。截图应优先使用当前可正常使用的项目画面，避免继续使用旧版自由白板或旧版串行 Agent 截图。', first_indent=False, after=8)

add_heading(doc, '十 结语', 1)
add_body(doc, '工作流画布把 AI 服装设计从一次性的图片生成，推进为可解释、可控制、可追溯的设计协作过程。系统把目标、素材、约束、候选、评价和决定连接起来；助手负责理解和提案；设计师掌握最终的采用和执行开关；数据库、队列和对象存储则负责把每一次尝试可靠地保存下来。')
add_body(doc, '下一阶段的重点不应只是增加更多工具，而应围绕授权任务和专家标注验证约束覆盖、评价一致性、修改质量、尝试次数、时间和成本，进一步证明画布对真实服装设计工作的帮助。', first_indent=False, after=0)

doc.save(OUT)
print(OUT)
