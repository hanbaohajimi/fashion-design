# 辅助脚本目录

隔离完整检查：`pnpm verify:desktop-ui` 使用新PostgreSQL schema与临时Redis容器执行迁移和pnpm check，保留schema作为本轮证据；不会删除配置数据库或调用付费模型。

桌面界面审计：[manual/clip-audit.js](manual/clip-audit.js)，来源desktop-agent-ui技能。完整函数通过浏览器evaluate执行，使用body或目标父级为root；默认、hover、展开和动效终态分别检查，cut须为0，hidden另行核对。自动化入口：`pnpm exec playwright test tests/e2e/desktop-agent-ui.spec.ts`；结果写入`output/desktop-agent-ui/`。

以下命令默认从仓库根目录执行。日常开发优先使用根 `package.json` 中的 pnpm 命令；目录整理保留这些入口和脚本位置。

## 日常开发与验收

服装秀工具入口为 `runway.mjs`：`pnpm runway:doctor`、`runway:up`、`runway:down`、`runway:test`、`runway:test:integration` 与显式真实调用 `runway:smoke --provider ...`。运行环境与隔离边界见 [服装秀运行手册](../doc/plans/fashion-show-migration/OPERATIONS.md)。

| 入口或脚本 | 用途 |
| --- | --- |
| `pnpm local:start` / `start-platform.ps1` | Windows 本地启动；支持 `-DryRun`、`-SkipInstall`、`-NoBrowser` |
| `check-ports.mjs`、`check-ports.spec.mjs` | 基础设施端口检查、避让及对应测试 |
| `audit-dependencies.mjs`、`verify-dependency-security.mjs` | 依赖审计与验证 |
| `run-visual-e2e.mjs`、`run-trial-e2e.mjs` | 固定浏览器视觉验收与隔离应用验收 |
| `retry-image-pull.mjs`、`retry-image-pull.spec.mjs` | 隔离验收的 Supabase 镜像拉取限流最多尝试三次，间隔 15／30 秒；完整启动日志保存在 `output/trial-runtime/supabase-start.log`；回归测试纳入 `pnpm test:startup`，其他启动或业务错误直接失败 |
| `capture-ui-audit.mjs`、`create-ui-comparison.mjs`、`export-design-system.mjs` | 界面检查、前后对照与运行时设计变量导出 |
| `render-painting-loaders.mjs` | 绘画等待媒体处理 |
| `verify-file-pipeline.ts`、`verify-workflow-pipeline.ts`、`verify-workflow-assistant.ts` | 文件、工作流及助手链路验证，参数和环境见[项目 README](../README.md) |
| `evaluate-workflow-fig8.ts`、`verify-trial-image-model.mjs`、`review-generation-crash-worker.ts` | 专项评估与诊断，按脚本说明显式运行 |
| `trial-ai-server.mjs`、`seed-trends.mjs` | 试用模拟服务与趋势数据准备 |

## 文档工具：documents/

这些工具不参与应用启动或 CI。Python 工具使用已有 Python 环境：流程书/报告需要 `python-docx`，联系表需要 Pillow，Python PDF 光栅化需要 PyMuPDF（`fitz`）。不改变项目 pnpm 依赖。

| 脚本 | 输入、输出及命令 |
| --- | --- |
| [build_demo_flowbooks.py](documents/build_demo_flowbooks.py) | `python scripts/documents/build_demo_flowbooks.py`；生成正式流程书至 `doc/demos/`，可用 `FLOWBOOK_OUTPUT_DIR`、`FLOWBOOK_OUTPUT_SUFFIX` 指定其他目标 |
| [validate_flowbooks.py](documents/validate_flowbooks.py) | `python scripts/documents/validate_flowbooks.py`；只读检查 `doc/demos/` 中三份流程书；可用 `FLOWBOOK_DOC_DIR`、`FLOWBOOK_DOC_PATTERN` 指定输入 |
| [build_workflow_report.py](documents/build_workflow_report.py) | `python scripts/documents/build_workflow_report.py`；生成历史工作流说明报告至 `output/documents/workflow-report/` |
| [rasterize_pdfs.py](documents/rasterize_pdfs.py) | 将 PDF 放入 `output/documents/flowbooks/render-01/` 等子目录，再运行 `python scripts/documents/rasterize_pdfs.py`；在同一子目录输出页面 PNG |
| [rasterize_pdfs.mjs](documents/rasterize_pdfs.mjs) | `node scripts/documents/rasterize_pdfs.mjs`；同上，支持按原有文件版本名选择 PDF。需要 `@napi-rs/canvas` 与 `pdfjs-dist`，通过 `DOCUMENT_NODE_MODULES` 指定模块目录；默认查找当前用户的 Codex 运行库 |
| [make_contact.py](documents/make_contact.py) | `python scripts/documents/make_contact.py <页面目录>`；将 `page-*.png` 生成为同目录的 `contact.png`；默认输入为 `output/documents/workflow-report/pages/` |

两个 PDF 光栅化工具均支持 `FLOWBOOK_RENDER_DIR` 指定渲染工作目录。新结果写入 `output/documents/`；历史渲染结果已完整保留在 `output/archive/repository-2026-10-25/`，无需重新生成。

## 手工验证：manual/

- [verify-assistant-stream.mjs](manual/verify-assistant-stream.mjs)：运行 `node --env-file=.env.example --env-file-if-exists=.env scripts/manual/verify-assistant-stream.mjs`，使用现有 Amux 配置发起一次短文本请求，验证真实 SSE 分块、增量文本与最终结果一致；只将脱敏时间、分块计数及结果写入 `output/ui-refinement/assistant-stream/gateway-smoke.json`。

- [verify-ui-motion-upload.mjs](manual/verify-ui-motion-upload.mjs)：运行 `node scripts/manual/verify-ui-motion-upload.mjs`，使用本地 `.env`、已启动的 Web 与 MinIO 验证实际浏览器原图上传进度及校验和。只写入并删除本次唯一验证对象，不调用模型；结果写入 `output/ui-motion/minio-upload.json`。

- [test-amux-response-check.ts](manual/test-amux-response-check.ts)：单参考图与多参考图服务诊断。显式配置供应商环境后，可从根目录运行 `node apps/api/node_modules/tsx/dist/cli.mjs scripts/manual/test-amux-response-check.ts`；该操作会调用配置的图片服务，不属于目录整理验收。
- [test-multi-reference.sh](manual/test-multi-reference.sh)：历史人工操作检查清单，需要 Bash，按脚本提示手动操作已启动的系统。脚本中的业务描述保留原有时间背景。

## 历史一次性工具：archive/

`color-map.sed`、`color-map2.sed`、`color-map3.sed` 是旧版样式迁移的颜色替换规则，归档用于追溯，不进入日常命令和自动格式化流程。

## 参考预览代码

装裱研究预览位于 [doc/reference/material-mounting/preview/](../doc/reference/material-mounting/preview/)。需要重新生成时，从根目录执行：

```powershell
node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig doc/reference/material-mounting/preview/tsconfig.preview.json doc/reference/material-mounting/preview/gen-preview.tsx
```

这会更新研究资料中的 `material-preview.html`；当前应用的运行时主题仍由前端源码决定。
