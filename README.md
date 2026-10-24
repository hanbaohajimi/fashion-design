# AI 服装设计平台

## 创作体验（2026-10-23）

登录页加入织物习作；项目首页展示真实作品与继续入口；画布在新方案到达时提示，
由用户决定是否定位。助手可围绕选中素材填写建议草稿，款式可携母图进入色料实验。
工作室的“创作进展”可查看已有修订并继续品牌、印花、展示、样衣与交付工作。
继续位置与画布视角按账号保存在本机，支持减弱动态模式。
首页摘要使用只读计数接口，不加载完整图片或调用模型。
升级需重新构建并重启 Web 和 API，无新增迁移或环境变量。
实施范围见 [全系统活力体验设计方案](doc/全系统活力体验设计方案-2026-10-23.md)。

## 运行稳定性补强（2026-10-23）

已确认上传的缩略图任务支持后台补派发；实验恢复保留已接纳任务的关联，
批量实验按单项记录准备失败，取消意图持久化并自动重试。导出历史按实际期限
显示过期状态。升级仅需重新构建并重启 API，无新增环境变量或数据库迁移。
行为说明及验收记录见 [运行稳定性补强](doc/运行稳定性补强-2026-10-23.md)。

## 设计工作室（2026-10-21）

在项目画布顶部选择“款式与交付”，进入 `/[projectId]/studio`。
工作室沿用现有项目、生成额度、私有存储和异步任务。

- 任务入口：草图效果图、多参考组合、改色、细节改款和需求梳理，直接建立并运行对应工作流。
- 款式档案：稳定款式编号、不可变修订、正背/细节视图、2–4 款比较；候选详情可直接保存为款式。
- 色料实验：同母图颜色、面料、部件或展示方案组合，单批最多 12 项；先存草稿，再显式提交，逐项保留失败和重试记录。
- 面料档案：成分比例、克重、幅宽、供应商、报价及来源，支持条件筛选；AI 外观描述不能充当物性或报价依据。
- 品牌与系列：品牌规则及认可案例按修订加入画布；本人可从其他仍有访问权的项目复用品牌文字规则，认可案例在当前项目重新选择。系列位置绑定明确款式修订。
- 印花工作台：循环、缩放、旋转、亮度和偏移预览，保存参数修订；屏幕预览不代表生产尺寸或真实服装贴合效果。
- 技术包：手工维护视图、定位标注、BOM、POM、公差和配色；通过人工复核后发布，后台输出绑定修订的中文 PDF。
- 样衣与评审：按技术包修订建立打样轮次，问题锚定本轮照片，记录责任人、处理依据与复核状态；评论和评审保留原记录。
- 商品展示：展示候选沿用实验任务生成，人工选图组成绑定款式修订的展示组，逐图核对后标记可交付，并输出 PDF 或下载原图。
- 趋势简报：保留原文、已知发布日期、抓取时间与摘要，设计探索方向单独填写；缺失日期显示未知，不生成虚构热度。

工作区成员采用所有者、编辑、评审、只读四种角色。只有所有者管理成员；编辑负责设计写入，
评审负责发布和复核，只读不会触发新的图片或视觉分析任务。成员的助手对话仍保持个人归属。
新增成员需先注册账号；本轮未接入真实外发邮件邀请。

升级运行 `pnpm db:deploy`，应用 `20261021000100_design_studio`、
`20261021000200_trend_unknown_dates`、`20261021000300_presentation_sets`，
随后构建并重启 API、Web 与 Worker。迁移保留旧项目。
生成和导出都使用服务端幂等与持久化恢复；没有接纳的实验项可以单独重试，已成功的项不会重复生成。

当前图片模型结果仍需人工检查。蒙版和额外面料参考同时输入尚未得到接口支持；
真实合体性、尺寸、物性、生产级色准和印花匹配均不由生成图验证。测试不自动调用付费模型。

### 本轮验收记录

| 检查 | 2026-10-21 实际结果 |
| --- | --- |
| `pnpm check` | 通过：启动检查、依赖审计、lint、类型、schema、完整测试、数据库检查、生产构建 |
| 应用测试 | API 79 文件 / 650 条；Web 38 文件 / 182 条；Worker 17 文件 / 114 条，全部通过 |
| 数据库测试 | 2 条通过；34 个迁移全部已应用 |
| 工作室浏览器流程 | 款式保存与比较、实验草稿与显式提交、展示包复核与 PDF、离开保护，4 条通过 |
| 完整浏览器回归 | 生产版本首轮 108/109 通过；唯一失败为面料快捷键焦点断言，调整测试就绪等待后连续 3 次通过 |
| 助手测试契约补测 | 补齐明确的 GET plan 空态 fixture 后，相关 5 条通过 |
| PDF 内容与排版 | 技术包及商品展示包正常/长内容共 35 页，渲染检查无越界或乱码 |

完整门禁日志：`output/studio-check-final.log`。浏览器回归日志：
`output/studio-browser-final.log`；新页面截图：
`output/playwright/studio-experiments-final-desktop.png` 与
`output/playwright/studio-presentation-final-mobile.png`。PDF 样本位于
`output/pdf/tech-pack-qa.pdf`、`output/pdf/presentation-qa.pdf`。

浏览器流程使用 API fixture 和确定性示例图片；真实持久化测试覆盖 PostgreSQL、
BullMQ、Worker、MinIO、认证下载、撤权、幂等和派发恢复，不调用付费模型。
界面示例图片与测试结果不能替代真实模型效果验收。

最终定向补测命令（完整浏览器首轮与补测分别保留在上述日志中）：

```bash
pnpm exec playwright test tests/e2e/generation-flow.spec.ts --grep "面料档案支持快捷搜索" --repeat-each=3 --output=output/playwright/studio-final-fabric-results --reporter=list
pnpm exec playwright test tests/e2e/agent-workspace-flow.spec.ts --output=output/playwright/studio-final-agent-results --reporter=list
```

## 界面开发与验收

应用采用 Atelier 浅色工作界面。颜色、字号、间距、控件尺寸和动效统一定义在
`apps/web/src/styles/design-system.css`；页面使用 CSS Modules，共享交互组件位于
`apps/web/src/components/ui.tsx`，内容页导航使用 `AppHeader`。
新功能优先扩展这些变量与组件，不在各页面重复建立视觉规则。
旧版 `design-tokens*.css`、`motion-enhancements.css` 和 `components.css` 不再作为全局入口。

工作室桌面侧栏支持拖动或方向键调整；窄屏使用抽屉，手机使用画布、节点列表、助手分区。
助手与详情切换保留草稿；切换节点或离开项目时，未保存的参数需要明确处理。
会话切换、新对话和协作设置统一收进输入框底部“更多”菜单；暂停及只读状态保留该入口。
候选图及系列中的导出是工作区子视图，选择“返回工作区”继续编辑，关闭窗口后任务仍在后台执行。
图片与系列使用共享标签页，方向键、Home 和 End 移动焦点，Enter 或空格确认切换。
草图、历史白板、面料管理、趋势存入和导出复用同一套对话框焦点管理。
画布工具组的“工作室帮助”可查看操作说明，提示支持鼠标悬停、键盘聚焦和 Esc 关闭。

组件状态覆盖默认、聚焦、禁用、加载、成功与失败。验证命令为
`pnpm --filter @fashion/web test`、`pnpm test:e2e` 和 `pnpm test:e2e:real --checks`。
工作室多尺寸截图保存在 `output/playwright/atelier/`，项目库和登录页截图保存在
`output/playwright/review-*-final.png`。截图需检查布局、图片比例、关键操作可见性与文本对比度，
不能仅因截图更新就视为验收通过。

`pnpm test:e2e:visual` 在固定的 Debian、Chromium 145.0.7632.6 与 Noto CJK 字体环境中
自动比较 `tests/visual/__screenshots__/` 的基线；本机与 CI 使用同一容器，不依赖主机字体。
首次需要 Docker 下载并构建只含 Chromium 的验收镜像，之后复用构建缓存；
可用 `pnpm test:e2e:visual --prepare` 提前准备，不启动应用。
视觉服务使用 4400 端口，浏览器调试端口由 Docker 自动分配且只绑定本机。
对比失败时检查 `output/playwright/visual-results/` 中的实际图与差异图，确认布局与交互后
才执行 `pnpm test:e2e:visual --update-snapshots` 更新基线；CI 不自动更新。
隔离真实链路另外验证系列 DNA 编辑、跨页签持续生成 Look，以及两页中文 Lookbook PDF 下载。

2026-10-20 本地收尾验收：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm --filter @fashion/web test` | 27 个文件、143 条通过 |
| `pnpm check`（由隔离启动器的 `--checks` 执行） | 启动检查、依赖审计、lint、类型、schema、测试、数据库与生产构建通过；API 583、Worker 101、Web 143、数据库 2 条通过 |
| `pnpm test:e2e` | 首轮 103/105；修正两处测试选择器及 SDK 徽标检测后，两项补测通过；最终受影响交互另行 9/9 回归通过 |
| `pnpm test:e2e:visual` | 13/13，19 张固定环境截图通过自动对比，已逐张人工复核 |
| `pnpm test:e2e:real` | 1/1；真实认证、上传、执行、刷新、复制继续设计、系列扩展与后台导出通过 |
| 中文 PDF 内容检查 | pypdf 提取中文与 Look 编号，PyMuPDF 检查 Look 页的两张图片；Poppler 逐页渲染并人工复核，两页完整 |

最终交互回归使用：

```bash
pnpm exec playwright test tests/e2e/workflow-trend-library.spec.ts tests/e2e/workflow-canvas.spec.ts tests/e2e/collection-consistency-flow.spec.ts tests/e2e/generation-flow.spec.ts tests/e2e/workflow-export.spec.ts tests/e2e/version-history-flow.spec.ts --grep '趋势档案保留|趋势主题筛选|统一工作区|打开系列|帮助提示|工作流 PNG|独立面料库|候选的大图|版本'
```

基线整理前截图位于 `output/playwright/atelier-before/`，最终基线位于
`tests/visual/__screenshots__/atelier.spec.ts/`。本次日志为
`output/atelier-final-related-browser.log`、`output/atelier-visual-comparison.log`、
`output/atelier-final-series-real.log`（完整门禁与文件流水线）及
`output/atelier-final-series-recheck.log`（修正 PDF 测试依赖引用后的真实链路）。
PDF 样本保存在 `output/playwright/real-results/`，文本检查为
`output/atelier-pdf-verification.txt`，页面渲染为 `output/atelier-lookbook-poppler-{1,2}.png`。
2026-10-20 的界面验收未新增业务接口、数据库迁移或 npm 依赖；模型协议未改动，真实链路使用本地 Provider 替身。
视觉用例固定字体、时间并隐藏 Next.js 开发调试层，未隐藏 SDK 授权提示；
未使用的 SDK 远程文字字体在视觉测试中被阻断，工作流文字使用固定的 Noto 字体。

| 组件或区域 | 已覆盖的状态与交互 |
| --- | --- |
| 按钮、表单 | 默认、悬停、可见焦点、禁用、提交中、字段错误 |
| 菜单、分区选择 | 键盘方向键、展开与关闭、Esc、外部点击、选中状态 |
| 对话框 | 初始字段聚焦、Tab 圈定、Esc、关闭后焦点恢复 |
| 内容列表 | 骨架、空结果、请求失败、重试、分页、图片失败回退 |
| 画布与详情 | 保存中、待保存、同步异常、原批次重试、草稿保留、离开保护 |
| 助手 | 历史会话、上下文折叠、等待与失败、阅读时新消息提示、手动回到最新 |
| 图片与系列 | 等比预览、原始比例、修改分支、版本恢复、系列保存反馈 |
| 导出 | 最近任务恢复、排队、生成、失败重试、下载、返回工作区、后台继续 |

## 试用可靠性升级与验收

升级先运行 `pnpm db:deploy` 应用 `20261019000100_trial_reliability`，再重新构建并重启 API 与 Worker。
新增迁移仅扩展导出幂等键和运行租约，不改写旧数据或已应用迁移。

“创建副本”保留当前节点、连线、素材、结果、系列与项目目标，并建立独立快照基线。
历史对话和执行记录保留在原项目；副本不会继承正在执行的任务。
生成和导出通过数据库持久化派发，后台每 15 秒对账，Redis 记录丢失时恢复排队任务；
无法安全恢复的生成明确报告中断，避免无期限等待或重复生成。

导出窗口可以随时关闭，重新打开可从服务端查回最近任务；相同幂等键只创建一次。
Lookbook 缺图、空系列或中文字体不可用均明确失败。Worker 启动时检查中文字体，
Windows 自动探测系统字体，Linux 需配置 `EXPORT_PDF_FONT_PATH`，TTC 字体还可配置
`EXPORT_PDF_FONT_FAMILY`（如 `NotoSansCJKsc-Regular`）。

运行 `pnpm test:e2e:real` 启动独立的 `fashion-trial` Docker 与 Supabase 项目，
使用 25432、26379、29000/29001、55320–55329、4300–4302 端口和独立数据卷。
它覆盖真实登录、上传、API、数据库、队列、存储、项目复制与后台导出；仅将外部 AI
替换为本地确定性 HTTP 服务。不会拦截平台 API，也不读取日常服务的连接配置。
加 `--checks` 可在同一隔离环境执行 `pnpm check` 与私有文件流水线验证，
加 `--contracts` 会在启动真实链路服务前执行原有 API 模拟浏览器测试。
加 `--real-model-smoke` 会显式使用 `.env` 中的模型配置验证参考图编辑、透明蒙版重绘和真实助手；
仅继承模型配置，数据库、队列和存储仍使用隔离环境。模型输出样本保存在 `output/trial-model-smoke/`。
若已验证图片模型，仅重跑助手可使用 `--assistant-smoke`。
结束后停止测试服务并保留隔离数据卷；日志、trace、截图和导出样本位于 `output/`。

真实模型验证继续使用下文的 `verify-workflow-pipeline.ts` 与
`verify-workflow-assistant.ts` 脚本，需显式运行并配置有效模型令牌，不在 CI 中自动调用。

基于 pnpm 与 Turborepo 的 Monorepo 工程骨架。

## 工程结构

```text
apps/
  web/       Next.js 前端
  api/       NestJS API
  worker/    BullMQ Worker
packages/
  ai/        AI Provider 抽象、重试与成本估算
  billing/   生成额度与计费原子操作
  shared/    跨应用共享类型与常量
  db/        Prisma schema 与迁移
```

## 环境要求

- Node.js 22.12 或更高版本
- pnpm 11.9
- Docker Desktop

## 本地启动

Windows 在仓库根目录运行以下命令，即可依次完成依赖安装、基础设施启动、本地认证
启动、数据库迁移及开发服务启动：

```bash
pnpm local:start
```

也可以直接双击仓库根目录的 `start-platform.cmd`。脚本会检查 Node.js、pnpm 与
Docker，必要时启动 Docker Desktop、从 `.env.example` 创建 `.env`，并同步本地
Supabase 地址与公钥；页面就绪后会自动打开浏览器。
启动前会检查基础设施端口。端口被占用或 Windows 拒绝绑定（`EACCES`）时，自动探测
替代端口并同步 `.env` 中匹配的本地连接地址：PostgreSQL 从 15432、Redis 从 16379、
MinIO 从 19000/19001 开始查找。现有数据卷和其他配置保留；远程或不一致的连接地址
不会自动改写，终端环境变量覆盖冲突时也会明确停止。

默认每次都检查安装依赖，使用冻结锁文件、优先缓存及较低下载并发；网络不可用且
缓存不足时会明确失败。任一步失败即停止，保留失败原因；`pnpm dev` 在当前窗口运行，
按 `Ctrl+C` 停止开发服务后，Docker 与 Supabase 数据服务仍会保留。
一键启动使用 `pnpm db:deploy` 应用已保存的迁移，再只读核对实际数据库结构与 schema；
结构不一致时停止，不会自动重置数据库。修改 Prisma schema、需要创建开发迁移时，
再单独运行 `pnpm db:migrate`。已应用迁移的旧校验差异不会由启动脚本改写。
启动过程中的原生命令按退出码判断成败，兼容 Windows PowerShell 5.1 与 PowerShell 7，
不会把 Docker 写到 stderr 的普通警告误判为失败。依赖安装阶段之后，仅在本次启动
进程内关闭 pnpm 的重复自动安装检查，结束时恢复原值，不修改全局配置或供应链策略。

也可以在终端中使用可选参数启动：

```powershell
.\start-platform.cmd -NoBrowser
.\start-platform.cmd -SkipInstall
.\start-platform.cmd -DryRun
```

上述参数也可传给 `pnpm local:start`，例如 `pnpm local:start -SkipInstall -NoBrowser`。
`-SkipInstall` 仅跳过本脚本的安装步骤，适合依赖已就绪时使用；`-DryRun` 仅预览顺序，
不会修改 `.env`、运行迁移或启动服务。已有 `.env` 中的模型令牌等配置会保留。
pnpm 自身可能在执行脚本前自动检查安装依赖，因此仅预览时建议直接运行
`.\start-platform.cmd -DryRun`，避免在进入脚本前触发额外联网检查。

手动启动流程如下：

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm auth:start
pnpm db:deploy
pnpm dev
```

启动完成后：

- Web：http://localhost:3000
- API Liveness：http://localhost:3001/health/live
- API Readiness：http://localhost:3001/health/ready
- PostgreSQL：localhost:5432（发生自动避让时以 `.env` 的 `POSTGRES_PORT` 为准）
- Redis：localhost:6379（发生自动避让时以 `.env` 的 `REDIS_PORT` 为准）
- Supabase API：http://127.0.0.1:54321
- 本地邮件箱：http://127.0.0.1:54324

`pnpm dev` 会构建内部包并同时启动 Web、API、Worker 与包级 watch。修改
`packages/shared`、`packages/ai` 或 `packages/billing` 后，依赖应用会自动
重新编译或重启。仓库根 `.env` 会由 API、Worker、Prisma 与 Web 配置统一加载。

## Amux 模型渠道配置

系统不再依赖 fal.ai，也不再需要单独的 OpenAI Key。图片理解与生图使用同一个
Amux 令牌，但按模型明确分工：

- `anthropic/claude-sonnet-4-6`：图片角色识别、提示词增强、系列 DNA、生成结果内容审核及工作流 Agent。
- `openai/gpt-image-2.5-sunburst`：实际生成与编辑图片，可通过 `AMUX_IMAGE_MODEL` 覆盖。

首次配置只需要在 `.env` 中填写：

```env
AI_PRIMARY_PROVIDER=amux
AMUX_API_KEY=在这里填写你的令牌
AMUX_BASE_URL=https://gateway.amux.ai/v1
AMUX_CLAUDE_MODEL=anthropic/claude-sonnet-4-6
AMUX_CLAUDE_TIMEOUT_MS=600000
AMUX_IMAGE_MODEL=openai/gpt-image-2.5-sunburst
AI_PROVIDER_TIMEOUT_MS=600000
GENERATION_TIMEOUT_MS=720000
```

Amux 令牌需要有上述两个模型的调用权限。Claude 通过原生 Anthropic `/messages` 接口，并使用强制
`tool_choice` 与 `strict input_schema` 返回结构化结果；系统使用 `/images/generations` 生成图片，使用
`/images/edits` 处理参考图和透明蒙版。`openai/gpt-image-2.5-sunburst` 按原生格式返回
`b64_json`；Worker 只在内存中短暂接收并立即写入私有 MinIO，不会把 Base64 图片写入
任务数据库。送审时，系统会把该 Data URL 转换为 Anthropic 原生 `base64` 图片源，
避免 Amux 静默忽略图片并返回普通文字。

Amux 在平台侧按模型权限路由，请求体不额外发送渠道字段。Provider 最长等待 10 分钟，
Worker 总任务最长等待 12 分钟，额外两分钟用于内容审核、对象存储和缩略图处理。
带参考图的文生图、图片编辑与局部重绘使用 `/images/edits`，调用失败时保留错误，
不会改为无参考图的生成。Provider 内不再叠加重试，队列层仍会重试一次。

当前画布只向用户展示 GPT Image 2 支持的尺寸、质量和输出格式。`CFG`、采样步数与
原生 `strength` 不会作为 Amux 参数发送；它们继续保留在通用生成契约中，供后续接入
Stable Diffusion Provider。参考图“变化程度”会转换成文字约束并写入编辑提示词。

参考图片只允许从受信任的对象存储来源下载。系统会自动允许 `S3_ENDPOINT` 和
`ASSET_CDN_ORIGIN`；生产环境如使用其他签名图片域名，可追加：

```env
AI_REFERENCE_IMAGE_ALLOWED_ORIGINS=https://assets.example.com
```

百炼 Provider 已注册但默认不启用。取得北京地域 API Key 和业务空间 ID 后，可填写：

```env
AI_FALLBACK_PROVIDER=dashscope
DASHSCOPE_API_KEY=在这里填写百炼密钥
DASHSCOPE_BASE_URL=https://你的WorkspaceId.cn-beijing.maas.aliyuncs.com
DASHSCOPE_IMAGE_MODEL=wan2.7-image-pro
```

备用渠道只在主渠道限流、超时或持续不可用时触发，不会绕过内容审核。当前百炼适配器
支持文生图和参考图编辑；精确蒙版重绘仍固定由 Amux 处理。

## 本地邮箱登录

首次启动 Supabase 后，运行 `pnpm auth:status`，把输出中的 API URL 与
publishable/anon key 写入 `.env` 的 `SUPABASE_URL` 和
`SUPABASE_PUBLISHABLE_KEY`。认证接口只把访问令牌和刷新令牌写入
HttpOnly Cookie，浏览器脚本不会读取或持久化 JWT。
登录、会话与退出响应均使用 `Cache-Control: private, no-store`；项目库的
“退出登录”会调用 `POST /auth/logout` 并同时清除两枚会话 Cookie。

魔法链接邮件模板需要把一次性 TokenHash 发回平台确认页。在 Supabase
Dashboard 的 Authentication → Email Templates → Magic Link 中使用：

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">
  登录 AI 服装设计平台
</a>
```

本地邮件不会真实发送，可在 `http://127.0.0.1:54324` 查看并打开链接。
线上环境必须把 `APP_ORIGIN` 设置为固定 HTTPS 域名，并设置
`SESSION_COOKIE_SECURE=true`。

## 端口冲突

`pnpm infra:up` 会在启动容器前检查 PostgreSQL、Redis 和 MinIO 端口。如果端口已
被占用或系统拒绝绑定，命令会指出需要修改的环境变量，不再抛出未处理堆栈。
Windows 一键启动会自动避让；手动启动也可先执行 `node scripts/check-ports.mjs --repair-local`。
该模式仅用于本地开发，并保留现有数据卷。修改 `.env` 中的
`POSTGRES_PORT` 或 `REDIS_PORT` 后，同时更新 `DATABASE_URL` 或
`REDIS_URL`。开发容器默认只绑定 `127.0.0.1`，数据库、Redis、原图和
缩略图不会匿名暴露到局域网。

## 节点设计工作台

右侧设计助手已统一为持续协作对话：可直接总结整个画布、追问设计路径或讨论失败原因，
也可提出待确认的下一步。`@` 与“引用选中节点”用于限定本轮重点；未引用时仍能读取全图
目录与分支。上下文栏可查看目标、当前任务、焦点、要求、推断偏好及图片覆盖，支持
更正目标、设定／清除焦点和停用偏好。项目目标与有效偏好跨会话继承，旧聊天只读可查。

当前协作框架按论文图 8 分为信息整合、单个 Planner 与动作使能。助手可在预算内补读
节点、历史原文和相关实图，并保存可修订的当前目标及阶段计划。提案支持创建工具、
修改尚未执行工具的参数和输入、从已执行工具派生新分支；确认前展示修改差异。
参数与输入在接受时原子校验，未执行卡片保持原 ID，语义版本另行保留。

过程历史按焦点当前版本、最新变更、相关分支和近期记录优先读取，主要版本窗口最多
200 条，并补读边界前驱；详情超预算时保留明确标记的版本元数据。未加载到执行或选择
不代表从未发生。分支历史与长对话可在同一次规划内分段续读，返回未读范围；图版本
变化后重新读取。完整事实保存在数据库，助手每轮只读取有界投影，不是完整过程重放。

工具执行携带发起会话，多个候选汇总为一个执行回执；API 后台消费者在浏览器关闭或
重启后继续恢复结果。执行完成后可以主动分析并提出待审建议，仍需设计师确认和主动
执行。新用户消息或纠正会使旧后台建议失效。技术失败、取消和审核失败不作为审美偏好。

图片内容理解使用独立视觉摘要缓存，Worker 就绪后自动补齐新图及历史图片。用途标签
不等于图片内容描述；未处理或失败的摘要会明确显示。主助手附带相关实图，并保留
来源绑定和读取覆盖；摘要不能确定真实面料成分、尺寸或物理性能。

升级需运行 `pnpm db:deploy` 应用 `20261015120000_project_design_context` 与
`20261016000100_visual_summary_lookup` 与 `20261016090000_fig8_workflow_collaboration`，
重新构建内部包并重启 API、Web 和 Worker。
原始图、执行与历史会话保留；接受提案仍不会自动生图。

项目默认启用协作版本 `2`。需要回退时，项目所有者可调用
`POST /projects/:projectId/workflow/agent-settings`，传 `{ "version": 1 }` 暂停新版规划和
后台建议；已有图、资产和历史保留，待审新版提案失效。传 `{ "version": 2 }` 恢复。
该开关不会恢复旧关键词规划或旧六步计划的新建路径。

真实持续协作验收（调用已配置模型，使用隔离测试项目和视觉队列，不生成新图片）：

```bash
node --env-file=.env.example --env-file-if-exists=.env apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/verify-workflow-assistant.ts
```

默认读取 `output/workflow-verification/real-candidate.png` 作为图片样本，也可在命令末尾
传入已有服装图片路径。脱敏结果保存在 `output/workflow-assistant-verification`。

十场景、八种上下文消融、每种重复三次的实验清单与空白盲评表：

```bash
node --env-file=.env.example --env-file-if-exists=.env apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/evaluate-workflow-fig8.ts --image="你的服装图片路径"
```

默认只生成 240 组条件，不调用模型。真实评估加 `--run --max-cases=240`，并提供
`FIG8_EVAL_INPUT_USD_PER_MILLION`、`FIG8_EVAL_OUTPUT_USD_PER_MILLION` 渠道实际单价；
可通过 `--max-model-calls` 与 `--max-estimated-usd` 限制预算。输出来源检查与四维盲评表，
不会自动填写主观分数。重构前冻结结果通过 `--baseline-results=路径` 导入；缺少时明确待配对。

项目现在默认打开节点设计工作流：中央画布显示“素材 → 工具 → 结果”，底部提供
素材与工具菜单，右侧设计助手根据当前图和明确引用的节点提出下一步。
可以手动添加需求、参考文字、色卡、上传图片或绘制草图，也可以引用趋势和面料库。
每条输入连线有明确槽位；非法连接、循环、跨项目引用与过期保存会由 API 拒绝。
上传图与草图沿用视觉角色识别，设计师可手动指定角色；角色仅表示参考用途，不成为
硬性设计要求。独立趋势档案保留周报、主题、原文与摘要，可以直接加入当前工作流。

推荐体验路径：添加设计需求和参考 → 请求下一步建议 → 查看虚线节点及理由 → 确认加入
画布 → 主动执行需求分析 → 查看设计约束 → 生成候选 → 连接约束与候选进行评估 →
`@候选` 提出修改并确认新分支。建议本身不会调用图片生成。已执行输入与结果保持历史，
调整需要创建新节点或分支；拖动只更新布局，不使 Agent 建议失效。

上传的参考图片也可以直接连接到“局部修改”作为原图，无需先生成候选。
同一修改节点已有原图时，新连接的上传图片默认作为参考素材；点击连线可切换
“用作原图”或“用作参考素材”。原图始终只能有一张；修改结果生成新候选，保留上传来源与版本关系。

候选详情保留大图、生成变体、蒙版局部重绘、版本恢复、单图导出和系列入口。变体、
局部重绘与恢复结果会回到工作流成为新分支；系列关联保存在候选节点中。普通聊天、
历史会话、旧 Agent 运行只读详情和原有系列工作台仍可使用。
“历史白板”是旧自由白板的只读视图，可以导出或把选中资料加入新工作流；新设计不再
写入旧白板快照。旧来源缺失时保持不完整标记。

图、提案和每次执行尝试保存在服务端，刷新可恢复。重复提交和结果回填按请求与资产 ID
去重；失败重试保留旧尝试。生成仍使用现有额度、队列、Worker 和私有图片存储。
需要执行 `pnpm db:deploy` 应用 `20261013000000_workflow_graph`，并重启 API、Web 和 Worker。
主要接口位于 `/projects/:projectId/workflow`：读取／图变更、`sync` 结果恢复、提案接受／拒绝、
节点执行、历史和决策。候选设计路径也优先读取此图的真实来源。

真实模型与队列验收脚本会创建独立临时项目，分析需求与参考、实际生成 A/B、逐候选评价、
确认修改建议并生成新分支，检查母图与重复执行，完成后清理测试记录：

```bash
pnpm --filter @fashion/worker exec tsx src/index.ts
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/verify-workflow-pipeline.ts
```

结果图片和脱敏图记录保存在 `output/workflow-verification`。该检查会消耗已配置模型的调用额度；
模型不可用、基础设施中断或内容审核失败都会明确报错并以失败状态退出。

## 设计路径与选择记录

在候选详情中点击“设计路径”，可查看“输入来源 → 设计操作 → 输出结果”。
主工作流路径沿不可变节点版本及输入绑定追溯，使用当时的执行快照和实际生产尝试，
不会借用当前卡片或最新重试解释旧候选。新建生成任务保存便签、色卡、素材角色、
面料描述和执行提示词的副本；导入与版本恢复也记录独立步骤。历史缺失或读取达到
预算时标记不完整，旧资产按真实血缘回退展示，不补造过去来源。

生成结果同步将落图、尝试终态与执行回执同事务提交；恢复结果回填将节点、版本绑定、
执行记录与终态回执同事务保存。重复回填或重试保留原有事实，不重复创建结果。

Agent 修改选中的设计时会绑定来源资产，创建图片编辑任务；生成新方案时仍使用文生图。
“选定此方案”“否决此方案”“保留比较”会追加选择与理由记录；结果在工作流中投影一次，
候选中的设计路径用于回溯输入、操作和选择。

新增接口：`GET /design-assets/:id/path`、`POST /design-assets/:id/decisions`。
升级后需执行 `pnpm db:deploy` 应用 `20261010000000_design_process` 迁移。

## 历史 Agent 设计工作流

以下描述保留旧版运行的机制与接口。新版项目通过上述节点设计工作台执行，旧运行记录
继续可查，不与主画布形成第二套可编辑图。

旧串行 `AgentRun` 把目标规划成最多六个生成或编辑步骤，要求前序候选经人工采用后
进入下一步。它的简报、步骤提示词、尝试、领域报告、采用与否决记录继续保留。
主工作流不再用旧编辑弹窗建立新计划，也不会把旧绘图箭头解释成执行依赖。

计划、执行状态和采用记录保存在服务端，刷新后可恢复。运行时保存每次执行的请求
与编译快照；入队失败可用原执行编号恢复，生成失败后重试则保留旧尝试并创建新尝试。
计划支持暂停与取消，并通过版本号拒绝过期修改。暂停不会中断已经提交的图片生成；
取消会请求停止当前任务。当前依赖可以形成多个分支，但仍按节点顺序逐步执行；
尚不支持并行执行或自动运行整个计划。

历史读取接口为 `GET /agent-conversations/:id/plans`；旧 `POST` 只允许已有请求编号
重放，新请求返回 `410 LEGACY_AGENT_PLAN_RETIRED`，请使用 `workflow-messages`。
读取、修改、执行和确认接口
位于 `/agent-runs/:id` 下。升级需执行 `pnpm db:deploy`，应用
`20261010010000_agent_runs` 迁移，然后重启 API、Web 与 Worker。
节点图保存使用 `PATCH /agent-runs/:id/plan`，结果否决使用
`POST /agent-runs/:id/reject`；本次节点编辑与执行历史更新无需额外数据库迁移。

旧计划曾由上下文整理 Agent 提取带来源的服装设计简报，再由规划 Agent 生成节点
及验收项。简报区分明确要求、解释性偏好和未知项；节点显示处理哪些约束，未绑定项
会提示。历史决策只读取本次选中设计的记录，不能自动变成跨项目偏好。

候选等待审核时可主动发起领域 Agent 检查，对实际图片逐条件给出“符合、存在问题、
无法判断”。尺寸、真实面料成分等需要测量或规格资料的条件不能仅凭图片判定。
否决或失败后可请求修订建议，先查看修改与保留项，再应用到已保存的节点提示词，
最后主动执行新尝试；建议不会自动生成或替用户采用结果。

领域动作使用 `POST /agent-runs/:id/agent-actions`，应用修订使用
`POST /agent-runs/:id/agent-actions/:actionId/apply`。动作与报告持久化并校验版本，
人工操作会使正在分析的动作失效，旧报告不能覆盖新输入。本轮无需额外数据库迁移。
具体职责、论文依据、权限边界和技术壁垒的验证方案见 [Agent 架构设计](./AGENT_ARCHITECTURE.md)。

新项目请使用上方“节点设计工作台”的体验路径。升级前的运行可能没有领域简报，
历史记录按实际保存的信息展示；不能补造旧执行来源或评价。浏览器加载新版代码需要
重新启动 API 与 Web。

## 质量检查

### 本轮可靠性与安全改进

项目库正式入口统一使用 `ProjectLibrary`、`ProjectGrid`、`ProjectCard`；`-redesign`
文件只保留兼容导出。工作流中的布局保存、节点详情和素材弹窗已拆分为独立模块。
画布首次定位需求节点，以可读比例打开；“查看全图”和“100%”可切换视图，不改动已保存位置。
拖动后只有服务端确认且没有剩余改动时才显示“画布已保存”；失败批次保留原请求编号，
可点击“重试保存”，并显示待保存节点数。链接、程序化导航和浏览器前进/后退均等待保存；
保存失败保留当前页面与历史目标，刷新或关闭时对未保存内容提示。
账号切换会取消所有私有接口请求，销毁旧 Query/SWR 缓存和组件状态；登录与退出通过
同源浏览器存储事件同步其他标签，不保存认证凭证。弹窗支持 Escape、双向 Tab 循环和焦点恢复，
画布节点可用键盘进入详情。四种视口下的正常及错误界面检查文字对比度与控件字号。
会话切换通知会使进行中的旧会话查询失效；进入登录确认页也会清除上一身份，防止
旧 `/me` 响应覆盖新账号，或登录返回工作区时短暂复用旧账号缓存。
可删除性由服务端返回，移除未执行节点前需要确认关联连线；执行历史保持只读。

所有业务写请求必须提供与 `APP_ORIGIN` 匹配的 `Origin`，否则返回 403。
开发环境允许同端口的 localhost、127.0.0.1 和 IPv6 回环别名；生产环境只接受配置的精确来源。
脚本或自动化调用 API 时也需显式发送 `Origin`。只有 `TRUSTED_PROXY_ADDRESSES`
中配置的代理地址可以提供真实客户端 IP，默认不信任转发头。

上传签名绑定精确文件长度、类型和 SHA256；浏览器继续使用 PUT，Content-Length
由浏览器根据文件自动发送。文件签名和面料上传默认分别限流 20 次/用户/分钟，可通过
`FILE_UPLOAD_RATE_LIMIT`、`FABRIC_UPLOAD_RATE_LIMIT` 调整。过期未完成上传和失败对象每小时
清理一轮，`UPLOAD_CLEANUP_AGE_HOURS` 默认为 24，最小为 1；READY/PROCESSING 不进入清理。
清理删除期间持有记录锁，新签名续期通过 CAS 竞争，避免删除活跃重试。

不消耗真实模型额度的完整链路回归已纳入 API 测试：

```bash
pnpm --filter @fashion/api exec vitest run src/review.pipeline.integration.spec.ts
pnpm verify:file-pipeline
```

前者使用真实 PostgreSQL、Redis/BullMQ Worker、私有 MinIO 与可控图片适配器，验证上传、
节点执行、生成资产归属、PNG 导出及重复任务不重复产出或计次；还会在远程任务编号
持久化后强制终止 Worker 子进程，验证 BullMQ 恢复废弃任务后不重复提交模型、产出或计次。
仅测试记录的恢复租约时间被推进，实际 Redis 锁仍由队列检测并恢复。后者额外验证对象存储
实际拒绝超出签名长度的上传。测试前必须应用迁移并配置独立测试基础设施。

正式演示与上线仍须独立验收两项：为 `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 配置有效授权并确认
画布正常运行；在生产 Worker 网络环境提供出口阻断证据，覆盖回环、私网、链路本地及
云元数据地址。应用中的 DNS 检查与实际连接仍是两个步骤，不能替代出口策略，也不能
用本地测试宣称生产环境已满足该条件。真实模型生成质量另行验收。

2026-10-18 实施验证记录（独立 PostgreSQL、Redis 与 MinIO 测试环境）：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 静态检查 | `pnpm lint`、`pnpm typecheck` | 全工作区通过 |
| 构建 | `pnpm build` | 7 个工作区通过 |
| 应用测试 | `pnpm test`；最终追加 `pnpm --filter @fashion/web test` | Web 130、Worker 95、API 568 项通过 |
| 数据库 | `pnpm db:validate`、`pnpm db:test` | schema 校验和 2 项集成测试通过 |
| 浏览器 | `pnpm exec playwright test --reporter=list` | 源码冻结、重启开发服务后的最终全量 101 项通过；趋势页额外连续重复 3 次通过 |
| 文件存储 | `pnpm verify:file-pipeline` | 超长上传拒绝、去重、真实缩略图通过 |
| 依赖 | `pnpm audit:all` | 最终补丁校验 36 项通过，依赖审计通过 |
| 本地启动 | `pnpm test:startup` | 15 项通过；PowerShell 7 实际启动和 Windows PowerShell 5.1 重复启动通过，Web/API 均返回 200 |

本地截图位于 `output/playwright/`：`review-login-before.png` / `review-login-after.png`、
`review-projects-before.png` / `review-projects-after.png`、
`review-canvas-before.png` / `review-canvas-after.png`。
异常状态前后截图为 `review-login-error-before.png` / `review-login-error-after.png`、
`review-save-error-before.png` / `review-save-error-after.png`。其中错误状态修改前图片按提交
`48db5c6b` 的原代码与可控接口重建，未改写旧版界面。
四种尺寸的最终截图为 `review-{login,projects,canvas}-{1366,1440,1920,390}-final.png`，
对应错误状态为 `review-{login,projects,canvas}-error-{宽度}-final.png`。
浏览器截图使用可控数据；真实文件与队列链路由上述集成测试另行验证。

```bash
pnpm audit:all
pnpm lint
pnpm typecheck
pnpm db:validate
pnpm test
pnpm db:test
pnpm build
```

一次执行上述代码、数据库和生产构建门禁（先运行 `pnpm infra:up`）：

```bash
pnpm check
```

浏览器契约测试使用 Playwright 验证真实页面交互，但会 mock 平台 API；它不能替代
API → Redis → Worker → PostgreSQL/MinIO 的真实链路验证：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

本地 `pnpm check` 与 CI 都会审计生产和开发依赖，发现低危及以上漏洞即失败。
仅检查生产依赖可运行 `pnpm audit:prod`。CI 还会执行私有文件流水线验证。

Braces 的 `GHSA-vfj7-8cjw-p6xm` 尚无官方修复发布，本仓库通过
`patches/braces@3.0.3.patch` 限制解析与 AST 遍历深度，并拒绝循环 AST。
`pnpm audit:all` 必须先通过实际安装包的补丁校验和恶意输入回归测试，再审核
审计 JSON，接受这一项已修补的包；报告异常、其他漏洞或未修补副本均失败。
直接 `pnpm audit` 仍会按原版本报告它，不能仅凭版本扫描判断补丁效果。
`sprintf-js` 的 `CVE-2026-97058` 已被 CNA 正式撤销，对应公告的例外依据为
[CVE 官方记录](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/97xxx/CVE-2026-97058.json)。

对象存储需预置 `S3_HEALTHCHECK_OBJECT_KEY` 指向的私有哨兵对象；本地
`minio-init` 会自动创建它，readiness 只需对象级读取权限，无需
`ListBucket`。
