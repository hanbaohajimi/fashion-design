# 系统架构说明

## 1. 架构概览

AI Fashion Design Platform 是一个面向本地运行的 AI 时尚设计平台，采用：

- React 统一前端壳层
- 两个独立 FastAPI 后端服务
- 两套职责隔离的 SQLite 数据库
- amux.ai 图像与对话模型
- LiteLLM 趋势分析模型适配层
- Playwright 时尚资讯采集流水线

整体属于轻量服务化架构，而不是完整微服务集群：

```text
Browser
  │
  ▼
React + Vite :3100
  ├── /api/design/* ───────────────► Design Studio :8001
  │                                  ├── AI Agent / Tool Calling
  │                                  ├── 图像生成、编辑、试衣
  │                                  ├── 用户画像、作品库、衣橱
  │                                  └── profiles.db
  │
  ├── /api/trend/* ────────────────► Trend Analysis :8002
  ├── /ws/pipeline ────────────────► ├── Playwright 抓取
  │                                  ├── 文章过滤、季节分桶
  │                                  ├── LiteLLM 趋势分析
  │                                  └── fashion_pipeline.db
  │
  └── iframe http://localhost:8002 ─► 趋势服务原生分析界面

Design Studio :8001
  └── 每小时读取 Trend Analysis 最新报告，将趋势同步到 profiles.db
```

## 2. 设计原则

1. **统一体验**：设计、试衣、衣橱和趋势能力通过一个 React 应用访问。
2. **服务隔离**：设计服务与趋势服务独立运行，通过 HTTP API 通信。
3. **数据分域**：用户资产与趋势采集数据分别存储，不直接共享数据库。
4. **配置集中**：端口、API Key 和模型配置统一从项目根目录 `.env` 读取。
5. **能力降级**：完整后端无法加载时，启动器可回退到 Stub 服务。
6. **任务可观测**：长时间趋势任务将阶段、进度和结果持续写入数据库。
7. **配置驱动扩展**：趋势站点通过 YAML/JSON 配置接入，减少对调度代码的修改。

## 3. 进程与启动架构

正式统一入口是项目根目录的 `start.py`：

```text
start.py
  ├── services/design/run.py
  │     └── uvicorn Design Studio，端口 8001
  ├── services/trend_runner.py
  │     └── uvicorn Trend Analysis，端口 8002
  └── npx vite
        └── React Frontend，端口 3100
```

`start.py` 还负责：

- 加载根目录 `.env`
- 安装缺失的前端依赖
- 汇总三个子进程的标准输出
- 检查服务端口
- 在收到退出信号时停止所有子进程

### Stub 降级

两个服务启动器都支持 `auto/full/stub` 三种行为：

- `auto`：优先加载完整服务，导入失败时回退 Stub
- `full`：必须加载完整服务，失败即退出
- `stub`：强制使用占位服务

对应变量：

```env
FASHION_DESIGN_USE_STUB=auto
FASHION_TREND_USE_STUB=auto
```

Stub 只用于保持端口和健康检查可用，不提供真实 AI 能力。

## 4. 前端架构

### 4.1 顶层页面状态

`frontend/src/App.tsx` 管理三个页面阶段：

```text
LandingPage
  └── AuthPage
        └── MainApp
```

登录成功后，服务端返回随机生成的短期 `auth_token`。前端仅在当前标签页的
`sessionStorage` 中保存会话，页面启动时会向服务端校验。后续请求统一使用
`Authorization: Bearer <token>`，不再把 Token 放入业务请求体。

### 4.2 工作区系统

`frontend/src/pages/MainApp.tsx` 是统一工作区壳层，默认创建：

```text
MainApp
  ├── Design Studio
  ├── Try-On
  ├── Wardrobe
  └── Trends Hub
        ├── 趋势探索
        └── 趋势分析
```

工作区使用：

- `React.lazy` 按需加载
- `Suspense` 展示加载状态
- `ErrorBoundary` 隔离模块异常
- 多 Tab 管理多个工作上下文
- 首次加载后保持挂载，切换 Tab 时不销毁模块状态

### 4.3 模块职责

#### Design Studio

- AI 对话与多轮工具调用
- Fabric.js 可视化画布
- 图片上传、生成、编辑与局部蒙版修改
- 个人模式与设计师项目模式
- 用户画像和趋势上下文注入
- 生成结果保存到作品库或衣橱

#### Try-On

- 从衣橱或预设中选择衣物
- 选择模特、背景、动作和美发选项
- 多图参考虚拟试衣
- 试衣历史暂存在 `sessionStorage`
- 将试衣结果保存为 Outfit

#### Wardrobe

- 上传和管理衣物
- AI 分类、颜色、材质和风格标签
- 从趋势或设计结果添加衣物
- 创建和管理穿搭组合

#### Trends Hub

- 趋势探索：React 原生趋势卡片与设计入口
- 趋势分析：通过 iframe 嵌入趋势服务自带的 HTML/CSS/JS 页面

`LibraryWorkspace.tsx` 仍保留作品库、合集、相似图和穿搭推荐能力，但当前没有作为
`MainApp` 的独立主导航入口。

## 5. 前端与后端通信

Vite 开发服务器使用反向代理统一 API 地址：

| 前端路径 | 目标服务 | 转换后路径 |
|---|---|---|
| `/api/design/*` | `127.0.0.1:8001` | `/api/*` |
| `/api/images/*` | `127.0.0.1:8001` | 保持原路径 |
| `/api/tryon/*` | `127.0.0.1:8001` | 保持原路径 |
| `/api/trend/*` | `127.0.0.1:8002` | `/api/*` |
| `/ws/*` | `127.0.0.1:8002` | WebSocket |

趋势分析 iframe 不经过 Vite 代理，直接访问 `http://localhost:8002/`。

`vite.config.ts` 中仍保留 `/api/gateway` 到端口 `8000` 的代理配置，但当前
`start.py` 没有启动 Gateway 服务，仓库内也没有独立 Gateway 实现。该配置属于保留接口，
不能视为当前运行架构的一部分。

## 6. Design Studio 服务

### 6.1 Agent 执行流程

设计服务的核心是一个支持函数调用的多轮 Agent：

```text
用户消息
  │
  ├── 用户画像上下文
  ├── 设计师项目上下文
  ├── 当前趋势上下文
  ├── 会话状态快照
  └── 可用图片资源表
  ▼
文本模型判断工具
  ▼
执行图像工具
  ├── 文生图
  ├── 草图生成
  ├── 图片编辑
  ├── 图案迁移
  ├── 模特生成
  └── 虚拟试穿
  ▼
工具结果写回对话历史
  ▼
模型继续调用工具或生成最终回答
```

响应使用 `application/x-ndjson` 流式返回，事件类型包括：

- `status`
- `image`
- `message`
- `error`
- `done`

### 6.2 AI 客户端

`services/design/ai_clients.py` 通过 amux.ai 的 OpenAI 兼容接口访问模型：

- 文本与视觉：`AMUX_TEXT_MODEL`
- 图像生成与编辑：`AMUX_IMAGE_MODEL`
- 无参考图时使用 image generation
- 有参考图时使用 image edit
- 多参考图用于虚拟试衣和图案迁移

### 6.3 会话状态

设计对话会话由进程内 `Session` 对象管理，主要保存：

- 对话历史
- 当前服装图
- 当前模特图
- 当前试衣图
- 上传资源
- 生成图片
- 收藏和统计

会话默认有效期为 4 小时。服务重启后，内存会话历史不会自动恢复。

### 6.4 用户数据与异步增强

生成图片后，服务会异步执行：

1. 保存作品库记录
2. 调用视觉模型生成标签
3. 检测作品与趋势的匹配关系
4. 在指定数量阈值生成智能合集
5. 根据用户历史更新个人画像或设计师画像

这些操作采用 fire-and-forget 方式，不阻塞当前聊天流。

## 7. Trend Analysis 服务

### 7.1 趋势流水线

核心流程位于 `services/trend/scheduler.py`：

```text
加载站点配置
  ▼
收集入口页候选链接
  ▼
Playwright 抓取正文、图片和发布时间
  ▼
文章去重与入库
  ▼
时尚相关性和证据质量过滤
  ▼
按年份和季节分桶
  ▼
LLM 逐篇提取趋势洞察
  ▼
聚合季节趋势报告
  ▼
保存 SQLite / JSON / Markdown
```

当前正式站点配置位于 `services/trend/site_configs/vogue_cn.yaml`。站点加载器支持
YAML、YML 和 JSON，因此后续可以通过新增配置文件接入其他站点。

### 7.2 LLM 分析

`services/trend/llm_analyzer.py` 使用 LiteLLM 适配：

- OpenAI
- Anthropic
- DeepSeek
- 本地 Ollama 或兼容接口

分析模块支持：

- 文本和多模态输入
- 文章分块和逐篇摘要
- JSON 结构化输出
- 超时、限流和网络重试
- Token 用量记录
- 图片 URL 校验、对齐和证据回填

### 7.3 长任务执行与 Windows 兼容

趋势 API 在独立线程中创建新的事件循环执行 Playwright 流水线。Windows 下显式使用
`WindowsProactorEventLoopPolicy`，避免 Playwright 子进程与 FastAPI 主事件循环冲突。

API 每 3 秒从数据库读取任务进度，并通过 `/ws/pipeline` 广播：

- started
- progress
- paused
- resumed
- completed
- error

流水线支持暂停、恢复、失败重试和遗留任务恢复。

## 8. 数据存储

### 8.1 Design Studio 数据库

路径：

```text
services/design/data/profiles.db
```

主要数据：

- 用户与认证会话（数据库仅保存 Token 的 SHA-256 摘要）
- 个人画像
- 设计师项目
- 对话会话索引
- 作品库
- 收藏与合集
- 趋势副本
- 数字衣橱
- Outfit

图片文件保存在 `services/design/outputs/`。

### 8.2 Trend Analysis 数据库

路径：

```text
services/trend/storage/fashion_pipeline.db
```

主要数据：

- 抓取文章
- 文章图片映射
- 流水线任务状态
- 进度阶段
- 趋势报告索引
- 订阅信息

趋势报告还可根据 `STORE_BACKEND` 配置写入 JSON 和 Markdown。

### 8.3 数据边界

两个服务不共享数据库。设计服务通过 HTTP 请求趋势服务的最新报告，并将适合设计场景的
趋势数据转换后写入自己的 `trends` 表。

## 9. 趋势到设计的数据闭环

设计服务启动后会每小时请求：

```text
GET http://127.0.0.1:8002/api/reports/latest
```

同步后的趋势可以：

- 在趋势探索页面展示
- 被用户收藏
- 加入设计师项目
- 创建带趋势上下文的设计会话
- 与个人画像共同影响 Agent 的设计方向
- 用于检测作品和趋势的匹配度

完整闭环如下：

```text
时尚资讯抓取
  → 趋势分析
  → 趋势探索
  → AI 辅助设计
  → 作品库与数字衣橱
  → 虚拟试衣
  → 用户行为和偏好沉淀
  → 下一次个性化设计
```

## 10. 状态与异常隔离

### 前端状态

- 登录状态：`sessionStorage`，并以服务端会话校验结果为准
- 工作区 Tab：`MainApp` 内部状态
- 设计画布：Fabric.js 实例和 React 状态
- 设计对话：React 状态与后端内存 Session
- 试衣选择和最近历史：`sessionStorage`
- 趋势分析页面：iframe 内部独立状态

### 异常隔离

```text
App ErrorBoundary
  └── MainApp
        ├── Workspace ErrorBoundary: Design Studio
        ├── Workspace ErrorBoundary: Try-On
        ├── Workspace ErrorBoundary: Wardrobe
        └── Workspace ErrorBoundary: Trends Hub
              └── iframe: Trend Analysis
```

一个 React 工作区异常不会直接导致其他工作区卸载。趋势原生页面通过 iframe 获得额外的
JavaScript 和样式隔离。

## 11. 配置管理

项目只使用根目录 `.env`：

```text
fashion-design/.env
```

主要配置分组：

| 分组 | 关键变量 |
|---|---|
| 前端 | `FASHION_FRONTEND_PORT` |
| 设计服务 | `AMUX_API_KEY`、`AMUX_TEXT_MODEL`、`AMUX_IMAGE_MODEL` |
| 趋势模型 | `LLM_PROVIDER`、`LLM_MODEL`、`API_KEY`、`LLM_BASE_URL` |
| 搜索增强 | `QWEN_API_KEY`、`QWEN_MODEL`、`QWEN_BASE_URL` |
| 服务切换 | `FASHION_DESIGN_USE_STUB`、`FASHION_TREND_USE_STUB` |
| 安全与会话 | `CORS_ALLOWED_ORIGINS`、`AUTH_IDLE_TIMEOUT_MINUTES`、`AUTH_ABSOLUTE_TIMEOUT_HOURS` |

启动器将 `.env` 注入 `os.environ`。趋势服务的 Pydantic Settings 同时将根 `.env` 作为
独立运行时的 fallback。

## 12. CORS 与安全边界

两个 FastAPI 服务统一从根目录 `.env` 读取明确的来源白名单：

```python
allow_origins=_cors_origins
allow_credentials=False
allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
allow_headers=["Authorization", "Content-Type"]
```

默认只允许 `http://localhost:3100` 和 `http://127.0.0.1:3100`。部署时通过
`CORS_ALLOWED_ORIGINS` 设置实际前端来源，多个来源使用英文逗号分隔。

生产部署应改为明确白名单，例如：

```env
CORS_ALLOWED_ORIGINS=https://fashion.example.com,https://www.fashion.example.com
```

并限制：

- 允许的 Origin
- HTTP 方法
- 请求头
- 是否允许 Cookie 等凭证

当前认证安全边界：

- 密码使用 Argon2id 自带随机盐进行哈希
- 登录 Token 使用密码学安全随机数生成，数据库仅保存 Token 摘要
- 服务端同时执行空闲超时和绝对过期校验
- 注销会在服务端撤销当前会话，也支持撤销该用户全部会话
- 除注册、登录、健康检查和必要的静态图片外，设计服务 API 默认要求 Bearer Token
- CORS 使用明确来源、方法和请求头白名单，不使用 Cookie 凭证

公网部署仍需在入口层启用 HTTPS，并结合反向代理、限流和安全日志。

## 13. 端口分配

| 端口 | 服务 | 是否由 `start.py` 启动 |
|---|---|---|
| 3100 | React + Vite | 是 |
| 8001 | Design Studio | 是 |
| 8002 | Trend Analysis | 是 |
| 8000 | Gateway 保留代理目标 | 否 |

正式启动应通过 `start.py`、`services/design/run.py` 和
`services/trend_runner.py`。直接运行 `server.py` 或 `api.py` 时，也会分别读取
`DESIGN_STUDIO_PORT` 和 `TREND_ANALYSIS_PORT`，默认使用 `8001` 和 `8002`。

## 14. 日志与可观测性

- Frontend：浏览器 Console 与 ErrorBoundary
- Design Studio：标准输出和错误堆栈
- Trend Analysis：Loguru，默认写入 `services/trend/logs/`
- Trend Pipeline：任务阶段、百分比、耗时、Token 和错误写入 `task_runs`
- Launcher：为各子进程输出添加服务名前缀

## 15. 当前架构边界

当前实现仍是单机优先架构：

- 内存 Session 无法跨进程共享
- 后台异步任务没有独立消息队列
- 两个 SQLite 数据库适合单机和中小数据量
- 趋势同步采用定时轮询，不是事件驱动
- 没有实际 Gateway、统一鉴权服务或集中日志系统
- 前端主要依赖 Vite 开发代理，生产部署需要单独配置反向代理

如果未来需要公网或多实例部署，应进一步引入：

- 反向代理与 HTTPS
- 根据部署规模将 Session 状态迁移到 Redis 或集中式数据库
- Redis 或其他共享状态存储
- PostgreSQL
- 后台任务队列
- 集中日志与指标监控
- 在反向代理层同步维护 CORS 与安全响应头策略
