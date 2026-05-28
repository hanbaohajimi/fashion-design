# AI Fashion Design Platform

统一的 AI 时尚设计平台，融合 **AI 设计创作** 与 **时尚趋势分析** 两大核心能力。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Vite)                        │
│                    默认 http://localhost:3100              │
│  ┌───────────────────┐  ┌───────────────────────────┐   │
│  │  AI 设计工作台     │  │  趋势分析中心              │   │
│  │  (Tab 1)          │  │  (Tab 2)                  │   │
│  │  画布 + AI对话     │  │  iframe → localhost:8002   │   │
│  └───────────────────┘  └───────────────────────────┘   │
└──────────────┬───────────────────────────┬──────────────┘
               │                           │
    /api/design/*                  /api/trend/*
               │                           │
┌──────────────▼──────────┐ ┌──────────────▼──────────────┐
│  Design Studio Service  │ │  Trend Analysis Service     │
│  localhost:8001         │ │  localhost:8002              │
│                         │ │                             │
│  - AI 对话生图          │ │  - 网站爬取                  │
│  - 画布编辑            │ │  - LLM 趋势分析              │
│  - 图片重绘            │ │  - 季节趋势                  │
│  - 虚拟试穿            │ │  - 热词追踪                  │
│  - 图案迁移            │ │  - 报告生成                  │
└─────────────────────────┘ └─────────────────────────────┘
```

## 快速启动

### 前置条件

- Python 3.10+（推荐 3.11+）
- Node.js 18+
- **原始后端（二选一配置方式）**
  1. **推荐**：将代码放到本仓库 `backend/vendor/` 下（见下方「环境变量与目录约定」），或  
  2. **沿用旧路径**：自行准备 README 历史路径中的原始项目并安装依赖：  
     - `G:\时尚平台`（`pip install -r backend/requirements.txt`）  
     - `G:\ai_fashion\ai_fashion`（`pip install -e .` 等，以原项目文档为准）

### 环境变量与目录约定

在项目根目录复制 `env.example` 为 `.env`（**勿提交 .env**），可按本机路径设置：

| 变量 | 说明 |
|------|------|
| `FASHION_FRONTEND_PORT` | 前端端口，默认 `3100`（与 `frontend/vite.config.ts` 中 `server.port` 保持一致） |
| `FASHION_DESIGN_BACKEND` | 含 `server.py` 的「时尚平台」backend 目录 |
| `AI_FASHION_BACKEND` | 含 **`api` 包**（`api/`）或 **`api.py`** 的 ai_fashion 根目录 |
| `FASHION_TREND_USE_STUB` | `auto` / `1` / `0`，趋势服务占位与完整模式切换（见 `backend/services/trend-analysis/run.py`） |

未设置 `FASHION_DESIGN_BACKEND` / `AI_FASHION_BACKEND` 时，启动脚本会**自动探测**：

- 设计：`backend/vendor/design-backend/`（需存在 `server.py`）→ 否则 `G:\时尚平台\backend`
- 趋势：`backend/vendor/ai_fashion/…` 或项目根 **`ai_fashion/ai_fashion/`**（含 `api/` 或 `api.py`）→ 否则 `G:\ai_fashion\ai_fashion`；仍不可用则启用内置占位服务（见 `backend/vendor/README.txt`）

### 安装

```powershell
# Windows：一键安装本仓库依赖
.\scripts\install.bat
```

或手动：

```bash
# 前端
cd frontend && npm install

# Gateway（可选）
cd ../backend/gateway && pip install -r requirements.txt

# 趋势占位 / 本地 run 所需
cd ../services/trend-analysis && pip install -r requirements.txt
```

### 启动（Windows）

**方式一：一键启动（推荐）**

```powershell
# 项目根目录（含 start.py 的一层）
python start.py
```

或双击 / 运行：

```text
scripts\start-all.bat
```

**方式二：分别启动（调试用）**

```bash
# 终端 1 - Design Studio
cd backend/services/design-studio
python run.py

# 终端 2 - Trend Analysis
cd backend/services/trend-analysis
python run.py

# 终端 3 - Frontend
cd frontend
npm run dev
```

### 访问

| 服务 | 地址 | 说明 |
|------|------|------|
| 统一前端 | http://localhost:3100（默认，见 `FASHION_FRONTEND_PORT` / `vite.config.ts`） | 主入口；若 3000 被占用请在 `.env` 或 Vite 配置中改端口 |
| 设计服务 | http://localhost:8001 | AI 设计后端 API |
| 趋势服务 | http://localhost:8002 | 趋势分析后端 API（无 ai_fashion 时为占位模式） |

## 目录结构

```
<项目根>/
├── env.example                  # 复制为 .env 配置本机路径与端口
├── start.py                     # 一键启动（前端 + 双后端）
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 主应用 - Tab 工作区系统
│   │   ├── main.tsx              # 入口
│   │   ├── index.css             # 统一样式系统
│   │   ├── components/           # 共享组件
│   │   │   ├── ErrorBoundary.tsx # 错误隔离
│   │   │   └── Toast.tsx         # 通知系统
│   │   └── workspaces/           # 工作区模块
│   │       ├── design-studio/    # AI 设计工作台
│   │       │   ├── DesignStudioWorkspace.tsx
│   │       │   └── components/
│   │       │       ├── ChatPanel.tsx
│   │       │       ├── DesignCanvas.tsx
│   │       │       └── FabricEditor.tsx
│   │       └── trend-analysis/   # 趋势分析中心
│   │           └── TrendAnalysisWorkspace.tsx
│   ├── vite.config.ts            # Vite 配置（含代理）
│   └── package.json
├── backend/
│   ├── vendor/                   # 本地放置原始 backend（见 vendor/README.txt）
│   ├── gateway/
│   │   ├── server.py
│   │   └── requirements.txt
│   └── services/
│       ├── design-studio/        # 设计服务启动器
│       │   └── run.py
│       └── trend-analysis/       # 趋势服务启动器
│           └── run.py
├── scripts/
│   ├── start-all.bat             # Windows 一键启动
│   ├── start-all.sh              # Linux/Mac 一键启动
│   └── install.bat               # 依赖安装
├── docs/
│   ├── ARCHITECTURE.md           # 架构说明
│   ├── API.md                    # API 文档
│   └── MODULES.md                # 模块说明
└── README.md                     # 本文件
```

## 模块说明

### AI 设计工作台 (Design Studio)

| 功能 | 说明 |
|------|------|
| AI 对话生图 | 通过自然语言描述生成时尚设计图 |
| 画布编辑 | Fabric.js 画布，支持图层、文字、形状 |
| 图片重绘 | 局部涂抹 + AI 智能修改 |
| 图案迁移 | 将参考图案应用到服装图上 |
| 虚拟试穿 | 服装 + 模特合成试穿效果 |
| 模特生成 | AI 生成展示模特图 |

### 趋势分析中心 (Trend Analysis)

| 功能 | 说明 |
|------|------|
| 仪表盘 | 全局数据概览 |
| 趋势报告 | LLM 生成的时尚趋势分析报告 |
| 季节趋势 | 按季节分类的趋势视图 |
| 文章库 | 爬取的时尚文章管理 |
| 热词追踪 | 时尚关键词频率与趋势 |

## 原系统关系

| 新平台模块 | 原始项目 | 关系 |
|-----------|----------|------|
| AI 设计工作台 | `G:\时尚平台` 或 `backend/vendor/design-backend` | 通过 `FASHION_DESIGN_BACKEND` / vendor 引用 `server.py` |
| 趋势分析中心 | `G:\ai_fashion` 或 `backend/vendor/ai_fashion` | iframe → :8002；无完整后端时使用占位 API |

**原始项目完整保留，未做任何修改。** 新平台通过引用方式使用原始代码。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| 画布引擎 | Fabric.js 7 |
| 后端框架 | FastAPI (Python) |
| AI 能力 | DashScope (阿里云通义), LiteLLM |
| 数据存储 | SQLite |
| 爬虫引擎 | Playwright |

## 扩展指南

### 添加新工作区模块

1. 在 `frontend/src/workspaces/` 下创建新目录
2. 创建 `XxxWorkspace.tsx` 组件
3. 在 `App.tsx` 的 `WORKSPACE_PRESETS` 中注册新类型
4. 如需后端，在 `backend/services/` 下添加新服务
5. 更新 `vite.config.ts` 代理规则

### 模块隔离保证

- 每个 Tab 使用独立的 React 组件实例，状态不互相污染
- 切换 Tab 时不会卸载已加载的模块（保持状态）
- ErrorBoundary 包裹每个工作区，一个模块崩溃不影响其他模块
- 后端服务独立进程、独立端口，互不干扰
