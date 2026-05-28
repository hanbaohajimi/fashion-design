# 系统架构说明

## 设计原则

1. **模块隔离** — 每个功能模块独立运行，互不干扰
2. **低耦合** — 模块间通过 API 通信，不共享内存状态
3. **可扩展** — 新模块只需实现标准接口即可接入
4. **零侵入** — 原始项目代码不做任何修改

## 架构层次

### 前端层

```
React App (统一壳)
├── Tab 管理系统
│   ├── 状态保持（切换不卸载）
│   ├── ErrorBoundary 隔离
│   └── 动态加载
├── 共享组件层
│   ├── Toast 通知
│   ├── ErrorBoundary
│   └── 统一样式变量
└── 工作区模块
    ├── Design Studio (React 组件)
    │   └── 复用原始 TSX 组件
    └── Trend Analysis (iframe 嵌入)
        └── 引用原始 HTML/JS
```

### 后端层

```
服务网格（独立进程）
├── Gateway (port 8000) — 可选，提供服务发现
├── Design Studio (port 8001)
│   └── 引用 `FASHION_DESIGN_BACKEND` 或 `backend/vendor/design-backend`，否则 `G:\时尚平台\backend`
└── Trend Analysis (port 8002)
    └── 引用 `AI_FASHION_BACKEND` 或 `backend/vendor/ai_fashion`，否则 `G:\ai_fashion\ai_fashion`；不可用时为占位服务
```

### 通信架构

```
Browser ──────────────────────────────────────
  │                    │
  │ /api/design/*      │ iframe src
  │ (Vite proxy)       │ (direct)
  ▼                    ▼
Design Studio       Trend Analysis
:8001               :8002
```

前端通过 Vite dev server 的 proxy 配置将 API 请求转发到对应后端服务。

## 状态管理

### 前端状态

- **Tab 状态**：App 级别 useState，管理工作区列表和当前活动 Tab
- **Design Studio 状态**：组件内部 useState，包含画布状态、会话状态
- **Trend Analysis 状态**：iframe 内部独立管理，与主应用完全隔离

### 后端状态

- **Design Studio**：内存中的 Session 对象（与原系统一致）
- **Trend Analysis**：SQLite 数据库（与原系统一致）

## 异常隔离

```
App
├── ErrorBoundary (全局)
│   ├── Tab: Design Studio
│   │   └── ErrorBoundary (模块级)
│   │       └── Design Studio 组件树
│   └── Tab: Trend Analysis
│       └── ErrorBoundary (模块级)
│           └── iframe (完全隔离)
```

任何一个模块的 JavaScript 错误只会被对应的 ErrorBoundary 捕获，不会影响其他模块。

## 端口分配

| 端口 | 服务 | 用途 |
|------|------|------|
| 3100（默认，可改） | Vite Dev Server | 前端开发服务器；`vite.config.ts` 与 `FASHION_FRONTEND_PORT` / `.env` 对齐 |
| 8000 | Gateway | 服务发现（可选） |
| 8001 | Design Studio | AI 设计后端 |
| 8002 | Trend Analysis | 趋势分析后端 |

项目根 `.env`（由 `start.py` 预加载）可配置 `FASHION_DESIGN_BACKEND`、`AI_FASHION_BACKEND`、`FASHION_FRONTEND_PORT` 等，详见根目录 `env.example`。

## 日志系统

- **Gateway**: 标准 uvicorn 日志
- **Design Studio**: print 日志（保持原系统行为）
- **Trend Analysis**: loguru 日志系统（保持原系统行为，输出到 logs/ 目录）
- **前端**: console.error + ErrorBoundary 捕获
