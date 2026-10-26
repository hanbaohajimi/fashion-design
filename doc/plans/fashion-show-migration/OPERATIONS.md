# 服装秀配置、启动与恢复

## 本机启动

1. 安装项目要求的 Node、pnpm、Docker Desktop，准备根目录 `.env`。
2. 首次验证先设置 `RUNWAY_ENABLED=true`、`RUNWAY_PROVIDER_MODE=mock`。
3. 执行 `pnpm local:start`。已有平台运行时也可执行 `pnpm runway:up`，该命令准备基础设施、应用增量迁移、构建容器、初始化检查点并等待 Worker 健康。
4. 打开项目的「款式与交付 → 服装秀」。模拟模式在界面和成果来源中明确标记，只用于流程验收。
5. `pnpm runway:doctor` 检查数据库、私有存储、检查点和 FFmpeg；`pnpm runway:doctor --config-only` 仅检查配置和工具。检查不生成付费内容。

根目录不需要安装 Python、uv 或 FFmpeg；均在 Python3.11/bookworm 容器内。容器没有公开端口。停用执行器使用 `pnpm runway:down`，该命令只停止并移除服装秀容器。

`RUNWAY_ENABLED=false` 时默认不启动服装秀，也不影响平台其他功能。修改配置后重新启动 API 与 Python Worker，确保两端模式一致。

## 模型配置与验证

将 `.env.example` 的 RUNWAY_* 项填写到本地 `.env`，不要提交。文本、图片、视觉、视频、音乐使用独立配置，现有 AMUX_* 和图片额度不参与服装秀。

| 能力 | 关键配置 | 验证命令 |
| --- | --- | --- |
| 文本 | RUNWAY_LLM_BASE_URL / MODEL / API_KEY | `pnpm runway:smoke --provider llm` |
| 图片 | RUNWAY_IMAGE_BASE_URL / MODEL / API_KEY | `pnpm runway:smoke --provider image` |
| 视频 | RUNWAY_VOLC_AK / SK、RUNWAY_VIDEO_REQ_KEY | `pnpm runway:smoke --provider video` |
| 音乐 | RUNWAY_MUSIC_BASE_URL / MODEL / API_KEY | `pnpm runway:smoke --provider music` |

smoke 是显式真实调用，可能产生供应商费用；普通 test/doctor 不调用真实生成。先分别验证，再设置 `RUNWAY_PROVIDER_MODE=live`。未验证或失效的旧接口显示受阻，不自动切换供应商。旧源码硬编码的凭据应更换，不可提交或写入日志。

生成时保存模型选择快照。运行中变更模型配置不应悄悄改变已开始任务的生成模型；重跑分支明确保存新的执行来源。密钥从当前运行环境读取，不进入检查点。

## 测试与隔离

- `pnpm runway:test`：冻结构建测试镜像并在无网络容器内执行单元、契约与媒体处理测试。
- `pnpm runway:test:integration`：使用专用 `fashion-runway-test` Compose 项目、数据库、端口和数据卷，验证 PostgreSQL、MinIO、检查点和模拟生成链路；不读取日常 `.env` 的服务连接或模型令牌。
- 测试端口：PostgreSQL 35432、Redis 36379（需要时）、MinIO 39000/39001。退出只停止该测试项目，数据卷保留便于诊断。
- 平台门禁：`pnpm check`。浏览器流程：`pnpm exec playwright test tests/e2e/runway-workspace.spec.ts`（以实施时实际新增用例名为准）。

运行证据统一位于 `output/runway-migration/`；普通 API 模拟浏览器测试不能替代真实 Python/数据库/存储验证。

## Linux 服务器部署

服装秀的 Compose 服务与当前平台共用 PostgreSQL 和 MinIO。先部署平台，再以服务端秘密配置启用服装秀：

```sh
pnpm db:deploy
pnpm runway:up
pnpm runway:doctor
```

外部数据库使用 `RUNWAY_CONTAINER_DATABASE_URL` 填写容器可访问、密码已 URL 编码的 PostgreSQL DSN；Python 连接不要带 Prisma 专用 `schema` 查询参数。默认检查点 schema 为 `runway_checkpoints`。

反向代理将浏览器的 `/api/` 请求转发到平台 API。沿用平台认证和可信代理配置；服装秀媒体不得绕过 API 直接公开存储。以下配置合并到现有 nginx server，不能覆盖已有认证、TLS 或普通 API location：

```nginx
location ~ ^/api/projects/[^/]+/runway/runs/[^/]+/events$ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://platform_api;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location ~ ^/api/projects/[^/]+/runway/media/[^/]+/content$ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://platform_api;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 10m;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`platform_api` 指向 NestJS API（本机部署通常为 `127.0.0.1:3001`），在 nginx 的 http 层沿用或定义该 upstream。NestJS 路由本身没有 `/api` 前缀，上述 rewrite 因此只移除一次浏览器前缀；请求参数仍保留。验证 SSE 不缓存、Range 返回206、下载中文文件名正确、未授权用户拒绝访问。

## 故障处理和备份

Worker 租约默认60秒，独立心跳10秒。数据库中的命令和检查点是恢复依据；本地缓存可以重新物化。图像/音乐同步调用结果不明时显示 NEEDS_ATTENTION，操作人员检查供应商记录后再明确重试。视频已有供应商任务 ID 时恢复查询，不重复提交。

取消仅确认本地取消意图，远端供应商任务可能继续。等待配对/审核不占执行槽。仅剩配乐失败时保留无配乐成片，支持选择无配乐版本。

升级前同时备份平台 PostgreSQL（含 runway_* 业务表和 runway_checkpoints schema）与 MinIO。备份应对应同一维护窗口，恢复后先以关闭状态启动，运行 doctor 和只读作品检查，再启用 Worker。不能只恢复业务表而丢掉检查点。

回退：关闭 RUNWAY_ENABLED、停止 Worker，保留表和媒体。临时缓存可删除；有作品、历史分支或检查点引用的媒体不可清理。项目复制首版不带服装秀运行历史，原项目成果仍保留。
