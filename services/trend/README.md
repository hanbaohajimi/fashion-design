# AI Fashion — 时尚趋势数据流水线

生产级 Python 数据流水线，支持多站点抓取、图文 LLM 分析、趋势报告生成，每 24 小时自动运行。

---

## 项目目录结构

```
ai_fashion/
├── main.py                    # CLI 入口
├── config.py                  # 全局配置
├── models.py                  # 所有 Pydantic 数据模型
├── scraper.py                 # 多站点 Playwright 爬虫
├── processor.py               # 图文预处理
├── llm_analyzer.py            # LLM 趋势分析
├── storage.py                 # 持久化（SQLite/JSON/Markdown）
├── scheduler.py               # APScheduler 调度
├── utils.py                   # 工具函数（日志/文本/下载/重试等）
├── site_configs/
│   ├── loader.py              # 站点配置加载器
│   └── example_sites.yaml    # 多站点配置模板（填写后使用）
├── prompts/
│   └── trend_analysis.py     # LLM Prompt 模板（多模态 + 纯文本）
├── data/
│   ├── images/{date}/        # 下载的图片
│   ├── raw/                  # 原始抓取 JSON
│   └── reports/              # 报告 JSON
├── output/                   # Markdown 趋势报告
├── logs/                     # 日志文件
├── storage/                  # SQLite 数据库
├── storage_states/           # Playwright 登录状态
├── (配置已统一到项目根 .env)   # 详见项目根 env.example
├── pyproject.toml
├── Dockerfile
└── docker-compose.yml
```

---

## 快速开始

### 1. 安装依赖

```bash
cd /g/ai_fashion

# 推荐使用虚拟环境
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

pip install -e .
playwright install chromium
```

### 2. 配置环境变量

趋势服务的配置已统一到**项目根目录** `.env` 文件（与设计服务共用）：

```bash
# 在项目根目录执行
cp env.example .env
# 编辑 .env，填写：
#   - 设计 AI: AMUX_API_KEY（api.amux.ai）
#   - 趋势 LLM: LLM_PROVIDER / LLM_MODEL / API_KEY（platform.deepseek.com）
#   - 趋势搜索: QWEN_API_KEY（可选，dashscope.aliyuncs.com）
```

`config.py` 通过 `env_file` 自动读取根 `.env`，无需在 `services/trend/` 下单独创建。

### 3. 配置站点

```bash
cp site_configs/example_sites.yaml site_configs/sites.yaml
# 编辑 sites.yaml，填写目标站点的 URL 和 CSS 选择器
```

### 4. 校验配置

```bash
python main.py validate-config
```

### 5. 运行

```bash
# 立即运行一次（抓取 + 分析）
python main.py run-once

# 只抓取，不分析（用于调试爬虫）
python main.py crawl-only

# 只分析最近一次已抓取数据
python main.py analyze-latest

# 启动 24H 定时调度（前台运行）
python main.py schedule

# 首次登录某站点（适用于需要登录的网站）
python main.py login --site MySiteName
```

---

## 登录站点处理

对于需要登录的网站，推荐使用 **storage_state** 方案：

1. 在站点配置中设置 `use_login: true` 和 `storage_state_path`
2. 首次运行 `python main.py login --site <SiteName>`
3. 在弹出的浏览器中手动完成登录
4. 按 ENTER，登录状态自动保存为 JSON 文件
5. 后续所有任务自动复用该登录状态

**登录态失效时**，流水线会：
- 记录错误日志并打印提示
- 跳过该站点，继续其他站点
- 不影响整体任务完成

---

## LLM 配置

支持多种 Provider（通过 LiteLLM 统一适配）：

| Provider    | LLM_PROVIDER | LLM_MODEL 示例                   |
|-------------|-------------|----------------------------------|
| OpenAI      | `openai`    | `gpt-4o`                        |
| Anthropic   | `anthropic` | `claude-3-5-sonnet-20241022`    |
| 本地模型    | `local`     | `llama3` (需要 Ollama 运行)     |

多模态支持（图片分析）在以下模型上自动开启：`gpt-4o`、`claude-3-*`、`gemini-*` 等。

---

## Web 控制台与 API

趋势服务由项目根 `start.py` 一键启动（端口 8002），或单独启动：

```bash
cd services && python trend_runner.py     # port 8002
```

常用端点：

| 路径 | 说明 |
|------|------|
| `GET /` | 前端单页应用 |
| `GET /health` 或 `GET /api/health` | 健康检查（数据库可读） |
| `GET /api/meta` | 公开元信息（版本、是否已配置 LLM、时区等，不含密钥） |
| `GET /api/stats` | 仪表盘统计 |
| `POST /api/pipeline/trigger` | 触发流水线（请求体 `{"mode":"full"\|"crawl_only"\|"analyze_only"}`） |

**僵尸任务恢复**：进程崩溃可能导致 `task_runs` 长期停留在 `running`，从而无法再次触发流水线。API 进程启动时会按 `STALE_TASK_RECOVERY_MINUTES`（默认 240，`.env` 中可改；设为 `0` 关闭）将超时未结束的任务标记为失败。仅 CLI `main.py schedule` / `run-once` 时不会执行此恢复，可改跑一遍 API 或自行更新数据库。

---

## Docker 部署

```bash
# 构建并启动（后台运行）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 手动触发一次
docker exec ai_fashion_pipeline python main.py run-once
```

---

## 存储说明

| 存储类型 | 内容 | 路径（均相对于项目根） |
|---------|------|------|
| SQLite  | 文章、图片映射、任务记录、报告索引 | `services/trend/storage/fashion_pipeline.db` |
| JSON    | 原始抓取结果 | `services/trend/data/raw/crawl_*.json` |
| JSON    | 趋势报告数据 | `services/trend/data/reports/report_*.json` |
| Markdown| 人可读趋势报告 | `services/trend/output/trend_report_*.md` |
| 图片    | 下载的图片文件 | `services/trend/data/images/{日期}/` |

---

## 反爬合规说明

1. **robots.txt**：默认开启 `RESPECT_ROBOTS_TXT=true`，每次访问前检查权限
2. **访问速率**：每次请求间随机延迟（1.5~4.0 秒，可配置）
3. **并发控制**：`MAX_CONCURRENCY=3`，避免同时大量请求
4. **User-Agent**：使用真实浏览器 UA
5. **强反爬站点**：推荐合规降级方案 —— RSS、官方 API、Sitemap、手动导入
6. **不实现**：验证码绕过、Cloudflare 绕过、风控规避（违反服务条款）
7. **登录站点**：仅通过合法授权会话（用户自行登录后保存的 cookie）访问

---

## 上下文超限处理策略

| 场景 | 策略 |
|------|------|
| 单篇文章过长 | 按段落分块 → 逐块摘要 → 聚合分析 |
| 多篇文章过多 | 逐篇先做摘要 → 再全局趋势综合 |
| 图片过多 | 过滤噪声图，保留首图+正文重点图，限制 `MAX_IMAGES_PER_ARTICLE` |
| 纯文本模型 | `IMAGE_INPUT_MODE=none`，图片转 OCR 文字或 metadata 描述 |

---

## cron 部署（不用 Docker）

```cron
# 每天 09:00 运行（北京时间）
0 9 * * * cd /path/to/fashion-design && /path/to/.venv/bin/python services/trend/main.py run-once >> services/trend/logs/cron.log 2>&1
```

---

## GitHub Actions

见 `.github/workflows/pipeline.yml`。需在仓库 Secrets 中配置：
- `LLM_PROVIDER`
- `LLM_MODEL`
- `API_KEY`