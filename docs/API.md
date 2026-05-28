# API 对接说明

## 概述

统一平台的前端通过 Vite proxy 将 API 请求分发到对应后端：

| 路径前缀 | 目标服务 | 端口 |
|----------|----------|------|
| `/api/design/*` | Design Studio | 8001 |
| `/api/trend/*` | Trend Analysis | 8002 |
| `/api/gateway/*` | Gateway | 8000 |
| `/ws/*` | Trend Analysis WebSocket | 8002 |

## Design Studio API (原 时尚平台)

### 对话

```
POST /api/design/chat
Body: { "session_id": "uuid", "message": "设计一件红色晚礼服" }
Response: StreamingResponse (NDJSON)
  - { "type": "status", "content": "正在思考..." }
  - { "type": "image", "url": "/api/design/images/...", "type": "draw_sketch" }
  - { "type": "message", "content": "已为您生成...", "images": [...] }
  - { "type": "done" }
```

### 图片上传

```
POST /api/design/upload
Form: session_id, files (multiple)
Response: { "assets": [...], "count": N, "url": "...", "path": "..." }
```

### 局部编辑

```
POST /api/design/edit_with_mask
Form: instruction, base_image, mask_image, session_id
Response: { "url": "...", "path": "..." }
```

### 其他端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/design/health | 健康检查 |
| POST | /api/design/session/reset | 重置会话 |
| GET | /api/design/session/{id}/images | 获取会话图片 |
| GET | /api/design/session/{id}/state | 获取会话状态 |
| POST | /api/design/enhance-prompt | 提示词优化 |
| POST | /api/design/analyze-image | 图片分析 |
| GET | /api/design/images/{path} | 静态图片服务 |

## Trend Analysis API (原 ai_fashion)

### 核心端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/trend/health | 健康检查 |
| GET | /api/trend/stats | 全局统计 |
| GET | /api/trend/reports | 报告列表 |
| GET | /api/trend/reports/latest | 最新报告 |
| GET | /api/trend/reports/{id} | 报告详情 |
| GET | /api/trend/articles | 文章列表 |
| GET | /api/trend/trends/hot | 热词排行 |
| GET | /api/trend/trends/timeline | 关键词时间线 |
| POST | /api/trend/pipeline/trigger | 触发分析流水线 |
| GET | /api/trend/pipeline/state | 流水线状态 |

### WebSocket

```
ws://localhost:8002/ws/pipeline
Messages:
  - { "type": "started", "data": {...} }
  - { "type": "progress", "data": {...} }
  - { "type": "completed", "data": {...} }
  - { "type": "error", "data": {...} }
```

## Gateway API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/gateway/health | 全局健康检查（含子服务状态） |
| GET | /api/gateway/services | 服务列表 |
| GET | /api/gateway/meta | 平台元信息 |
