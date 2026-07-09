# API 对接说明

前端通过 Vite proxy 访问两个后端服务。后端本身的真实路径都以 `/api` 或 `/ws` 开头。

## 代理映射

| 前端请求 | 目标服务 | 重写后路径 |
| --- | --- | --- |
| `/api/design/*` | Design API `8001` | `/api/*` |
| `/api/images/*` | Design API `8001` | `/api/images/*` |
| `/api/tryon/*` | Design API `8001` | `/api/tryon/*` |
| `/api/trend/*` | Trend API `8002` | `/api/*` |
| `/ws/*` | Trend API `8002` | `/ws/*` |

`/api/gateway/*` 在 Vite 配置中保留为预留代理，但当前项目没有独立 Gateway 服务，`start.py` 也不会启动端口 `8000`。

## Design API

当前入口：`services/design/app.py`

兼容入口：`services/design/server.py`

### 健康检查

| 方法 | 后端路径 | 前端代理路径 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | `/api/design/health` | 设计服务健康检查 |

### 认证

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 当前会话登出 |
| POST | `/api/auth/logout-all` | 全部会话登出 |
| GET | `/api/auth/session` | 当前会话 |

### 用户画像与设计项目

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/profile/personal` | 个人画像 |
| POST | `/api/profile/personal/onboarding` | 创建/更新个人画像引导 |
| PATCH | `/api/profile/personal/static` | 更新静态画像字段 |
| POST | `/api/profile/personal/analyze` | 分析个人画像 |
| POST | `/api/profile/personal/confirm` | 确认个人画像 |
| GET | `/api/profile/designer/projects` | 设计项目列表 |
| POST | `/api/profile/designer/projects` | 创建设计项目 |
| PATCH | `/api/profile/designer/projects/{project_id}` | 更新设计项目 |
| DELETE | `/api/profile/designer/projects/{project_id}` | 删除设计项目 |
| POST | `/api/profile/designer/projects/{project_id}/analyze` | 分析项目画像 |
| POST | `/api/profile/designer/projects/{project_id}/confirm` | 确认项目画像 |
| POST | `/api/conversations` | 创建对话上下文 |
| POST | `/api/profile/designer/projects/{project_id}/trends` | 绑定趋势 |
| DELETE | `/api/profile/designer/projects/{project_id}/trends/{trend_id}` | 解绑趋势 |

### AI 对话与会话

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| POST | `/api/chat` | AI 对话、工具调用和流式返回 |
| POST | `/api/session/reset` | 重置会话 |
| GET | `/api/session/{session_id}/images` | 会话图片 |
| GET | `/api/session/{session_id}/state` | 会话状态 |
| POST | `/api/session/favorite` | 收藏资产 |
| DELETE | `/api/session/favorite` | 取消收藏 |
| GET | `/api/session/{session_id}/favorites` | 收藏列表 |
| GET | `/api/session/{session_id}/stats` | 会话统计 |
| GET | `/api/session/{session_id}/export` | 导出会话 |

### 图片与 AI 编辑

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| POST | `/api/upload` | 上传图片 |
| GET | `/api/images/{path}` | 读取生成或上传图片 |
| POST | `/api/edit_with_mask` | 基于 mask 局部编辑 |
| POST | `/api/enhance-prompt` | 提示词增强 |
| POST | `/api/analyze-image` | 图片分析 |

### 素材库

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/library` | 素材列表 |
| PATCH | `/api/library/{item_id}` | 更新素材 |
| DELETE | `/api/library/{item_id}` | 删除素材 |
| GET | `/api/library/stats` | 素材统计 |
| GET | `/api/library/{item_id}/similar` | 相似素材 |
| POST | `/api/library/analyze` | 分析素材 |
| POST | `/api/library/retry-tags` | 重试标签 |
| POST | `/api/library/suggest-outfit` | 搭配建议 |
| GET | `/api/library/collections` | 合集列表 |
| POST | `/api/library/collections` | 创建合集 |
| PATCH | `/api/library/collections/{col_id}` | 更新合集 |
| DELETE | `/api/library/collections/{col_id}` | 删除合集 |
| POST | `/api/library/collections/{col_id}/items` | 加入合集 |
| DELETE | `/api/library/collections/{col_id}/items/{item_id}` | 移出合集 |

### 虚拟试衣

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tryon/presets/{category}` | 获取预设模特或服装 |
| GET | `/api/tryon/preset-images/*` | 预设图片静态资源 |
| POST | `/api/tryon/generate` | 生成试衣图 |
| POST | `/api/tryon/save-outfit` | 保存试衣搭配 |

### 衣橱

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/wardrobe/items` | 衣橱单品 |
| POST | `/api/wardrobe/items` | 创建单品 |
| POST | `/api/wardrobe/items/from-trend` | 从趋势生成单品 |
| POST | `/api/wardrobe/items/from-design` | 从设计资产生成单品 |
| GET | `/api/wardrobe/items/{item_id}` | 单品详情 |
| PATCH | `/api/wardrobe/items/{item_id}` | 更新单品 |
| DELETE | `/api/wardrobe/items/{item_id}` | 删除单品 |
| POST | `/api/wardrobe/items/batch-delete` | 批量删除 |
| POST | `/api/wardrobe/items/{item_id}/re-analyze` | 重新分析 |
| GET | `/api/wardrobe/stats` | 衣橱统计 |
| GET | `/api/wardrobe/outfits` | 搭配列表 |
| POST | `/api/wardrobe/outfits` | 创建搭配 |
| GET | `/api/wardrobe/outfits/{outfit_id}` | 搭配详情 |
| PATCH | `/api/wardrobe/outfits/{outfit_id}` | 更新搭配 |
| DELETE | `/api/wardrobe/outfits/{outfit_id}` | 删除搭配 |
| POST | `/api/wardrobe/outfits/{outfit_id}/items` | 添加搭配单品 |
| DELETE | `/api/wardrobe/outfits/{outfit_id}/items/{wardrobe_item_id}` | 移除搭配单品 |

### 设计侧趋势同步

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/trends` | 设计侧趋势列表 |
| GET | `/api/trends/seasons` | 设计侧季节趋势 |
| POST | `/api/trends/sync` | 从趋势服务同步 |
| GET | `/api/trends/{trend_id}` | 趋势详情 |
| POST | `/api/trends/{trend_id}/favorite` | 收藏趋势 |
| DELETE | `/api/trends/{trend_id}/favorite` | 取消收藏趋势 |

## Trend API

当前入口：`services/trend/app.py`

兼容入口：`services/trend/api.py`

### 健康与元信息

| 方法 | 后端路径 | 前端代理路径 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | `/api/trend/health` | 趋势服务健康检查 |
| GET | `/health` | 不走代理 | 兼容健康检查 |
| GET | `/api/meta` | `/api/trend/meta` | 元信息 |
| GET | `/api/stats` | `/api/trend/stats` | 统计 |

### 报告、文章与趋势

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/reports/filters` | 报告筛选条件 |
| GET | `/api/reports` | 报告列表 |
| GET | `/api/reports/latest` | 最新报告 |
| GET | `/api/reports/{report_id}` | 报告详情 |
| GET | `/api/reports/{report_id}/export` | 导出报告 |
| GET | `/api/reports/{left_id}/compare/{right_id}` | 报告对比 |
| GET | `/api/trends/hot` | 热门趋势 |
| GET | `/api/trends/timeline` | 趋势时间线 |
| GET | `/api/trends/dimension-stats` | 趋势维度统计 |
| GET | `/api/articles` | 文章列表 |
| GET | `/api/articles/{unique_key}/raw-html` | 原始 HTML |
| POST | `/api/subscribe` | 订阅 |
| POST | `/api/articles/dedupe` | 文章去重 |
| GET | `/api/sites` | 站点配置 |

### 流水线任务

| 方法 | 后端路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks` | 任务列表 |
| GET | `/api/tasks/{run_id}` | 任务详情 |
| GET | `/api/tasks/current` | 当前任务；无任务时可能返回 `404` |
| POST | `/api/pipeline/trigger` | 触发流水线 |
| GET | `/api/pipeline/state` | 流水线状态 |
| POST | `/api/pipeline/pause` | 暂停流水线 |
| POST | `/api/pipeline/resume` | 恢复流水线 |
| POST | `/api/pipeline/retry/{run_id}` | 重试任务 |

### WebSocket

```text
ws://localhost:8002/ws/pipeline
```

用于推送流水线进度、状态和错误。

## Agent 工具调用记录

设计服务的 Agent 工具由 `services/design/agents/registry.py` 管理。每次工具调用会记录到：

```text
services/design/data/tool_traces/tool_calls.jsonl
```

记录字段包括工具名、输入参数、模型名、输入/输出图片、延迟、成本占位、错误、输出和创建时间，可用于回放、成本统计和设计溯源。
