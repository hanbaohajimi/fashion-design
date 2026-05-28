// Fashion AI Platform — Word Document Generator
// Uses docx@9.x to produce a richly formatted .docx
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, ShadingType,
  Header, Footer, PageNumber, NumberFormat, Tab, TabStopType, TabStopPosition,
  BorderStyle, PageBreak, LevelFormat,
} from 'docx';
import fs from 'fs';

// ─── Design Tokens ───
const C = {
  navy: '1A1A2E', gold: 'C9A96E', body: '2C2C2C', cream: 'F5F0E8',
  border: 'D4C5A9', brown: '4A3728', goldDark: '8B6914', white: 'FFFFFF',
  gray: '888888', lightGray: 'AAAAAA',
};

// ─── Helpers ───
const goldLine = () => new Paragraph({
  spacing: { before: 80, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.gold } },
});

const spacer = (pts = 120) => new Paragraph({ spacing: { before: pts } });

const h1 = (text) => [
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 60 },
    children: [new TextRun({ text, bold: true, size: 36, font: 'Georgia', color: C.navy })],
  }),
  goldLine(),
];

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 100 },
  children: [new TextRun({ text, bold: true, size: 28, font: 'Georgia', color: C.brown })],
});

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 80 },
  children: [new TextRun({ text, bold: true, size: 24, font: 'Georgia', color: C.goldDark })],
});

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 360 },
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  children: [new TextRun({
    text, size: 22, font: 'Arial', color: opts.color || C.body,
    bold: opts.bold, italics: opts.italic,
  })],
});

const bullet = (text) => new Paragraph({
  spacing: { after: 80, line: 360 },
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text, size: 22, font: 'Arial', color: C.body })],
});

const colW = (cm) => Math.round(cm * 567); // cm to DXA twips

const cell = (text, opts = {}) => new TableCell({
  width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
  shading: opts.bg ? { type: ShadingType.CLEAR, fill: opts.bg, color: 'auto' } : undefined,
  children: [new Paragraph({
    spacing: { before: 40, after: 40 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({
      text, size: opts.size || 20, font: 'Arial',
      bold: opts.bold, color: opts.color || C.body,
    })],
  })],
});

const headerCell = (text, w) => cell(text, { bg: C.gold, color: C.white, bold: true, w, size: 20, center: true });

const makeTable = (headers, rows, widths) => {
  const hRow = new TableRow({
    children: headers.map((h, i) => headerCell(h, widths[i])),
    tableHeader: true,
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((txt, ci) => cell(txt, {
        w: widths[ci],
        bg: ri % 2 === 1 ? C.cream : C.white,
      })),
    })
  );
  return new Table({
    rows: [hRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
  });
};

// ─── Cover Page ───
const coverPage = [
  spacer(2400),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: '时尚智能平台', size: 64, font: 'Georgia', bold: true, color: C.navy })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new TextRun({ text: 'Fashion AI Platform', size: 28, font: 'Arial', italics: true, color: C.gold })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: '以 AI 重新定义时尚设计的边界，用数据读懂美的流向', size: 22, font: 'Arial', color: C.gray })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: '2025 年 5 月', size: 20, font: 'Arial', color: C.lightGray })],
  }),
  new Paragraph({
    spacing: { before: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.gold } },
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── TOC ───
const tocLine = (title, pg) => new Paragraph({
  spacing: { after: 100 },
  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: 'dot' }],
  children: [
    new TextRun({ text: title, size: 22, font: 'Arial', color: C.body }),
    new TextRun({ children: [new Tab()] }),
    new TextRun({ text: pg, size: 22, font: 'Arial', color: C.gray }),
  ],
});

const tocPage = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 300 },
    children: [new TextRun({ text: '目 录', size: 32, font: 'Georgia', bold: true, color: C.navy })],
  }),
  tocLine('第一章  项目概览', '3'),
  tocLine('  1.1 项目背景与市场洞察', '3'),
  tocLine('  1.2 项目定位与目标用户', '4'),
  tocLine('  1.3 核心理念与 Slogan', '4'),
  tocLine('第二章  功能模块介绍', '5'),
  tocLine('  2.1 用户旅程全流程', '5'),
  tocLine('  2.2 AI 设计工作台', '5'),
  tocLine('  2.3 趋势分析中心', '6'),
  tocLine('  2.4 界面美学体系', '7'),
  tocLine('第三章  系统技术架构', '8'),
  tocLine('  3.1 整体架构图', '8'),
  tocLine('  3.2 核心技术流程详解', '9'),
  tocLine('  3.3 LLM Prompt 工程设计', '11'),
  tocLine('  3.4 前端工程化与性能优化', '12'),
  tocLine('第四章  创新亮点总结', '13'),
  tocLine('第五章  项目展望', '14'),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── Chapter 1 ───
const ch1 = [
  ...h1('第一章  项目概览'),
  h2('1.1 项目背景与市场洞察'),
  p('全球时尚产业正经历深刻的数字化转型。据 McKinsey《State of Fashion 2025》报告，超过 73% 的时尚品牌已将 AI 技术列为未来三年的战略投资重点。然而，行业从业者在实际工作中仍面临显著痛点：'),
  bullet('趋势洞察碎片化：设计师需要从数十个媒体源手动收集、筛选、归纳流行趋势，耗时数周且主观性强'),
  bullet('设计工具与数据割裂：创意设计与市场数据分析分属不同工具，无法在同一工作流中协同'),
  bullet('视觉呈现缺乏美感：现有 BI 工具和数据平台的界面设计与时尚行业的审美标准存在巨大鸿沟'),
  bullet('AI 能力门槛高：大语言模型和 AI 生图能力虽然强大，但缺乏面向时尚场景的专业化封装'),
  p('时尚智能平台（Fashion AI Platform）正是为解决这些痛点而生。它将 AI 驱动的趋势分析、智能设计辅助与高端艺术化的用户体验融为一体，为时尚行业提供前所未有的数字化工作伙伴。'),

  h2('1.2 项目定位与目标用户'),
  p('平台定位为「专业深度 × 艺术审美」的时尚智能工具，目标用户画像包括：'),
  makeTable(
    ['用户角色', '核心需求', '平台价值'],
    [
      ['时尚设计师', 'AI 辅助概念生成、款式迭代、虚拟试穿', '从灵感到成稿的一站式 AI 设计工作台'],
      ['趋势分析师', '快速抓取和归纳多源趋势情报', '自动化爬取 + LLM 深度分析的趋势报告'],
      ['品牌买手', '数据驱动的采买决策支持', '热词追踪、季节趋势、消费信号洞察'],
      ['时尚编辑', '高质量图文内容生产', 'AI 智能配图 + 编辑级报告输出'],
    ],
    [colW(3), colW(5.5), colW(6.5)],
  ),

  h2('1.3 核心理念与 Slogan'),
  p('在布料的褶皱间，捕捉时代的呼吸；用数据读懂美的流向；以 AI 重新定义设计的边界。', { italic: true }),
  p('平台的核心理念是：将最前沿的人工智能技术，以最优雅的方式呈现给时尚行业从业者，让技术成为创意的翅膀而非门槛。'),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── Chapter 2 ───
const ch2 = [
  ...h1('第二章  功能模块介绍'),
  h2('2.1 用户旅程全流程'),
  p('用户从进入平台到完成工作任务的完整旅程如下：'),
  makeTable(
    ['步骤', '页面', '体验描述'],
    [
      ['1', '沉浸式首页', '全屏印象派画作背景，诗意文案，「进入系统」CTA 按钮'],
      ['2', '登录 / 注册', '毛玻璃卡片，底线输入框，邮箱+密码认证，7天免登录'],
      ['3', '工具选择大厅', '双模块卡片（AI 设计 / 趋势分析），hover 金铜光晕，点击过渡动画'],
      ['4', 'AI 设计工作台', '画布编辑 + AI 对话生图 + 像素编辑器 + 虚拟试穿'],
      ['5', '趋势分析中心', '仪表盘 + 趋势报告 + 季节趋势 + 文章库 + 热词云图'],
    ],
    [colW(1.5), colW(3.5), colW(10)],
  ),

  h2('2.2 AI 设计工作台'),
  h3('功能描述'),
  p('AI 设计工作台是面向设计师的核心创作空间。它将 Fabric.js 画布引擎与阿里云通义 AI 模型深度融合，支持从自然语言描述直接生成时尚设计图，并在同一画布上进行编辑、迭代和展示。'),
  h3('核心能力'),
  bullet('文生图（Text-to-Image）：描述即可生成写实服装照片、概念图、街拍效果'),
  bullet('草图绘制：一键生成黑白线稿款式图，适合设计初期快速探索'),
  bullet('局部重绘：画笔涂抹选区 + 文字指令，AI 精准修改指定区域'),
  bullet('图案迁移：将花纹/Logo 自然融入服装面料褶皱'),
  bullet('虚拟试穿：服装图 + 模特图自动合成穿搭效果'),
  bullet('提示词增强：中文简述自动扩展为专业英文 Prompt'),

  h2('2.3 趋势分析中心'),
  h3('热词云图模块'),
  p('基于 SVG 螺旋布局算法的交互式词云图，词语大小映射热度权重（14px–80px），色彩取自系统主色调（金铜/酒红/炭黑/青绿）。Hover 时聚焦词放大 1.15 倍并显示浮层详情，其余词降至 0.2 透明度；Click 触发关键词时间线趋势追踪。词云通过 ResizeObserver 自适应容器尺寸。'),
  h3('文章库模块'),
  p('基于 Playwright 自动化爬虫的时尚文章管理系统。从 Vogue China 等权威媒体源自动抓取文章，提取标题、正文、图片、发布时间等结构化数据。每篇文章卡片展示来源匹配的封面图，图片加载失败时降级为分类占位图（标题首字 + 分类配色）。支持全文搜索和多维度筛选。'),
  h3('趋势报告模块'),
  p('核心分析引擎。通过 DeepSeek LLM 对爬取的时尚文章进行多维度趋势分析，自动生成包含以下 7 个分析维度的结构化报告：色彩趋势、面料趋势、单品趋势、廓形趋势、图案趋势、风格关键词、消费者信号。报告还包含 4 大核心板块（款式 / 单品 / 版型 / 颜色）的深度分析，每个板块含趋势方向、代表品牌、搭配建议和置信度评分。LLM 可在报告描述中插入 {{IMAGE}} 标记，前端解析后自动从 Unsplash 注入语义相关配图。'),

  h2('2.4 界面美学体系'),
  p('平台整体视觉语言参考高端时装杂志与印象派绘画美学，具体设计规范如下：'),
  makeTable(
    ['设计要素', '规范说明'],
    [
      ['色彩体系', '米白 #FAF8F5（背景）、炭黑 #1A1A1A（文字/Tab 栏）、金铜 #C9A96E（强调/按钮/头像）'],
      ['字体层级', '标题：Playfair Display / Noto Serif SC；正文：Inter Light / Noto Sans SC Light'],
      ['布局风格', '大留白、不对称网格、图文穿插、编辑排版质感'],
      ['首页', '全屏 Unsplash 印象派画作 + radial-gradient 暗角 + 诗意文案 + 延迟入场动画'],
      ['登录页', 'backdrop-filter: blur(40px) 毛玻璃卡片 + 底线输入框 + 描边空心按钮'],
      ['工具选择', '双卡片 280×320px + hover translateY(-8px) + 金铜色边框光晕 + ripple 过渡'],
    ],
    [colW(3), colW(12)],
  ),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── Chapter 3 ───
const ch3 = [
  ...h1('第三章  系统技术架构'),
  h2('3.1 整体架构图'),
  p('平台采用前后端分离的微服务架构，分为四个核心层次：'),
  makeTable(
    ['架构层', '技术栈', '职责'],
    [
      ['前端层', 'React 19 + TypeScript + Vite 8 + Tailwind CSS 4', '统一壳应用、Tab 工作区管理、着陆页/登录/工具选择'],
      ['AI 设计服务', 'Python FastAPI + DashScope API (通义)', 'AI 对话生图、图片编辑、虚拟试穿、Prompt 增强'],
      ['趋势分析服务', 'Python FastAPI + Playwright + LiteLLM + SQLite', '网站爬取、文章存储、LLM 趋势分析、报告生成'],
      ['外部服务', 'DeepSeek API / DashScope API / Unsplash', 'LLM 推理、图像生成、配图搜索'],
    ],
    [colW(3), colW(5.5), colW(6.5)],
  ),
  p('前端通过 Vite 代理将 /api/design/* 转发至设计服务（端口 8001），/api/trend/* 转发至趋势服务（端口 8002），实现统一入口。'),

  h2('3.2 核心技术流程详解'),
  h3('流程一：用户登录认证'),
  bullet('注册：前端表单校验（邮箱格式、密码强度 8 位+字母+数字、二次确认）→ localStorage 多账号存储'),
  bullet('登录：账号匹配 → 密码验证 → 生成 Token（含 7 天过期时间戳）→ 存入 af_token'),
  bullet('路由守卫：App 组件初始化时检查 af_token 有效性，过期则重定向至登录页'),
  bullet('退出：清除 af_user + af_token → 返回着陆页'),

  h3('流程二：趋势报告生成与智能配图'),
  p('这是平台最核心的技术流程，涉及多步 LLM 调用和异步处理：'),
  bullet('步骤 1 — 文章爬取：Playwright 访问 Vogue China 的 5 个入口 URL（fashion/trend/runway/street-style/shopping），提取文章链接并逐篇抓取标题、正文、图片、发布时间'),
  bullet('步骤 2 — 质量门控：多因子打分系统（时尚语义相关度 0-60 分 + 趋势证据丰富度 0-55 分），筛选最有分析价值的文章'),
  bullet('步骤 3 — 季节分桶：根据标题中的季节关键词（SS/FW/Resort/Cruise/Pre-Fall），将文章分组到对应季节桶'),
  bullet('步骤 4 — 并行 LLM 摘要：使用 asyncio.Semaphore(3) 并行调用 DeepSeek，每次 3 篇文章同时摘要（较串行提速 3 倍）'),
  bullet('步骤 5 — 聚合分析：将所有文章摘要合并送入 LLM，生成包含 7 维度 + 4 板块的结构化 JSON 报告'),
  bullet('步骤 6 — 智能配图：LLM 在 description 字段中插入 {{IMAGE: keyword | description | position}} 标记，前端正则解析后调用 Unsplash API 注入语义相关图片'),
  bullet('步骤 7 — 报告对齐：Jaccard 相似度算法对齐相邻报告的趋势命名，减少跨期命名漂移'),

  h3('流程三：热词云图渲染'),
  bullet('获取 /api/trends/hot 热词数据（频次 + 维度分类）'),
  bullet('权重归一化：fontSize = (16 + weight × 64) × scaleFactor'),
  bullet('SVG 螺旋布局：Archimedean spiral，步长 3px，角度步长 0.25 rad，碰撞检测避免重叠'),
  bullet('入场动画：每词延迟 15ms 的 CSS fadeIn（opacity 0→0.9 + scale 0.8→1）'),
  bullet('Hover 事件：聚焦词 scale 1.15 + tooltip 浮层；其余词 opacity 0.2'),
  bullet('Click 事件：调用 showKwTimeline() 展示近 2 年 730 天的时间线数据'),
  bullet('ResizeObserver：容器尺寸变化时 200ms debounce 后重绘'),

  h3('流程四：文章库图片匹配'),
  bullet('优先级 1：使用 images 表中 article_key 关联的第一张图片 original_url'),
  bullet('优先级 2：若 URL 失效（onerror 触发），显示分类占位图（文章标题首字 + 分类配色）'),
  bullet('分类配色映射：fashion → #C9A96E, trend → #7C2D3A, runway → #2D6A5A, street-style → #C45C48'),
  bullet('使用 referrerpolicy="no-referrer" 避免 Vogue CDN 403 错误'),

  h2('3.3 LLM Prompt 工程设计'),
  p('趋势分析的 Prompt 采用「角色设定 + 方法论约束 + 维度规范 + 输出 Schema」的四层架构：'),
  bullet('System Prompt（800+ 字）：设定"资深时尚趋势分析师"角色，8 条方法论原则（交叉验证、证据优先、推断边界、商业启示等）'),
  bullet('维度要求：明确 7 个分析维度 + 4 大核心板块的结构与详细程度下限'),
  bullet('JSON Schema Hint：完整的输出格式示例，包含 key_trends、style_details、item_details、silhouette_details、color_details'),
  bullet('{{IMAGE}} 标记协议：LLM 可在 description 末尾插入 {{IMAGE: <英文关键词> | <用途说明> | 段后}}，前端解析后替换为 Unsplash 配图'),
  bullet('批次上下文注入：build_batch_context_block() 动态注入文章篇数、来源站点、时间跨度、季节归类'),

  h2('3.4 前端工程化与性能优化'),
  makeTable(
    ['优化项', '实现方式', '效果'],
    [
      ['图片懒加载', 'loading="lazy" + onerror 降级', '首屏不加载屏外图片，减少带宽'],
      ['词云渲染', 'SVG 螺旋布局 + CSS 动画', '< 800ms 完成 80 词渲染'],
      ['报告图文分离', '文字先渲染，{{IMAGE}} 图片异步注入', '用户立即看到文字，图片后续填充'],
      ['响应式适配', 'CSS 断点 768px/480px + clamp() 字号', '桌面/平板/手机三端适配'],
      ['离线检测', 'navigator.onLine + 顶部 Banner', '网络断开时明确提示'],
      ['状态管理', 'React useState + localStorage Token', '轻量级，无额外依赖'],
    ],
    [colW(3), colW(5.5), colW(6.5)],
  ),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── Chapter 4 ───
const ch4 = [
  ...h1('第四章  创新亮点总结'),
  spacer(60),
  makeTable(
    ['创新点', '技术实现', '行业价值'],
    [
      ['LLM 自主决策配图', '{{IMAGE}} 标记协议 + 正则解析 + Unsplash API', '报告不再是纯文字墙，图文深度融合提升可读性和说服力'],
      ['并行 LLM 分析加速', 'asyncio.gather + Semaphore 并发控制', '66 篇文章分析从 33 分钟降至 11 分钟，效率提升 3 倍'],
      ['沉浸式艺术 UI 体系', '印象派画作 + 毛玻璃 + 金铜色系 + 衬线字体', '打破 BI 工具"数据冷感"，让时尚从业者愿意使用的分析工具'],
      ['交互式热词云图', 'SVG 螺旋布局 + Hover 聚焦 + ResizeObserver 自适应', '从静态表格到可探索的视觉化热词地图，降低趋势发现门槛'],
      ['完整用户体系', 'localStorage 多账号 + 7 天 Token + 路由守卫', '无后端数据库依赖的完整认证流程，适合快速部署'],
      ['多模态趋势分析', 'Playwright 爬取 + DeepSeek LLM + 7 维度 JSON Schema', '从原始网页到结构化趋势报告的全自动分析管线'],
      ['一键启动架构', 'Python start.py 多进程管理 + Vite 代理', '单条命令启动前端 + 2 个后端服务，开发者体验友好'],
    ],
    [colW(3.5), colW(5), colW(6.5)],
  ),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── Chapter 5 ───
const ch5 = [
  ...h1('第五章  项目展望'),
  h2('5.1 后续功能规划'),
  bullet('AI 风格推荐引擎：基于趋势分析结果自动生成设计 Prompt 建议，实现「趋势 → 设计」的闭环联动'),
  bullet('多人协作设计空间：WebSocket 实时协作画布，支持设计团队在同一画布上同步创作和评审'),
  bullet('趋势报告对比功能：可视化对比不同季节、不同时间段的趋势报告，追踪关键词和维度的变化轨迹'),
  bullet('素材库与灵感管理：统一管理 AI 生成的设计素材，支持打标签、收藏、导出为设计 Brief'),
  bullet('多数据源扩展：接入 Vogue International、WWD、Business of Fashion 等全球时尚媒体，提升趋势分析的全面性'),

  h2('5.2 商业化路径探索'),
  p('平台具备清晰的商业化路径：'),
  bullet('SaaS 订阅模式：基础版（趋势浏览）免费，专业版（AI 设计 + 深度分析）按月/年订阅'),
  bullet('企业定制方案：为品牌和零售企业提供私有化部署、定制数据源和专属 LLM 微调'),
  bullet('API 服务：开放趋势分析 API，供第三方工具和平台集成'),
  bullet('内容授权：将 AI 生成的趋势报告以内容产品形式授权给媒体和研究机构'),

  h2('5.3 结语'),
  p('时尚是关于美的永恒追问，技术是实现美的新途径。时尚智能平台不仅是一个工具，更是一种理念——让每一位时尚从业者都能站在 AI 的肩膀上，更快地捕捉灵感、更准确地理解趋势、更自由地表达创意。'),
  p('我们相信，当最先进的人工智能技术以最优雅的方式呈现时，它不会替代设计师的创造力，而是成为创造力最忠实的伙伴。在布料的褶皱间，在数据的脉搏中，在代码的逻辑里，时尚与技术终将汇聚成同一条河流——流向更美好的未来。', { italic: true }),
];

// ─── Build Document ───
const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '\u2022',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, bottom: 1440, left: 1800, right: 1800 },
        pageNumbers: { start: 1 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({ text: '时尚智能平台', size: 16, font: 'Arial', color: C.gray }),
            new TextRun({ children: [new Tab()] }),
            new TextRun({ text: 'Fashion AI Platform 技术文档', size: 16, font: 'Arial', color: C.gray, italics: true }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'Fashion AI Platform © 2025', size: 16, font: 'Arial', color: C.lightGray }),
            new TextRun({ children: [new Tab()] }),
            new TextRun({ text: '第 ', size: 16, font: 'Arial', color: C.lightGray }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: C.lightGray }),
            new TextRun({ text: ' 页', size: 16, font: 'Arial', color: C.lightGray }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })],
      }),
    },
    children: [
      ...coverPage,
      ...tocPage,
      ...ch1,
      ...ch2,
      ...ch3,
      ...ch4,
      ...ch5,
    ],
  }],
});

// ─── Generate ───
const outDir = 'G:/fashion design/docs';
const outPath = `${outDir}/fashion_ai_platform_intro.docx`;
fs.mkdirSync(outDir, { recursive: true });
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log(`Document generated: ${outPath}`);
console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
