# AI Fashion Design Platform

统一的 AI 时尚设计平台，融合 **AI 设计创作**、**趋势分析**、**素材库**与**趋势探索**四大工作区，采用 Editorial Dark（编辑性暗色）视觉系统。

## 界面预览

设计风格参考 System Magazine × SSENSE × Celine Studio，字体组合 Cormorant Garamond（标题）+ DM Sans（UI），以深色 `#080808` 为底，`#C9A96E` 金色为点缀。

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                  Frontend — React 19 + Vite                  │
│                     http://localhost:3100                      │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────┐  ┌──────────┐ │
│  │ AI 设计    │  │ 趋势分析   │  │ 我的库  │  │ 趋势探索 │ │
│  │ 工作台     │  │ 中心       │  │         │  │          │ │
│  └────────────┘  └────────────┘  └─────────┘  └──────────┘ │
└───────┬────────────────────┬────────────────────────────────┘
        │                    │
   /api/design/*        /api/trend/*
        │                    │
┌───────▼──────────┐  ┌──────▼──────────────────────────────┐
│  Design Studio   │  │  Trend Analysis Service             │
│  localhost:8001  │  │  localhost:8002                     │
│                  │  │                                     │
│  DashScope APIs  │  │  Playwright 爬虫 + DeepSeek LLM    │
│  - 文生图        │  │  - Vogue CN 趋势抓取               │
│  - 图片编辑      │  │  - LLM 趋势报告生成                │
│  - 虚拟试穿      │  │  - 季节/热词分析                   │
│  - 对话生图      │  │  - SQLite 存储                     │
└──────────────────┘  └─────────────────────────────────────┘
```

## 四大工作区

| 工作区 | 功能 |
|--------|------|
| **AI 设计工作台** | 对话生图、画布编辑（Fabric.js）、图片重绘、图案迁移、虚拟试穿、个性化偏好系统 |
| **趋势分析中心** | 爬取趋势文章、LLM 分析报告、季节趋势、热词追踪 |
| **我的库** | 生成图管理、收藏、合集、风格标签、版本链追踪 |
| **趋势探索** | 个性化趋势推荐、趋势卡片、一键带趋势进入设计工作台 |

## 快速启动

### 前置条件

- Python 3.10+（推荐 3.11）
- Node.js 18+
- DashScope API Key（设计服务）
- DeepSeek API Key（趋势分析，可选）

### 安装依赖

```bash
# 前端
cd frontend && npm install

# 设计服务
pip install -r services/design/requirements.txt

# 趋势服务
pip install -r services/trend_requirements.txt
pip install playwright && python -m playwright install chromium
```

### 配置环境变量

```bash
cp env.example .env
```

编辑 `.env`，至少填写：

```env
DASHSCOPE_API_KEY=your_key_here   # 设计服务 AI 能力
```

### 启动

```bash
# 一键启动全部服务
python start.py
```

或分别启动：

```bash
cd frontend && npm run dev                   # 前端 :3100
cd services/design && python run.py         # 设计服务 :8001
cd services && python trend_runner.py       # 趋势服务 :8002
```

### 访问

| 服务 | 地址 |
|------|------|
| 统一前端 | http://localhost:3100 |
| 设计服务 API | http://localhost:8001 |
| 趋势服务 API | http://localhost:8002 |

## 目录结构

```
fashion-design/
├── start.py                      # 一键启动
├── env.example                   # 环境变量模板
├── frontend/
│   └── src/
│       ├── App.tsx               # 路由 + 鉴权
│       ├── index.css             # Editorial Dark 设计系统
│       ├── pages/
│       │   ├── LandingPage.tsx   # 首页
│       │   ├── AuthPage.tsx      # 登录/注册
│       │   ├── ToolSelector.tsx  # 工作区选择
│       │   └── MainApp.tsx       # 主应用 Shell（多 Tab）
│       ├── modules/
│       │   ├── design-studio/    # AI 设计工作台
│       │   │   ├── DesignStudioWorkspace.tsx
│       │   │   └── components/   # ChatPanel, DesignCanvas, FabricEditor …
│       │   ├── trend-analysis/   # 趋势分析中心（iframe 嵌入 :8002）
│       │   ├── library/          # 我的库
│       │   └── trends/           # 趋势探索
│       ├── api/                  # profileApi（个性化接口）
│       ├── types/                # profile.ts 等共享类型
│       └── components/           # ErrorBoundary, Toast
├── services/
│   ├── design/                   # 设计服务（FastAPI, :8001）
│   │   ├── server.py             # 主应用（DashScope APIs）
│   │   └── run.py                # 启动器（含 stub 降级）
│   ├── trend/                    # 趋势服务（FastAPI, :8002）
│   │   ├── api.py                # HTTP 端点
│   │   ├── scheduler.py          # 管道调度
│   │   ├── scraper.py            # Playwright 爬虫
│   │   ├── llm_analyzer.py       # DeepSeek LLM 分析
│   │   ├── storage.py            # SQLite 访问
│   │   └── site_configs/         # Vogue CN 等爬取配置
│   └── _stubs/                   # 降级占位服务
├── docs/                         # 架构与 API 文档
└── scripts/                      # install.bat, start-all.sh 等
```

## 设计系统

本项目使用自定义 Editorial Dark 设计系统，**禁止** Inter/Roboto/system-ui 等通用字体。

### 核心 CSS 变量

```css
--color-void:    #080808   /* 最深背景 */
--color-ground:  #111111   /* 主背景 */
--color-surface: #1A1A1A   /* 卡片/面板 */
--color-gold:    #C9A96E   /* 主强调色 */
--color-ink:     #F2EDE6   /* 主文字 */
--font-display:  'Cormorant Garamond', Georgia, serif
--font-ui:       'DM Sans', -apple-system, sans-serif
```

### 组件类

| 类名 | 用途 |
|------|------|
| `.btn-primary` | 金色背景按钮 |
| `.btn-secondary` | 边框按钮 |
| `.btn-ghost` | 透明文字按钮 |
| `.btn-icon` | 32×32px 图标按钮 |
| `.tag` | 通用标签 |
| `.tag-trend` | 趋势标签（带 ✦ 前缀） |
| `.tag-user` | 用户自定义标签（蓝色系） |
| `.section-title` | Cormorant Garamond 大标题 |
| `.subsection-title` | 全大写小标题 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 8 |
| 样式 | Tailwind CSS 4 + CSS 自定义属性 |
| 画布引擎 | Fabric.js 7 |
| 后端框架 | FastAPI (Python) |
| AI 能力（设计） | DashScope — wan2.6-t2i, qwen-image-edit-max, qwen-vl-max |
| AI 能力（趋势） | DeepSeek via LiteLLM |
| 数据存储 | SQLite |
| 爬虫引擎 | Playwright |

## Vite 代理规则

```
/api/design/*  →  localhost:8001/api/*
/api/trend/*   →  localhost:8002/api/*
/ws/*          →  localhost:8002  (WebSocket)
```

## 注意事项

- `services/trend/` 内 Python 文件使用裸模块导入（`from config import …`），**不要单独移出该目录**。
- 前端端口为 **3100**，可通过 `.env` 中 `FASHION_FRONTEND_PORT` 修改。
- 编辑 `services/trend/frontend/app.js` 后需运行 `node --check services/trend/frontend/app.js` 验证语法。
