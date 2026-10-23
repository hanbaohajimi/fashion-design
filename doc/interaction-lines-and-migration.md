# 交互开发线与白板功能迁移

核查日期：2026-10-23（Asia/Shanghai）。

## 开发线

- 自由交互：`free-interaction`，基点 `bcb872a007deb0d2aa20d28d1577ab4170becad6`，2026-09-30 20:08:40。
- 节点式交互：`node-interaction`，迁移前基点 `3779b80dfefd50c3a6162bbaeb6af3ace37feef5`，GitHub 默认分支。
- 基线标签：`baseline/free-interaction-20260930`、`baseline/node-interaction-20261023`。
- 原 `main` 和 `codex/project-upload-20260930` 保留，不改写历史。
- 仓库外备份：`G:/fashion-design-backups/20261023/`，包含 Git bundle 和本次操作前未跟踪文件副本。

自由基点的项目入口为 BoardCanvas，采用 BoardSnapshot/BoardElement。`9b0c09b` 增加步骤追溯，`769ca19` 增加持久化 Agent 工作流，`920a4f1` 增加可编辑 Agent 流程图，`f720957` 正式替换主画布。因此不能把主画布替换前一版当成完全无流程图概念的自由基点。

自由线必须使用独立数据库、存储和对应锁文件，不连接节点系统数据库。后续功能 PR 以 node-interaction 为目标；共享修复通过审查后的 cherry-pick 同步。

## 已接入能力

| 能力 | 实现与兼容 |
| --- | --- |
| 手绘 | 竖向纸张、压力笔画、石墨颜色、粗细、局部擦除、撤销重做、清空、缩放和滚动平移 |
| 再次编辑 | 双击草图或在详情选择编辑；PNG 和版本化笔画文档同时保存 |
| 历史保护 | 未使用素材原位修改，已执行引用另存新节点并记录 sourceNodeId，不修改原输入 |
| 图片 | 文件选择、多图、拖入和图片粘贴；逐项状态及重试，建节点失败保留上传文件 |
| 色卡 | 1–12 色、名称、顺序和专用编辑；兼容旧 color 字段，局部重绘使用完整调色板 |
| 素材库 | 面料和趋势拖入，后端检查素材归属与状态 |
| 系列 | 项目系列列表、上传主推款、复用 DNA/Look/导出 |
| 任务 | 项目任务列表、定位、取消；重试走工作流 execute 而非独立生成入口 |

笔画文档在现有 payload 中持久化，不需要数据库迁移。单份文档限 UTF-8 JSON 512 KiB，超限保留草稿并提示。图片底图无法恢复历史笔画，橡皮只擦除新增笔画。草稿按账号、项目、节点隔离，退出和账号变更清理。

本次不迁移文本、便签、参考角色扩展、主画布多选编辑、节点复制粘贴、全局撤销重做、对齐、画框分组、说明箭头及固定素材装饰。旧白板保持现有只读查看和逐项导入，不批量转换内容。

## 验证与产物

- `pnpm lint`、`pnpm typecheck`、`pnpm db:validate`、`pnpm db:test`、`pnpm build`。
- 独立 Docker Compose 项目 fashion-migration-tests 的 PostgreSQL、Redis、MinIO 上运行 `pnpm test`，不使用原项目数据卷。
- 新增契约、局部擦除、多色顺序、图片重试和任务重试路由测试。
- 浏览器验证草图创建、刷新后重开、历史分支和现有局部修改入口。
- 截图：`output/playwright/editable-sketch.png`；固定交付截图和录屏：output/playwright/migration-proof/editable-sketch.png、output/playwright/migration-proof/editable-sketch.webm。
- 真实链路：`pnpm test:e2e:real --reuse-verified-minio`，验证真实认证、数据库、队列、Worker 和存储；模型使用本地验收 Provider，不代表外部模型质量验收。
- `--reuse-verified-minio` 仅在两个二进制均通过固定 SHA-256 校验时跳过下载，默认构建行为保持原样。
- 当前网络可能阻塞远程字体加载，截图验收可使用 `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` 避免等待外部字体。
- 初次验收时 `pnpm check` 被 Sentry 安全公告阻断；后续将 Sentry 升至 10.75.2、Next.js 与 eslint-config-next 升至 16.4.1、DOMPurify 升至 3.4.17，依赖审计已通过，未放宽审计规则。

自由基线在仓库外的 free-smoke 归档目录按历史锁文件离线安装，构建内部包，并在独立端口 4400 通过 3 项浏览器冒烟（助手终态同步、便签展开、桌面和窄屏白板交互）。仅调整该临时副本的开发端口，未改动自由分支。Windows tar 对部分历史中文文档路径报告提取错误；应用源码、锁文件与测试正常提取。

## 已完成验证结果

- 全工作区测试通过：API 660 项、Worker 115 项；前端 201 项通过（含新增组件测试）。
- 数据库关系测试 2 项通过；Prisma schema 校验通过。
- lint、typecheck、生产构建通过。
- 定向浏览器覆盖草图重开/历史分支、图片修改原图、局部修改入口和键盘焦点。
- 隔离真实链路 1 项通过（含真实队列、存储和 PDF，验收 Provider 为本地模拟）。
- 全量浏览器回归 115 项首轮通过，3 项兼容性回退修复后补跑全部通过，合计 118 项覆盖；日志分别为 output/migration-full-browser.log 和 output/migration-browser-recheck.log。

## 回滚

代码通过 revert 回滚，基线标签可用于比对。新增 payload 向后兼容，保留草图文件、节点版本和执行历史。不要通过重置分支或删除数据恢复旧界面。
