# AI Fashion Design Platform

AI 驱动的时尚设计平台 — 一站式完成趋势分析、AI 服装设计、试穿预览与衣橱管理。

## 技术栈

| 层 | 技术 |
|------|------|
| 前端 | React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + Fabric.js |
| 设计后端 | FastAPI (Python) — AI 对话生图 / 编辑 / 试穿 |
| 趋势后端 | FastAPI (Python) — 多站点爬取 + LLM 趋势分析 + WebSocket 实时推送 |
| AI 模型 | amux.ai 代理 (GPT Image / Claude / Gemini) + DeepSeek + Qwen 搜索 |

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.11+
- Chromium（由 Playwright 自动安装）

### 安装（隔离环境）

```bash
# 1. 创建 Python 虚拟环境
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 2. 安装后端依赖
pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium

# 3. 安装前端依赖
cd frontend && npm install && cd ..

# 4. 配置 API 密钥
cp env.example .env
# 编辑 .env，填写必填项
```

### 启动

```bash
# 一键启动（Windows）
start-isolated.bat

# 或手动
.venv\Scripts\activate
python start.py
```

访问：
- `http://localhost:3100` — 前端
- `http://localhost:8001/api/health` — 设计服务
- `http://localhost:8002/api/health` — 趋势服务

## 项目结构

```
fashion-design/
├── frontend/               React 前端（端口 3100）
│   └── src/modules/        design-studio / tryon / wardrobe / trends-hub
├── services/
│   ├── design/             FastAPI 设计工作室（端口 8001）
│   ├── trend/              FastAPI 趋势分析（端口 8002）
│   └── _stubs/             存根回退服务
├── .env                    统一配置文件（所有服务的 API Key + 模型参数）
├── env.example             配置模板
├── start.py                一键启动器
└── start-isolated.bat      便捷启动（自动激活 venv）
```

## 配置

所有模型和 API 配置统一在项目根 `.env` 一个文件中：

| 变量 | 服务 | 说明 |
|------|------|------|
| `AMUX_API_KEY` | 设计 | amux.ai API 密钥 |
| `LLM_PROVIDER` | 趋势 | deepseek / openai / anthropic |
| `API_KEY` | 趋势 | DeepSeek API 密钥 |
| `QWEN_API_KEY` | 趋势 | 阿里百炼搜索（可选） |

## 文档

- [系统架构](docs/ARCHITECTURE.md)
- [模块说明](docs/MODULES.md)
- [API 对接](docs/API.md)
- [Claude Code 指南](CLAUDE.md)

## License

MIT
